-- Additive course taxonomy and teacher specialization architecture.
-- Existing course/category/type/stream and TeacherProfile.specialization values
-- remain unchanged and are deliberately marked for explicit review.

CREATE TYPE "CourseCategoryType" AS ENUM ('ACADEMIC', 'COMPETITIVE', 'SKILL_BASED');
CREATE TYPE "AcademicBoard" AS ENUM ('CBSE', 'ICSE', 'ISC', 'STATE_BOARD', 'OTHER');
CREATE TYPE "AcademicStream" AS ENUM ('SCIENCE', 'COMMERCE', 'HUMANITIES');
CREATE TYPE "ScienceCombination" AS ENUM ('PCM', 'PCB', 'PCMB');
CREATE TYPE "AcademicPreparationType" AS ENUM ('ACADEMIC_ONLY', 'ACADEMIC_JEE', 'ACADEMIC_NEET');
CREATE TYPE "MasterStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "MasterReviewStatus" AS ENUM ('CONFIRMED', 'REVIEW_REQUIRED');

CREATE TABLE "CompetitiveExam" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompetitiveExam_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CompetitiveExam_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CompetitiveExam_organizationId_code_key" ON "CompetitiveExam"("organizationId", "code");
CREATE UNIQUE INDEX "CompetitiveExam_organizationId_id_key" ON "CompetitiveExam"("organizationId", "id");
CREATE UNIQUE INDEX "CompetitiveExam_organizationId_normalized_name_key" ON "CompetitiveExam"("organizationId", lower(btrim("name")));
CREATE INDEX "CompetitiveExam_organizationId_status_name_idx" ON "CompetitiveExam"("organizationId", "status", "name");

CREATE TABLE "SkillCategory" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE',
  "parentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SkillCategory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SkillCategory_organizationId_id_key" UNIQUE ("organizationId", "id"),
  CONSTRAINT "SkillCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SkillCategory_organizationId_parentId_fkey" FOREIGN KEY ("organizationId", "parentId") REFERENCES "SkillCategory"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SkillCategory_organizationId_code_key" ON "SkillCategory"("organizationId", "code");
CREATE UNIQUE INDEX "SkillCategory_organizationId_normalized_name_key" ON "SkillCategory"("organizationId", lower(btrim("name")));
CREATE INDEX "SkillCategory_organizationId_status_name_idx" ON "SkillCategory"("organizationId", "status", "name");
CREATE INDEX "SkillCategory_organizationId_parentId_idx" ON "SkillCategory"("organizationId", "parentId");

CREATE TABLE "Specialization" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "description" TEXT,
  "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE',
  "legacyReviewStatus" "MasterReviewStatus" NOT NULL DEFAULT 'CONFIRMED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Specialization_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Specialization_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Specialization_organizationId_code_key" ON "Specialization"("organizationId", "code");
CREATE UNIQUE INDEX "Specialization_organizationId_id_key" ON "Specialization"("organizationId", "id");
CREATE UNIQUE INDEX "Specialization_organizationId_normalized_name_key" ON "Specialization"("organizationId", lower(btrim("name")));
CREATE INDEX "Specialization_organizationId_status_name_idx" ON "Specialization"("organizationId", "status", "name");

CREATE UNIQUE INDEX "TeacherProfile_organizationId_id_key" ON "TeacherProfile"("organizationId", "id");

