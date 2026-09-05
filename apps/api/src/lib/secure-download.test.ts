import assert from "node:assert/strict";
import test from "node:test";
import { ExaminationStatus, HomeworkStatus, Role, StudentStatus } from "@prisma/client";
import { assertQuestionPaperAvailable, assertStudentExaminationEligible } from "./examination-policy.js";
import { assertHomeworkAttachmentAccess } from "./homework-policy.js";
import { loadAuthorizedDocument, storedDocumentBuffer, storedDocumentHeaders } from "./secure-download.js";

const homework = {
  requestOrganizationId: "org-a",
  homeworkOrganizationId: "org-a",
  homeworkStatus: HomeworkStatus.PUBLISHED,
  homeworkBatchId: "batch-a",
  homeworkTeacherId: "teacher-a",
};

const activeStudent = {
  studentOrganizationId: "org-a",
  studentBatchId: "batch-a",
  studentStatus: StudentStatus.ACTIVE,
};

const activeParentStudent = {
  parentLinked: true,
  parentStudentOrganizationId: "org-a",
  parentStudentBatchId: "batch-a",
  parentStudentStatus: StudentStatus.ACTIVE,
};

test("published homework attachments enforce student, tenant and availability boundaries", () => {
  assert.doesNotThrow(() => assertHomeworkAttachmentAccess({ ...homework, ...activeStudent, role: Role.STUDENT }));
  assert.throws(() => assertHomeworkAttachmentAccess({ ...homework, ...activeStudent, role: Role.STUDENT, studentStatus: StudentStatus.INACTIVE }), /Download access denied/);
  assert.throws(() => assertHomeworkAttachmentAccess({ ...homework, ...activeStudent, role: Role.STUDENT, studentStatus: StudentStatus.ARCHIVED }), /Download access denied/);
  assert.throws(() => assertHomeworkAttachmentAccess({ ...homework, ...activeStudent, role: Role.STUDENT, studentBatchId: "batch-b" }), /Download access denied/);
  assert.throws(() => assertHomeworkAttachmentAccess({ ...homework, ...activeStudent, role: Role.STUDENT, studentOrganizationId: "org-b" }), /Download access denied/);
  assert.throws(() => assertHomeworkAttachmentAccess({ ...homework, ...activeStudent, role: Role.STUDENT, requestOrganizationId: "org-b" }), /Download access denied/);
  assert.throws(() => assertHomeworkAttachmentAccess({ ...homework, ...activeStudent, role: Role.STUDENT, homeworkStatus: HomeworkStatus.DRAFT }), /Download access denied/);
});

test("homework attachment access preserves parent and teacher ownership", () => {
  assert.doesNotThrow(() => assertHomeworkAttachmentAccess({ ...homework, ...activeParentStudent, role: Role.PARENT }));
  assert.throws(() => assertHomeworkAttachmentAccess({ ...homework, ...activeParentStudent, role: Role.PARENT, parentLinked: false }), /Download access denied/);
  assert.throws(() => assertHomeworkAttachmentAccess({ ...homework, ...activeParentStudent, role: Role.PARENT, parentStudentStatus: StudentStatus.INACTIVE }), /Download access denied/);
  assert.throws(() => assertHomeworkAttachmentAccess({ ...homework, ...activeParentStudent, role: Role.PARENT, parentStudentStatus: StudentStatus.ARCHIVED }), /Download access denied/);
  assert.throws(() => assertHomeworkAttachmentAccess({ ...homework, ...activeParentStudent, role: Role.PARENT, parentStudentBatchId: "batch-b" }), /Download access denied/);
  assert.throws(() => assertHomeworkAttachmentAccess({ ...homework, ...activeParentStudent, role: Role.PARENT, parentStudentOrganizationId: "org-b" }), /Download access denied/);
  assert.doesNotThrow(() => assertHomeworkAttachmentAccess({ ...homework, role: Role.TEACHER, teacherId: "teacher-a" }));
  assert.throws(() => assertHomeworkAttachmentAccess({ ...homework, role: Role.TEACHER, teacherId: "teacher-b" }), /Download access denied/);
  assert.doesNotThrow(() => assertHomeworkAttachmentAccess({ ...homework, role: Role.BRANCH_ADMIN, branchAllowed: true }));
  assert.throws(() => assertHomeworkAttachmentAccess({ ...homework, role: Role.BRANCH_ADMIN, branchAllowed: false }), /Download access denied/);
  assert.doesNotThrow(() => assertHomeworkAttachmentAccess({ ...homework, role: Role.SUPER_ADMIN }));
});

