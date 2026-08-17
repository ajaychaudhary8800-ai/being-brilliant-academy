-- Additive, data-preserving migration. Legacy name columns remain available.
CREATE TABLE "AcademicSession" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "startsAt" DATE NOT NULL,
  "endsAt" DATE NOT NULL,
  "isCurrent" BOOLEAN NOT NULL DEFAULT false,
  "isArchived" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AcademicSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AcademicSession_organizationId_name_key" ON "AcademicSession"("organizationId", "name");
CREATE UNIQUE INDEX "AcademicSession_organizationId_name_ci_key" ON "AcademicSession"("organizationId", lower("name"));
CREATE UNIQUE INDEX "AcademicSession_one_current_per_org_key" ON "AcademicSession"("organizationId") WHERE "isCurrent" = true;
CREATE INDEX "AcademicSession_organizationId_isCurrent_idx" ON "AcademicSession"("organizationId", "isCurrent");
CREATE INDEX "AcademicSession_organizationId_isArchived_startsAt_idx" ON "AcademicSession"("organizationId", "isArchived", "startsAt");

WITH legacy AS (
  SELECT "organizationId", trim("academicSession") AS name FROM "Batch"
  UNION SELECT "organizationId", trim("academicSession") FROM "StudentProfile"
  UNION SELECT "organizationId", trim("academicSession") FROM "Examination"
  UNION SELECT "organizationId", trim("academicSession") FROM "Timetable"
), normalized AS (
  SELECT DISTINCT ON ("organizationId", lower(name)) "organizationId", name
  FROM legacy WHERE name <> ''
  ORDER BY "organizationId", lower(name), name
)
INSERT INTO "AcademicSession" ("id", "organizationId", "name", "startsAt", "endsAt")
SELECT 'c' || substring(md5("organizationId" || ':' || lower(name)), 1, 24), "organizationId", name,
  CASE WHEN name ~ '^(19|20)[0-9]{2}' THEN make_date(substring(name,1,4)::int, 4, 1) ELSE CURRENT_DATE END,
  CASE WHEN name ~ '^(19|20)[0-9]{2}' THEN make_date(substring(name,1,4)::int + 1, 3, 31) ELSE CURRENT_DATE + 365 END
FROM normalized
ON CONFLICT ("organizationId", "name") DO NOTHING;

-- Organizations without legacy records still receive a usable current session.
INSERT INTO "AcademicSession" ("id", "organizationId", "name", "startsAt", "endsAt")
SELECT 'c' || substring(md5(o."id" || ':default'), 1, 24), o."id",
       y.start_year || '-' || right((y.start_year + 1)::text, 2),
       make_date(y.start_year, o."academicYearStartMonth", 1),
       (make_date(y.start_year + 1, o."academicYearStartMonth", 1) - interval '1 day')::date
FROM "Organization" o
CROSS JOIN LATERAL (SELECT CASE WHEN extract(month FROM CURRENT_DATE)::int < o."academicYearStartMonth" THEN extract(year FROM CURRENT_DATE)::int - 1 ELSE extract(year FROM CURRENT_DATE)::int END AS start_year) y
WHERE NOT EXISTS (SELECT 1 FROM "AcademicSession" s WHERE s."organizationId" = o."id");

WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY "organizationId" ORDER BY "startsAt" DESC, name DESC) AS rn
  FROM "AcademicSession"
)
UPDATE "AcademicSession" s SET "isCurrent" = true FROM ranked r WHERE s.id = r.id AND r.rn = 1;

ALTER TABLE "Batch" ADD COLUMN "academicSessionId" TEXT;
ALTER TABLE "StudentProfile" ADD COLUMN "academicSessionId" TEXT;
ALTER TABLE "Examination" ADD COLUMN "academicSessionId" TEXT;
ALTER TABLE "Timetable" ADD COLUMN "academicSessionId" TEXT;

UPDATE "Batch" x SET "academicSessionId" = s.id, "academicSession" = s.name FROM "AcademicSession" s WHERE s."organizationId"=x."organizationId" AND lower(s.name)=lower(trim(x."academicSession"));
UPDATE "StudentProfile" x SET "academicSessionId" = s.id, "academicSession" = s.name FROM "AcademicSession" s WHERE s."organizationId"=x."organizationId" AND lower(s.name)=lower(trim(x."academicSession"));
UPDATE "Examination" x SET "academicSessionId" = s.id, "academicSession" = s.name FROM "AcademicSession" s WHERE s."organizationId"=x."organizationId" AND lower(s.name)=lower(trim(x."academicSession"));
UPDATE "Timetable" x SET "academicSessionId" = s.id, "academicSession" = s.name FROM "AcademicSession" s WHERE s."organizationId"=x."organizationId" AND lower(s.name)=lower(trim(x."academicSession"));