CREATE TABLE "TeacherSpecialization" (
  "organizationId" TEXT NOT NULL,
  "teacherId" TEXT NOT NULL,
  "specializationId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeacherSpecialization_pkey" PRIMARY KEY ("teacherId", "specializationId"),
  CONSTRAINT "TeacherSpecialization_organizationId_teacherId_fkey" FOREIGN KEY ("organizationId", "teacherId") REFERENCES "TeacherProfile"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TeacherSpecialization_organizationId_specializationId_fkey" FOREIGN KEY ("organizationId", "specializationId") REFERENCES "Specialization"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "TeacherSpecialization_organizationId_specializationId_idx" ON "TeacherSpecialization"("organizationId", "specializationId");

ALTER TABLE "Course"
  ALTER COLUMN "classLevel" DROP DEFAULT,
  ALTER COLUMN "classLevel" DROP NOT NULL,
  ADD COLUMN "categoryType" "CourseCategoryType",
  ADD COLUMN "taxonomyReviewStatus" "MasterReviewStatus" NOT NULL DEFAULT 'REVIEW_REQUIRED',
  ADD COLUMN "academicBoard" "AcademicBoard",
  ADD COLUMN "customBoardName" TEXT,
  ADD COLUMN "academicStream" "AcademicStream",
  ADD COLUMN "scienceCombination" "ScienceCombination",
  ADD COLUMN "academicPreparation" "AcademicPreparationType",
  ADD COLUMN "competitiveExamId" TEXT,
  ADD COLUMN "skillCategoryId" TEXT,
  ADD CONSTRAINT "Course_organizationId_competitiveExamId_fkey" FOREIGN KEY ("organizationId", "competitiveExamId") REFERENCES "CompetitiveExam"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Course_organizationId_skillCategoryId_fkey" FOREIGN KEY ("organizationId", "skillCategoryId") REFERENCES "SkillCategory"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Course_customBoardName_check" CHECK (
    "academicBoard" IS NULL OR
    ("academicBoard" = 'OTHER' AND length(btrim("customBoardName")) BETWEEN 2 AND 120) OR
    ("academicBoard" <> 'OTHER' AND "customBoardName" IS NULL)
  ),
  ADD CONSTRAINT "Course_confirmed_taxonomy_check" CHECK (
    "taxonomyReviewStatus" = 'REVIEW_REQUIRED' OR
    ("categoryType" = 'ACADEMIC'
      AND "classLevel" IN ('PLAY','NURSERY','LKG','UKG','CLASS_1','CLASS_2','CLASS_3','CLASS_4','CLASS_5','CLASS_6','CLASS_7','CLASS_8','CLASS_9','CLASS_10','CLASS_11','CLASS_12')
      AND "academicBoard" IS NOT NULL AND "competitiveExamId" IS NULL AND "skillCategoryId" IS NULL
      AND (("classLevel" NOT IN ('CLASS_11','CLASS_12') AND "academicStream" IS NULL AND "scienceCombination" IS NULL AND "academicPreparation" IS NULL)
        OR ("classLevel" IN ('CLASS_11','CLASS_12') AND "academicStream" IN ('COMMERCE','HUMANITIES') AND "scienceCombination" IS NULL AND "academicPreparation" IS NULL)
        OR ("classLevel" IN ('CLASS_11','CLASS_12') AND "academicStream" = 'SCIENCE' AND "scienceCombination" IS NOT NULL AND "academicPreparation" IS NOT NULL
          AND ("academicPreparation" = 'ACADEMIC_ONLY'
            OR ("academicPreparation" = 'ACADEMIC_JEE' AND "scienceCombination" IN ('PCM','PCMB'))
            OR ("academicPreparation" = 'ACADEMIC_NEET' AND "scienceCombination" IN ('PCB','PCMB'))))))
    OR ("categoryType" = 'COMPETITIVE' AND "competitiveExamId" IS NOT NULL AND "classLevel" IS NULL AND "academicBoard" IS NULL AND "customBoardName" IS NULL AND "academicStream" IS NULL AND "scienceCombination" IS NULL AND "academicPreparation" IS NULL AND "skillCategoryId" IS NULL)
    OR ("categoryType" = 'SKILL_BASED' AND "skillCategoryId" IS NOT NULL AND "classLevel" IS NULL AND "academicBoard" IS NULL AND "customBoardName" IS NULL AND "academicStream" IS NULL AND "scienceCombination" IS NULL AND "academicPreparation" IS NULL AND "competitiveExamId" IS NULL)
  );
CREATE INDEX "Course_organizationId_categoryType_status_idx" ON "Course"("organizationId", "categoryType", "status");
CREATE INDEX "Course_organizationId_competitiveExamId_idx" ON "Course"("organizationId", "competitiveExamId");
CREATE INDEX "Course_organizationId_skillCategoryId_idx" ON "Course"("organizationId", "skillCategoryId");

-- Tenant catalogues are defaults, not closed lists. Administrators may add
-- organization-specific records through the master APIs.
WITH catalogue("code", "name") AS (VALUES
  ('JEE_MAIN','JEE Main'),('JEE_ADVANCED','JEE Advanced'),('NEET_UG','NEET UG'),('CUET_UG','CUET UG'),('NDA','NDA'),('CLAT','CLAT'),('AILET','AILET'),('IPMAT','IPMAT'),('NCHM_JEE','NCHM JEE'),('NIFT','NIFT'),('NID_DAT','NID DAT'),('UCEED','UCEED'),('CA_FOUNDATION','CA Foundation'),('CMA_FOUNDATION','CMA Foundation'),('CSEET','CSEET'),('SSC_CHSL','SSC CHSL'),('OTHER','Other / Custom')
)
INSERT INTO "CompetitiveExam" ("id","organizationId","code","name","createdAt","updatedAt")
SELECT 'c'||substr(md5(o.id||':exam:'||c."code"),1,24),o.id,c."code",c."name",CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM "Organization" o CROSS JOIN catalogue c WHERE o."deletedAt" IS NULL ON CONFLICT DO NOTHING;

WITH catalogue("code", "name") AS (VALUES
  ('ARTIFICIAL_INTELLIGENCE','Artificial Intelligence'),('GENERATIVE_AI','Generative AI'),('PYTHON','Python'),('DATA_ANALYTICS','Data Analytics'),('POWER_BI','Power BI'),('DIGITAL_MARKETING','Digital Marketing'),('SEO','SEO'),('SOCIAL_MEDIA_MARKETING','Social Media Marketing'),('WEB_DEVELOPMENT','Web Development'),('CODING','Coding'),('VIDEO_EDITING','Video Editing'),('GRAPHIC_DESIGN','Graphic Design'),('TALLY_GST','Tally / GST'),('MS_OFFICE','MS Office'),('SPOKEN_ENGLISH','Spoken English'),('COMMUNICATION_SKILLS','Communication Skills'),('OTHER','Other / Custom')
)
INSERT INTO "SkillCategory" ("id","organizationId","code","name","createdAt","updatedAt")
SELECT 'c'||substr(md5(o.id||':skill:'||c."code"),1,24),o.id,c."code",c."name",CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM "Organization" o CROSS JOIN catalogue c WHERE o."deletedAt" IS NULL ON CONFLICT DO NOTHING;

WITH catalogue("code", "name") AS (VALUES
  ('JEE_PHYSICS','JEE Physics'),('NEET_PHYSICS','NEET Physics'),('BOARD_PHYSICS','Board Physics'),('MATHEMATICS','Mathematics'),('FOUNDATION_MATHEMATICS','Foundation Mathematics'),('ORGANIC_CHEMISTRY','Organic Chemistry'),('PHYSICAL_CHEMISTRY','Physical Chemistry'),('ACCOUNTS','Accounts'),('ECONOMICS','Economics'),('COMPUTER_SCIENCE','Computer Science'),('PYTHON','Python'),('ARTIFICIAL_INTELLIGENCE','Artificial Intelligence'),('DIGITAL_MARKETING','Digital Marketing')
)
INSERT INTO "Specialization" ("id","organizationId","code","name","createdAt","updatedAt")
SELECT 'c'||substr(md5(o.id||':specialization:'||c."code"),1,24),o.id,c."code",c."name",CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM "Organization" o CROSS JOIN catalogue c WHERE o."deletedAt" IS NULL ON CONFLICT DO NOTHING;

WITH catalogue("code", "name") AS (VALUES
  ('ENGLISH','English'),('HINDI','Hindi'),('MATHEMATICS','Mathematics'),('SCIENCE','Science'),('ENVIRONMENTAL_STUDIES','Environmental Studies'),('SOCIAL_SCIENCE','Social Science'),('PHYSICS','Physics'),('CHEMISTRY','Chemistry'),('BIOLOGY','Biology'),('COMPUTER_SCIENCE','Computer Science'),('INFORMATICS_PRACTICES','Informatics Practices'),('PHYSICAL_EDUCATION','Physical Education'),('ACCOUNTANCY','Accountancy'),('BUSINESS_STUDIES','Business Studies'),('ECONOMICS','Economics'),('HISTORY','History'),('GEOGRAPHY','Geography'),('POLITICAL_SCIENCE','Political Science'),('PSYCHOLOGY','Psychology'),('SOCIOLOGY','Sociology'),('HOME_SCIENCE','Home Science'),('FINE_ARTS','Fine Arts'),('MUSIC','Music'),('LEGAL_STUDIES','Legal Studies'),('ENTREPRENEURSHIP','Entrepreneurship'),('APPLIED_MATHEMATICS','Applied Mathematics')
)
INSERT INTO "Subject" ("id","organizationId","code","name","status","legacyReviewStatus","createdAt","updatedAt")
SELECT 'c'||substr(md5(o.id||':subject:'||c."code"),1,24),o.id,c."code",c."name",'ACTIVE','CONFIRMED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM "Organization" o CROSS JOIN catalogue c WHERE o."deletedAt" IS NULL ON CONFLICT DO NOTHING;

-- Preserve legacy specialization text. Exact normalized values become one
-- master record; combined/delimited values remain visible and review-required.
INSERT INTO "Specialization" ("id","organizationId","code","name","legacyReviewStatus","createdAt","updatedAt")
SELECT 'c'||substr(md5(t."organizationId"||':legacy-specialization:'||lower(btrim(t.specialization))),1,24),
       t."organizationId",'LEGACY-'||upper(substr(md5(lower(btrim(t.specialization))),1,16)),min(btrim(t.specialization)),
       CASE WHEN min(btrim(t.specialization)) ~* '(^|[[:space:]])(and|or)([[:space:]]|$)|[+/,;&]' THEN 'REVIEW_REQUIRED'::"MasterReviewStatus" ELSE 'CONFIRMED'::"MasterReviewStatus" END,
       CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
FROM "TeacherProfile" t WHERE nullif(btrim(t.specialization),'') IS NOT NULL
GROUP BY t."organizationId",lower(btrim(t.specialization)) ON CONFLICT DO NOTHING;

INSERT INTO "TeacherSpecialization" ("organizationId","teacherId","specializationId","createdAt")
SELECT t."organizationId",t.id,s.id,CURRENT_TIMESTAMP FROM "TeacherProfile" t
JOIN "Specialization" s ON s."organizationId"=t."organizationId" AND lower(btrim(s.name))=lower(btrim(t.specialization))
WHERE nullif(btrim(t.specialization),'') IS NOT NULL ON CONFLICT DO NOTHING;
