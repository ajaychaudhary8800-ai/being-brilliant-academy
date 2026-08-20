import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { AttendanceStatus, ExaminationResultStatus, ExaminationStatus, Role } from "@prisma/client";
import { assertClassroomBranchChange, requireRequestedBranch } from "./lib/branch-policy.js";
import { assertEvaluationOpen, assertStudentExaminationEligible, assertStudentExaminationPublished, examinationResultFor } from "./lib/examination-policy.js";
import { assertLeaveAttendanceCompatible } from "./lib/leave-attendance-policy.js";
import { noticeRecipientConstraints } from "./lib/notice-policy.js";
import { tenantWhere } from "./lib/prisma.js";
import { pathMatches } from "./lib/scoped-router.js";
import { decodeVerifiedTeacherPhoto, decodeVerifiedUpload } from "./lib/secure-upload.js";
import { allocationWhere, effectiveDateForSession } from "./lib/subject-resolution.js";
import { createTeacherPhotoLocation, parseTeacherPhotoLocation } from "./lib/teacher-photo.js";

test("feature router scopes preserve unrelated public APIs", () => {
  assert.equal(pathMatches("/courses", ["/admin/leaves", "/portal/leaves"]), false);
  assert.equal(pathMatches("/courses/jee", ["/platform/organizations"]), false);
  assert.equal(pathMatches("/admin/leaves/abc", ["/admin/leaves"]), true);
});

test("branch admins cannot override assigned branch scope", () => {
  assert.deepEqual(requireRequestedBranch(Role.BRANCH_ADMIN, ["branch-a"], "branch-a"), { branchId: "branch-a" });
  assert.throws(() => requireRequestedBranch(Role.BRANCH_ADMIN, ["branch-a"], "branch-b"), /Branch access denied/);
  assert.deepEqual(requireRequestedBranch(Role.BRANCH_ADMIN, ["branch-a"]), { branchId: { in: ["branch-a"] } });
});

test("tenant scope cannot be overridden by caller-controlled filters", () => {
  assert.deepEqual(tenantWhere("organization-a", { organizationId: "organization-b", branchId: "branch-b" }), { organizationId: "organization-a", branchId: "branch-b" });
});

test("referenced classrooms cannot move across branches", () => {
  assert.doesNotThrow(() => assertClassroomBranchChange("a", "a", 10));
  assert.doesNotThrow(() => assertClassroomBranchChange("a", "b", 0));
  assert.throws(() => assertClassroomBranchChange("a", "b", 1), /cannot be moved/);
});

test("leave approval preserves legitimate attendance for every leave type", () => {
  const date = new Date("2026-08-20T00:00:00Z");
  for (const desired of [AttendanceStatus.FULL_DAY_LEAVE, AttendanceStatus.HALF_DAY_LEAVE, AttendanceStatus.SHORT_LEAVE]) {
    assert.doesNotThrow(() => assertLeaveAttendanceCompatible(null, desired, "Student", date));
    assert.doesNotThrow(() => assertLeaveAttendanceCompatible(AttendanceStatus.ABSENT, desired, "Student", date));
    assert.throws(() => assertLeaveAttendanceCompatible(AttendanceStatus.PRESENT, desired, "Student", date), /ATTENDANCE|already has PRESENT/);
    assert.throws(() => assertLeaveAttendanceCompatible(AttendanceStatus.LATE, desired, "Teacher", date), /already has LATE/);
  }
});

test("finalized evaluations are immutable and results are never accidentally absent", () => {
  assert.throws(() => assertEvaluationOpen(new Date()), /finalized evaluation/i);
  const pass = examinationResultFor(42, 50, 20, new Date("2026-08-20T00:00:00Z"));
  assert.equal(pass.status, ExaminationResultStatus.PASS); assert.equal(pass.percentage, 84);
  assert.equal(examinationResultFor(10, 50, 20).status, ExaminationResultStatus.FAIL);
  assert.notEqual(pass.status, ExaminationResultStatus.ABSENT);
});

test("historical academic sessions cannot access current examination papers", () => {
  assert.doesNotThrow(() => assertStudentExaminationEligible({ batchId: "b", academicSessionId: "s1" }, { batchId: "b", academicSessionId: "s1" }));
  assert.throws(() => assertStudentExaminationEligible({ batchId: "b", academicSessionId: "old" }, { batchId: "b", academicSessionId: "current" }), /batch and academic session/);
  assert.doesNotThrow(() => assertStudentExaminationPublished(ExaminationStatus.SCHEDULED));
  assert.throws(() => assertStudentExaminationPublished(ExaminationStatus.DRAFT), /not published/);
  assert.throws(() => assertStudentExaminationPublished(ExaminationStatus.ARCHIVED), /not published/);
});

test("upload validation rejects malformed base64 and MIME spoofing", () => {
  const pdf = Buffer.from("%PDF-1.7\nvalid-test").toString("base64");
  assert.equal(decodeVerifiedUpload(pdf, "application/pdf").subarray(0, 5).toString(), "%PDF-");
  assert.throws(() => decodeVerifiedUpload("not base64", "application/pdf"), /valid base64/);
  assert.throws(() => decodeVerifiedUpload(Buffer.from("plain text").toString("base64"), "application/pdf"), /does not match/);
  assert.throws(() => decodeVerifiedUpload(pdf, "image/png"), /does not match/);
});