test("published examination papers remain available before exam start under the existing policy", () => {
  const now = new Date("2026-09-05T08:00:00.000Z");
  const futureExamStart = new Date("2026-09-10T11:00:00.000Z");
  assert.ok(now < futureExamStart);
  const exam = { organizationId: "org-a", batchId: "batch-a", academicSessionId: "session-a" };
  assert.doesNotThrow(() => assertStudentExaminationEligible({ ...exam }, exam));
  assert.doesNotThrow(() => assertQuestionPaperAvailable(ExaminationStatus.SCHEDULED, new Date("2026-09-05T07:00:00.000Z"), now));
  assert.throws(() => assertStudentExaminationEligible({ ...exam, batchId: "batch-b" }, exam), /not assigned/);
  assert.throws(() => assertStudentExaminationEligible({ ...exam, organizationId: "org-b" }, exam), /not assigned/);
  assert.throws(() => assertQuestionPaperAvailable(ExaminationStatus.SCHEDULED, null, now), /not available yet/);
  assert.throws(() => assertQuestionPaperAvailable(ExaminationStatus.DRAFT, new Date("2026-09-05T07:00:00.000Z"), now), /not published/);
});

test("authorization completes before stored binary data is loaded", async () => {
  let loaded = false;
  await assert.rejects(() => loadAuthorizedDocument(
    () => { throw new Error("denied"); },
    async () => { loaded = true; return new Uint8Array([1]); },
  ), /denied/);
  assert.equal(loaded, false);
  const bytes = await loadAuthorizedDocument(() => undefined, async () => { loaded = true; return new Uint8Array([1]); });
  assert.equal(loaded, true);
  assert.deepEqual([...bytes], [1]);
});

test("stored answer-sheet data becomes binary Buffer without PDF or image corruption", () => {
  const pdfSource = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
  const pdf = storedDocumentBuffer(pdfSource);
  assert.equal(Buffer.isBuffer(pdf), true);
  assert.deepEqual([...pdf], [...pdfSource]);
  assert.equal(pdf.toString("ascii"), "%PDF-");
  assert.notEqual(pdf.toString("utf8"), JSON.stringify(pdfSource));

  const imageSource = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const image = storedDocumentBuffer(imageSource);
  assert.equal(Buffer.isBuffer(image), true);
  assert.deepEqual([...image], [...imageSource]);
});

test("stored document responses preserve MIME type, actual length and safe disposition", () => {
  const fileSize = storedDocumentBuffer(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])).length;
  assert.deepEqual(storedDocumentHeaders({ fileName: "paper.pdf", mimeType: "application/pdf", fileSize }, "inline"), {
    "Content-Type": "application/pdf",
    "Content-Length": "5",
    "Content-Disposition": "inline; filename=\"paper.pdf\"",
  });
  assert.deepEqual(storedDocumentHeaders({ fileName: "scan.png", mimeType: "image/png", fileSize: 8 }, "inline"), {
    "Content-Type": "image/png",
    "Content-Length": "8",
    "Content-Disposition": "inline; filename=\"scan.png\"",
  });
});

test("stored document filenames remove header controls and path components with safe fallbacks", () => {
  const disposition = (fileName: string, mimeType = "application/pdf", fallbackName = "answer-sheet") => storedDocumentHeaders({ fileName, mimeType, fileSize: 5, fallbackName }, "inline")["Content-Disposition"];
  for (const unsafe of ["\r", "\n", "\0", "\u0001", "\u001f", "\u007f", "\"", "/", "\\", ";"]) {
    const value = disposition(`answer${unsafe}sheet.pdf`);
    assert.doesNotMatch(value, /[\u0000-\u001f\u007f]/);
    assert.doesNotMatch(value, /filename="[^"]*[\\/]/);
    assert.equal((value.match(/"/g) ?? []).length, 2);
  }
  assert.equal(disposition("normal-paper.pdf"), "inline; filename=\"normal-paper.pdf\"");
  assert.equal(disposition("\r\n\0\"/\\;"), "inline; filename=\"answer-sheet.pdf\"");
  assert.equal(disposition(""), "inline; filename=\"answer-sheet.pdf\"");
  assert.equal(disposition("   "), "inline; filename=\"answer-sheet.pdf\"");
  assert.equal(disposition("../../paper.pdf"), "inline; filename=\"_paper.pdf\"");
});
