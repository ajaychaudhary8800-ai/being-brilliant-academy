DROP INDEX IF EXISTS "Category_name_key";
DROP INDEX IF EXISTS "Category_slug_key";

CREATE UNIQUE INDEX "Category_organizationId_name_key"
  ON "Category"("organizationId", "name");
CREATE UNIQUE INDEX "Category_organizationId_slug_key"
  ON "Category"("organizationId", "slug");

WITH defaults("name", "slug") AS (
  VALUES
    ('SCHOOL', 'school'),
    ('JEE', 'jee'),
    ('NEET', 'neet'),
    ('CUET', 'cuet'),
    ('NDA', 'nda'),
    ('FOUNDATION', 'foundation'),
    ('COMMERCE', 'commerce'),
    ('SKILL COURSE', 'skill-course'),
    ('OTHER', 'other')
)
INSERT INTO "Category" ("id", "organizationId", "name", "slug")
SELECT
  'c' || substr(md5(organization."id" || ':' || defaults."slug"), 1, 24),
  organization."id",
  defaults."name",
  defaults."slug"
FROM "Organization" AS organization
CROSS JOIN defaults
WHERE organization."deletedAt" IS NULL
ON CONFLICT DO NOTHING;
