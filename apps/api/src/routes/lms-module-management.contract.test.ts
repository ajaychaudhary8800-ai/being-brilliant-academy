import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("./admin-lms.ts", import.meta.url), "utf8");

test("LMS Module update is tenant scoped and administrator only", () => {
  assert.match(route, /admin\.patch\("\/lms\/modules\/:id", allow\(Role\.SUPER_ADMIN, Role\.BRANCH_ADMIN\)/);
  assert.match(route, /organizationId: req\.auth!\.organizationId/);
  assert.match(route, /assertLmsModuleManagementAccess\(current, module\.course\)/);
  assert.match(route, /MODULE_POSITION_CONFLICT/);
});

test("LMS Module delete blocks cascade deletion when lessons exist", () => {
  assert.match(route, /admin\.delete\("\/lms\/modules\/:id", allow\(Role\.SUPER_ADMIN, Role\.BRANCH_ADMIN\)/);
  assert.match(route, /_count: \{ select: \{ lessons: true \} \}/);
  assert.match(route, /if \(module\._count\.lessons > 0\)/);
  assert.match(route, /MODULE_HAS_LESSONS/);
  assert.match(route, /Move or remove every Lesson before deleting this Module/);
  assert.match(route, /await prisma\.module\.delete\(\{ where: \{ id: module\.id \} \}\)/);
});
