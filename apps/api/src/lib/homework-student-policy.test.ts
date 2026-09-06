import assert from "node:assert/strict";
import test from "node:test";
import { HomeworkStatus, HomeworkSubmissionStatus, Role, StudentStatus } from "@prisma/client";
import {
  assertHomeworkSubmissionContent,
  assertHomeworkSubmissionReplaceable,
  assertHomeworkSubmissionReplaced,
  assertStudentHomeworkIdentityNotSupplied,
  assertStudentHomeworkSubmissionAccess,
  homeworkSubmissionStatusAt,
  replaceableHomeworkSubmissionStatuses,
} from "./homework-policy.js";
import { assertDocumentFileExtension, decodeVerifiedUpload } from "./secure-upload.js";

const eligibleStudent = {
  role: Role.STUDENT,
  requestOrganizationId: "org-a",
  homeworkOrganizationId: "org-a",
  homeworkStatus: HomeworkStatus.PUBLISHED,
  homeworkBatchId: "batch-a",
  homeworkCourseId: "course-a",
  userIsActive: true,
  studentOrganizationId: "org-a",
  studentBatchId: "batch-a",
  studentCourseId: "course-a",
  studentStatus: StudentStatus.ACTIVE,
};

function errorCode(action: () => unknown) {
  try {
    action();
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? null;
  }
}

test("only an authenticated Student role can use Student Homework submission policy", () => {
  assert.doesNotThrow(() => assertStudentHomeworkSubmissionAccess(eligibleStudent));
  for (const role of [Role.TEACHER, Role.PARENT, Role.SUPER_ADMIN, Role.BRANCH_ADMIN]) {
    assert.equal(errorCode(() => assertStudentHomeworkSubmissionAccess({ ...eligibleStudent, role })), "FORBIDDEN");
  }
  assert.equal(errorCode(() => assertStudentHomeworkSubmissionAccess({ ...eligibleStudent, role: undefined as unknown as Role })), "FORBIDDEN");
});

test("active authoritative User and StudentProfile state are required", () => {
  assert.equal(errorCode(() => assertStudentHomeworkSubmissionAccess({ ...eligibleStudent, userIsActive: false })), "INACTIVE_ACCOUNT");
  for (const studentStatus of [StudentStatus.INACTIVE, StudentStatus.ARCHIVED]) {
    assert.equal(errorCode(() => assertStudentHomeworkSubmissionAccess({ ...eligibleStudent, studentStatus })), "STUDENT_NOT_ELIGIBLE");
  }
});

test("tenant, batch and course eligibility cannot be crossed", () => {
  assert.equal(errorCode(() => assertStudentHomeworkSubmissionAccess({ ...eligibleStudent, requestOrganizationId: "org-b" })), "STUDENT_NOT_ELIGIBLE");
  assert.equal(errorCode(() => assertStudentHomeworkSubmissionAccess({ ...eligibleStudent, studentOrganizationId: "org-b" })), "STUDENT_NOT_ELIGIBLE");
  assert.equal(errorCode(() => assertStudentHomeworkSubmissionAccess({ ...eligibleStudent, studentBatchId: "batch-b" })), "STUDENT_NOT_ELIGIBLE");
  assert.equal(errorCode(() => assertStudentHomeworkSubmissionAccess({ ...eligibleStudent, studentCourseId: "course-b" })), "STUDENT_NOT_ELIGIBLE");
});

test("only published Homework accepts submissions", () => {
  assert.doesNotThrow(() => assertStudentHomeworkSubmissionAccess(eligibleStudent));
  for (const homeworkStatus of [HomeworkStatus.DRAFT, HomeworkStatus.CLOSED, HomeworkStatus.ARCHIVED]) {
    assert.equal(errorCode(() => assertStudentHomeworkSubmissionAccess({ ...eligibleStudent, homeworkStatus })), "HOMEWORK_NOT_OPEN");
  }
});

test("Student identity is server-derived and cannot be supplied by the client", () => {
  assert.doesNotThrow(() => assertStudentHomeworkIdentityNotSupplied(undefined));
  assert.equal(errorCode(() => assertStudentHomeworkIdentityNotSupplied("student-b")), "STUDENT_ID_NOT_ALLOWED");
  assert.equal(errorCode(() => assertStudentHomeworkIdentityNotSupplied("student-a")), "STUDENT_ID_NOT_ALLOWED");
});

test("text-only and file-only Homework submissions are valid while empty submissions are rejected", () => {
  assert.doesNotThrow(() => assertHomeworkSubmissionContent("Text-only Homework answer", false));
  assert.doesNotThrow(() => assertHomeworkSubmissionContent(null, true));
  assert.equal(errorCode(() => assertHomeworkSubmissionContent(null, false)), "SUBMISSION_CONTENT_REQUIRED");
  assert.equal(errorCode(() => assertHomeworkSubmissionContent("   ", false)), "SUBMISSION_CONTENT_REQUIRED");
});

test("server submission time assigns on-time and late status at the due boundary", () => {
  const due = new Date("2026-09-08T10:00:00.000Z");
  assert.equal(homeworkSubmissionStatusAt(due, new Date("2026-09-08T09:59:59.999Z")), HomeworkSubmissionStatus.SUBMITTED);
  assert.equal(homeworkSubmissionStatusAt(due, due), HomeworkSubmissionStatus.SUBMITTED);
  assert.equal(homeworkSubmissionStatusAt(due, new Date("2026-09-08T10:00:00.001Z")), HomeworkSubmissionStatus.LATE);
});

test("replacement remains limited to SUBMITTED or LATE and requires one conditional update", () => {
  assert.deepEqual(replaceableHomeworkSubmissionStatuses, [HomeworkSubmissionStatus.SUBMITTED, HomeworkSubmissionStatus.LATE]);
  for (const status of replaceableHomeworkSubmissionStatuses) {
    assert.doesNotThrow(() => assertHomeworkSubmissionReplaceable(status));
  }
  assert.equal(errorCode(() => assertHomeworkSubmissionReplaceable(HomeworkSubmissionStatus.EVALUATED)), "SUBMISSION_REVIEW_STARTED");
  assert.equal(errorCode(() => assertHomeworkSubmissionReplaceable(HomeworkSubmissionStatus.RETURNED)), "SUBMISSION_REVIEW_STARTED");
  assert.doesNotThrow(() => assertHomeworkSubmissionReplaced(1));
  assert.equal(errorCode(() => assertHomeworkSubmissionReplaced(0)), "SUBMISSION_REVIEW_STARTED");
  assert.equal(errorCode(() => assertHomeworkSubmissionReplaced(2)), "SUBMISSION_REVIEW_STARTED");
});

test("Homework upload validation preserves filename, MIME signature and five-megabyte limits", () => {
  const pdf = Buffer.from("%PDF-homework").toString("base64");
  assert.doesNotThrow(() => assertDocumentFileExtension("answer.pdf", "application/pdf"));
  assert.deepEqual(decodeVerifiedUpload(pdf, "application/pdf", 5 * 1024 * 1024), Buffer.from("%PDF-homework"));
  assert.throws(() => assertDocumentFileExtension("answer.exe", "application/pdf"), /extension does not match/);
  assert.throws(() => assertDocumentFileExtension("..\\answer.pdf", "application/pdf"), /filename is invalid/);
  assert.throws(() => decodeVerifiedUpload(Buffer.from("not a PDF").toString("base64"), "application/pdf", 5 * 1024 * 1024), /does not match/);
  assert.throws(() => decodeVerifiedUpload(Buffer.from("%PDF-oversize").toString("base64"), "application/pdf", 4), /between 1 byte and 0 MB/);
});
