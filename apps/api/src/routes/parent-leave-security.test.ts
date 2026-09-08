import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("leave submitter migration is additive, nullable and leaves history untouched", async () => {
  const [schema, migration] = await Promise.all([
    read("../../prisma/schema.prisma"),
    read("../../prisma/migrations/20260908110000_add_leave_request_submitter/migration.sql"),
  ]);
  assert.match(schema, /submittedById\s+String\?/);
  assert.match(schema, /submittedBy\s+User\?\s+@relation\("LeaveRequestSubmitter"/);
  assert.match(migration, /ADD COLUMN "submittedById" TEXT/);
  assert.match(migration, /CREATE INDEX "LeaveRequest_submittedById_idx"/);
  assert.match(migration, /FOREIGN KEY \("submittedById"\).*ON DELETE RESTRICT ON UPDATE CASCADE/s);
  assert.doesNotMatch(migration, /^\s*(?:DROP\b|DELETE\s+FROM\b|UPDATE\s+"|TRUNCATE\b|INSERT\s+INTO\b)/im);
  assert.doesNotMatch(migration, /NOT NULL/i);
});

test("parent leave uses the selected linked active same-tenant student as the durable subject", async () => {
  const route = await read("./leave-management.ts");
  assert.match(route, /parentId: req\.auth!\.userId, studentId/);
  assert.match(route, /student: \{ organizationId: req\.auth!\.organizationId, status: StudentStatus\.ACTIVE/);
  assert.match(route, /user: \{ organizationId: req\.auth!\.organizationId, isActive: true \}/);
  assert.match(route, /userId: student\.user\.id, submittedById: req\.auth!\.userId, branchId: student\.branchId/);
  assert.match(route, /isolationLevel: Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.match(route, /where: \{ organizationId: req\.auth!\.organizationId, userId: student\.user\.id, status:/);
  assert.match(route, /leaveDecisionRecipient\(leave\.userId, leave\.submittedById\)/);
});

test("no weaker legacy portal leave mutation path remains", async () => {
  const portals = await read("./portals.ts");
  assert.doesNotMatch(portals, /router\.(?:get|post|delete)\("\/leaves/);
  assert.doesNotMatch(portals, /parentStudent\.findFirst\(\{where:\{parentId:id\(req\)\}.*branchId/s);
});

test("leave reads, cancellation, attachments and admin decisions are tenant and owner scoped", async () => {
  const route = await read("./leave-management.ts");
  assert.match(route, /function portalOwnerWhere/);
  assert.match(route, /submittedById: userId.*submittedById: null, userId/s);
  assert.match(route, /id: id\.parse\(req\.params\.leaveId\), organizationId: req\.auth!\.organizationId/);
  assert.match(route, /id: leave\.id, organizationId: req\.auth!\.organizationId, status: LeaveRequestStatus\.PENDING/);
  assert.match(route, /branchAccess\(req, leave\.branchId\)/);
});

test("parent portal and admin surfaces identify child, guardian and legacy ambiguity", async () => {
  const [portal, admin] = await Promise.all([
    read("../../../web/components/portal-workspace.tsx"),
    read("../../../web/app/admin/leaves/page.tsx"),
  ]);
  for (const source of [portal, admin]) assert.match(source, /Child not recorded \(legacy request\)/);
  assert.match(portal, /children\.length === 0/);
  assert.match(portal, /children\.length === 1/);
  assert.match(portal, /Choose child/);
  assert.match(portal, /studentId: ""/);
  assert.match(admin, /Guardian:/);
  assert.match(admin, /Parent submitted/);
});

test("existing Student and Teacher leave and attendance integration remain in the hardened route", async () => {
  const route = await read("./leave-management.ts");
  assert.match(route, /const applicantRoles: Role\[\] = \[Role\.STUDENT, Role\.TEACHER\]/);
  assert.match(route, /submittedById: req\.auth!\.userId, branchId: profile\.branchId/);
  assert.match(route, /if \(leave\.user\.studentProfile\)/);
  assert.match(route, /if \(leave\.user\.teacherProfile\)/);
  assert.match(route, /assertLeaveAttendanceCompatible/);
});
