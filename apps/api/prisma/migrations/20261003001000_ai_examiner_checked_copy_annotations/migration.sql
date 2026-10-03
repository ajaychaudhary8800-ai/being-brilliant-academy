-- ERP/LMS 3.1A: immutable, non-destructive AI checked-copy annotation revisions.

DO $$ BEGIN
  CREATE TYPE "AIExaminerCheckedCopyRevisionStatus" AS ENUM ('DRAFT','APPROVED','RENDERED','PUBLISHED','SUPERSEDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AIExaminerAnnotationType" AS ENUM (
    'TICK','CROSS','UNDERLINE','CIRCLE','RECTANGLE','HIGHLIGHT','ARROW','FREEHAND',
    'TEXT_COMMENT','QUESTION_MARK','STEP_MARK','QUESTION_SCORE','PAGE_SCORE','TOTAL_SCORE',
    'RUBRIC_NOTE','ERROR_LABEL'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AIExaminerAnnotationApprovalState" AS ENUM ('AI_DRAFT','POSITION_REVIEW_REQUIRED','APPROVED','REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AIExaminerAnnotationAuthorType" AS ENUM ('AI','TEACHER','MODERATOR','SYSTEM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "AIExaminerCheckedCopy" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "answerSheetId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AIExaminerCheckedCopy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AIExaminerCheckedCopyRevision" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "checkedCopyId" TEXT NOT NULL,
  "evaluationId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "status" "AIExaminerCheckedCopyRevisionStatus" NOT NULL DEFAULT 'DRAFT',
  "sourceAnswerSheetSha256" TEXT NOT NULL,
  "evaluationRevision" INTEGER NOT NULL,
  "rubricVersion" INTEGER NOT NULL,
  "resultRevision" INTEGER NOT NULL DEFAULT 0,
  "annotationRevision" INTEGER NOT NULL DEFAULT 1,
  "sourcePageCount" INTEGER NOT NULL,
  "renderedFileName" TEXT,
  "renderedMimeType" TEXT,
  "renderedFileSize" INTEGER,
  "renderedFileData" BYTEA,
  "renderedFileSha256" TEXT,
  "renderedAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AIExaminerCheckedCopyRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AIExaminerCheckedCopyRevision_page_count_check" CHECK ("sourcePageCount" >= 1 AND "sourcePageCount" <= 1000)
);

CREATE TABLE IF NOT EXISTS "AIExaminerAnnotation" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "questionKey" TEXT,
  "rubricCriterion" TEXT,
  "type" "AIExaminerAnnotationType" NOT NULL,
  "content" TEXT,
  "marks" DECIMAL(8,2),
  "confidence" DECIMAL(5,4),
  "sourceEvidence" TEXT,
  "vectorData" JSONB,
  "authorType" "AIExaminerAnnotationAuthorType" NOT NULL,
  "authorId" TEXT,
  "approvalState" "AIExaminerAnnotationApprovalState" NOT NULL DEFAULT 'AI_DRAFT',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AIExaminerAnnotation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AIExaminerAnnotation_confidence_check" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1))
);

