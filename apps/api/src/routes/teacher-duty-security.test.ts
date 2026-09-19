import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("teacher duty assignment requires an active teacher and serializable conflict recheck", async () => {
  const route = await readFile(new URL("./admin-academic-operations.ts", import.meta.url), "utf8");
  assert.match(route, /user: \{ select: \{ isActive: true \} \}/);
  assert.match(route, /!teacher\.user\.isActive/);
  assert.match(route, /prisma\.\$transaction\(async tx =>/);
  assert.match(route, /teacherOnApprovedLeave\(input\.teacherId, date, tx\)/);
  assert.match(route, /tx\.teacherDuty\.findFirst/);
  assert.match(route, /tx\.teacherSubstitution\.findFirst/);
  assert.match(route, /tx\.teacherDuty\.create/);
  assert.match(route, /tx\.auditLog\.create/);
  assert.match(route, /Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.match(route, /error\.code === "P2034"/);
});