ALTER TABLE "Batch" ALTER COLUMN "academicSessionId" SET NOT NULL;
ALTER TABLE "StudentProfile" ALTER COLUMN "academicSessionId" SET NOT NULL;
ALTER TABLE "Examination" ALTER COLUMN "academicSessionId" SET NOT NULL;
ALTER TABLE "Timetable" ALTER COLUMN "academicSessionId" SET NOT NULL;
CREATE INDEX "Batch_academicSessionId_idx" ON "Batch"("academicSessionId");
CREATE INDEX "StudentProfile_academicSessionId_idx" ON "StudentProfile"("academicSessionId");
CREATE INDEX "Examination_academicSessionId_idx" ON "Examination"("academicSessionId");
CREATE INDEX "Timetable_academicSessionId_idx" ON "Timetable"("academicSessionId");
ALTER TABLE "AcademicSession" ADD CONSTRAINT "AcademicSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_academicSessionId_fkey" FOREIGN KEY ("academicSessionId") REFERENCES "AcademicSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_academicSessionId_fkey" FOREIGN KEY ("academicSessionId") REFERENCES "AcademicSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Examination" ADD CONSTRAINT "Examination_academicSessionId_fkey" FOREIGN KEY ("academicSessionId") REFERENCES "AcademicSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Timetable" ADD CONSTRAINT "Timetable_academicSessionId_fkey" FOREIGN KEY ("academicSessionId") REFERENCES "AcademicSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Compatibility bridge: legacy clients may still submit the session name. The
-- database resolves it to the tenant-owned record and rejects unknown names.
CREATE FUNCTION resolve_academic_session_id() RETURNS trigger AS $$
BEGIN
  SELECT id, name INTO NEW."academicSessionId", NEW."academicSession" FROM "AcademicSession"
    WHERE "organizationId" = NEW."organizationId" AND lower(name) = lower(trim(NEW."academicSession")) AND NOT "isArchived";
  IF NEW."academicSessionId" IS NULL THEN RAISE EXCEPTION 'Unknown academic session % for organization %', NEW."academicSession", NEW."organizationId" USING ERRCODE = '23503'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "Batch_resolve_academic_session" BEFORE INSERT OR UPDATE OF "academicSession", "academicSessionId" ON "Batch" FOR EACH ROW EXECUTE FUNCTION resolve_academic_session_id();
CREATE TRIGGER "StudentProfile_resolve_academic_session" BEFORE INSERT OR UPDATE OF "academicSession", "academicSessionId" ON "StudentProfile" FOR EACH ROW EXECUTE FUNCTION resolve_academic_session_id();
CREATE TRIGGER "Examination_resolve_academic_session" BEFORE INSERT OR UPDATE OF "academicSession", "academicSessionId" ON "Examination" FOR EACH ROW EXECUTE FUNCTION resolve_academic_session_id();
CREATE TRIGGER "Timetable_resolve_academic_session" BEFORE INSERT OR UPDATE OF "academicSession", "academicSessionId" ON "Timetable" FOR EACH ROW EXECUTE FUNCTION resolve_academic_session_id();

-- Organizations provisioned after this migration also start with exactly one
-- current academic session without relying on application or seed ordering.
CREATE FUNCTION provision_initial_academic_session() RETURNS trigger AS $$
DECLARE start_year integer;
BEGIN
  start_year := CASE WHEN extract(month FROM CURRENT_DATE)::int < NEW."academicYearStartMonth" THEN extract(year FROM CURRENT_DATE)::int - 1 ELSE extract(year FROM CURRENT_DATE)::int END;
  INSERT INTO "AcademicSession" ("id", "organizationId", "name", "startsAt", "endsAt", "isCurrent")
  VALUES ('c' || substring(md5(NEW.id || ':default'), 1, 24), NEW.id, start_year || '-' || right((start_year + 1)::text, 2), make_date(start_year, NEW."academicYearStartMonth", 1), (make_date(start_year + 1, NEW."academicYearStartMonth", 1) - interval '1 day')::date, true);
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "Organization_provision_academic_session" AFTER INSERT ON "Organization" FOR EACH ROW EXECUTE FUNCTION provision_initial_academic_session();

CREATE FUNCTION enforce_current_academic_session() RETURNS trigger AS $$
DECLARE tenant_id text;
BEGIN
  tenant_id := COALESCE(NEW."organizationId", OLD."organizationId");
  IF (SELECT count(*) FROM "AcademicSession" WHERE "organizationId" = tenant_id AND "isCurrent") <> 1 THEN
    RAISE EXCEPTION 'Organization % must have exactly one current academic session', tenant_id USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER "AcademicSession_exactly_one_current"
AFTER INSERT OR UPDATE OR DELETE ON "AcademicSession"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_current_academic_session();