test("teacher photos enforce image signatures, size and tenant-scoped generated paths", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64");
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]).toString("base64");
  assert.equal(decodeVerifiedTeacherPhoto(jpeg, "image/jpeg")[0], 0xff);
  assert.equal(decodeVerifiedTeacherPhoto(png, "image/png")[1], 0x50);
  assert.equal(decodeVerifiedTeacherPhoto(webp, "image/webp").subarray(8, 12).toString(), "WEBP");
  assert.throws(() => decodeVerifiedTeacherPhoto(webp, "image/png"), /does not match/);
  assert.throws(() => decodeVerifiedTeacherPhoto(Buffer.alloc((5 * 1024 * 1024) + 1).toString("base64"), "image/jpeg"), /5 MB/);
  const location = createTeacherPhotoLocation("org_default", "image/webp");
  assert.match(location.url, /^\/api\/v1\/teacher-photos\/org_default\/[0-9a-f-]{36}\.webp$/);
  assert.equal(parseTeacherPhotoLocation(location.url, "org_default")?.key, location.key);
  assert.equal(parseTeacherPhotoLocation(location.url, "another-organization"), null);
  assert.equal(parseTeacherPhotoLocation("/api/v1/teacher-photos/org_default/../../secret.webp", "org_default"), null);
});

test("allocation date policy excludes future and expired allocations", () => {
  const point = new Date("2026-08-20T00:00:00Z"), where = allocationWhere({ branchId: "br", courseId: "c", batchId: "b", teacherId: "t", academicSessionId: "s", effectiveAt: point });
  assert.deepEqual(where.effectiveFrom, { lte: point }); assert.deepEqual(where.OR, [{ effectiveTo: null }, { effectiveTo: { gte: point } }]);
  const start = new Date("2026-04-01T00:00:00Z"), end = new Date("2027-03-31T00:00:00Z"), range = allocationWhere({ branchId: "br", courseId: "c", batchId: "b", teacherId: "t", academicSessionId: "s", rangeStart: start, rangeEnd: end });
  assert.deepEqual(range.effectiveFrom, { lte: end }); assert.deepEqual(range.OR, [{ effectiveTo: null }, { effectiveTo: { gte: start } }]);
  assert.equal(effectiveDateForSession(start, end, new Date("2025-12-01T00:00:00Z")), start);
  assert.equal(effectiveDateForSession(start, end, new Date("2027-06-01T00:00:00Z")), end);
});

test("notice recipient constraints prevent cross-branch, cross-batch and audience IDOR", () => {
  const now = new Date("2026-08-20T00:00:00Z");
  const constraints = noticeRecipientConstraints(Role.STUDENT, ["branch-a"], ["batch-a"], now);
  assert.deepEqual(constraints.AND, [
    { OR: [{ audience: null }, { audience: Role.STUDENT }] },
    { OR: [{ branchId: null }, { branchId: { in: ["branch-a"] } }] },
    { OR: [{ batchId: null }, { batchId: { in: ["batch-a"] } }] },
    { publishedAt: { lte: now } },
    { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
  ]);
});

test("migration and preflight scripts preserve legacy business state", async () => {
  const allocation = await readFile(new URL("../prisma/migrations/20260820090000_link_allocations_and_expand_classrooms/migration.sql", import.meta.url), "utf8");
  const leave = await readFile(new URL("../prisma/migrations/20260820110000_leave_and_attendance_enhancements/migration.sql", import.meta.url), "utf8");
  const preflight = await readFile(new URL("../prisma/preflight/20260820_production_safety.sql", import.meta.url), "utf8");
  assert.match(allocation, /ON CONFLICT \("courseId", "subjectId"\) DO NOTHING/);
  assert.doesNotMatch(allocation, /DO UPDATE SET "isActive" = true/);
  assert.match(allocation, /subjects could not be resolved exactly once/);
  assert.match(leave, /Explicitly map these legacy values/);
  assert.doesNotMatch(leave, /ELSE 'PENDING'/);
  assert.match(preflight, /BEGIN TRANSACTION READ ONLY/);
  assert.match(preflight, /allocation_relationship_inconsistency/);
});

test("notice acknowledgement applies the same recipient eligibility policy as listing", async () => {
  const source = await readFile(new URL("./routes/notice-board.ts", import.meta.url), "utf8");
  const policy = await readFile(new URL("./lib/notice-policy.ts", import.meta.url), "utf8");
  assert.match(source, /recipientConstraints\(req\)/);
  assert.match(source, /noticeRecipientConstraints\(role, branchIds, batchIds\)/);
  assert.match(policy, /audience: role/);
  assert.match(policy, /publishedAt: \{ lte: now \}/);
  assert.match(policy, /expiresAt: \{ gte: now \}/);
});