CREATE TABLE IF NOT EXISTS "AIExaminerAnnotationAnchor" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "annotationId" TEXT NOT NULL,
  "pageNumber" INTEGER NOT NULL,
  "x" DECIMAL(7,6) NOT NULL,
  "y" DECIMAL(7,6) NOT NULL,
  "width" DECIMAL(7,6) NOT NULL,
  "height" DECIMAL(7,6) NOT NULL,
  "rotation" DECIMAL(7,3) NOT NULL DEFAULT 0,
  "placementConfidence" DECIMAL(5,4),
  "evidenceText" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AIExaminerAnnotationAnchor_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AIExaminerAnnotationAnchor_page_check" CHECK ("pageNumber" >= 1),
  CONSTRAINT "AIExaminerAnnotationAnchor_normalized_check" CHECK (
    "x" >= 0 AND "x" <= 1 AND "y" >= 0 AND "y" <= 1 AND
    "width" >= 0 AND "width" <= 1 AND "height" >= 0 AND "height" <= 1 AND
    "x" + "width" <= 1.000001 AND "y" + "height" <= 1.000001
  ),
  CONSTRAINT "AIExaminerAnnotationAnchor_confidence_check" CHECK (
    "placementConfidence" IS NULL OR ("placementConfidence" >= 0 AND "placementConfidence" <= 1)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "AIExaminerCheckedCopy_answerSheetId_key" ON "AIExaminerCheckedCopy"("answerSheetId");
CREATE INDEX IF NOT EXISTS "AIExaminerCheckedCopy_organizationId_createdAt_idx" ON "AIExaminerCheckedCopy"("organizationId","createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "AIExaminerCheckedCopyRevision_checkedCopyId_revision_key" ON "AIExaminerCheckedCopyRevision"("checkedCopyId","revision");
CREATE INDEX IF NOT EXISTS "AIExaminerCheckedCopyRevision_organizationId_status_createdAt_idx" ON "AIExaminerCheckedCopyRevision"("organizationId","status","createdAt");
CREATE INDEX IF NOT EXISTS "AIExaminerCheckedCopyRevision_organizationId_evaluationId_revision_idx" ON "AIExaminerCheckedCopyRevision"("organizationId","evaluationId","revision");
CREATE INDEX IF NOT EXISTS "AIExaminerCheckedCopyRevision_createdById_idx" ON "AIExaminerCheckedCopyRevision"("createdById");
CREATE INDEX IF NOT EXISTS "AIExaminerCheckedCopyRevision_approvedById_idx" ON "AIExaminerCheckedCopyRevision"("approvedById");
CREATE INDEX IF NOT EXISTS "AIExaminerAnnotation_organizationId_revisionId_sortOrder_idx" ON "AIExaminerAnnotation"("organizationId","revisionId","sortOrder");
CREATE INDEX IF NOT EXISTS "AIExaminerAnnotation_organizationId_questionKey_approvalState_idx" ON "AIExaminerAnnotation"("organizationId","questionKey","approvalState");
CREATE INDEX IF NOT EXISTS "AIExaminerAnnotation_authorId_idx" ON "AIExaminerAnnotation"("authorId");
CREATE UNIQUE INDEX IF NOT EXISTS "AIExaminerAnnotationAnchor_annotationId_key" ON "AIExaminerAnnotationAnchor"("annotationId");
CREATE INDEX IF NOT EXISTS "AIExaminerAnnotationAnchor_organizationId_pageNumber_idx" ON "AIExaminerAnnotationAnchor"("organizationId","pageNumber");

DO $$ BEGIN ALTER TABLE "AIExaminerCheckedCopy" ADD CONSTRAINT "AIExaminerCheckedCopy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AIExaminerCheckedCopy" ADD CONSTRAINT "AIExaminerCheckedCopy_answerSheetId_fkey" FOREIGN KEY ("answerSheetId") REFERENCES "ExaminationAnswerSheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AIExaminerCheckedCopyRevision" ADD CONSTRAINT "AIExaminerCheckedCopyRevision_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AIExaminerCheckedCopyRevision" ADD CONSTRAINT "AIExaminerCheckedCopyRevision_checkedCopyId_fkey" FOREIGN KEY ("checkedCopyId") REFERENCES "AIExaminerCheckedCopy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AIExaminerCheckedCopyRevision" ADD CONSTRAINT "AIExaminerCheckedCopyRevision_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "AIExaminerEvaluation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AIExaminerCheckedCopyRevision" ADD CONSTRAINT "AIExaminerCheckedCopyRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AIExaminerCheckedCopyRevision" ADD CONSTRAINT "AIExaminerCheckedCopyRevision_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AIExaminerAnnotation" ADD CONSTRAINT "AIExaminerAnnotation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AIExaminerAnnotation" ADD CONSTRAINT "AIExaminerAnnotation_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "AIExaminerCheckedCopyRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AIExaminerAnnotation" ADD CONSTRAINT "AIExaminerAnnotation_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AIExaminerAnnotationAnchor" ADD CONSTRAINT "AIExaminerAnnotationAnchor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AIExaminerAnnotationAnchor" ADD CONSTRAINT "AIExaminerAnnotationAnchor_annotationId_fkey" FOREIGN KEY ("annotationId") REFERENCES "AIExaminerAnnotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION "AIExaminerAnnotation_draft_only_fn"() RETURNS trigger AS $$
DECLARE target_revision TEXT; target_status "AIExaminerCheckedCopyRevisionStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN target_revision := OLD."revisionId"; ELSE target_revision := NEW."revisionId"; END IF;
  SELECT "status" INTO target_status FROM "AIExaminerCheckedCopyRevision" WHERE "id" = target_revision;
  IF target_status IS NULL OR target_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'AI Examiner checked-copy annotations are immutable outside draft revisions';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "AIExaminerAnnotation_draft_only_trigger" ON "AIExaminerAnnotation";
CREATE TRIGGER "AIExaminerAnnotation_draft_only_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "AIExaminerAnnotation"
  FOR EACH ROW EXECUTE FUNCTION "AIExaminerAnnotation_draft_only_fn"();

CREATE OR REPLACE FUNCTION "AIExaminerAnnotationAnchor_draft_only_fn"() RETURNS trigger AS $$
DECLARE target_annotation TEXT; target_status "AIExaminerCheckedCopyRevisionStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN target_annotation := OLD."annotationId"; ELSE target_annotation := NEW."annotationId"; END IF;
  SELECT r."status" INTO target_status
    FROM "AIExaminerAnnotation" a
    JOIN "AIExaminerCheckedCopyRevision" r ON r."id" = a."revisionId"
   WHERE a."id" = target_annotation;
  IF target_status IS NULL OR target_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'AI Examiner checked-copy anchors are immutable outside draft revisions';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "AIExaminerAnnotationAnchor_draft_only_trigger" ON "AIExaminerAnnotationAnchor";
CREATE TRIGGER "AIExaminerAnnotationAnchor_draft_only_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "AIExaminerAnnotationAnchor"
  FOR EACH ROW EXECUTE FUNCTION "AIExaminerAnnotationAnchor_draft_only_fn"();
