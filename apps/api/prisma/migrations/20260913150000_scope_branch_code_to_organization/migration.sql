-- Branch codes identify locations within one organization. The legacy global
-- index prevents separate tenants from using the same conventional code.
-- The existing global index guarantees the new composite index can be built
-- without encountering duplicate exact values in current production data.
BEGIN;

CREATE UNIQUE INDEX "Branch_organizationId_code_key"
ON "Branch"("organizationId", "code");

DROP INDEX "Branch_code_key";

COMMIT;
