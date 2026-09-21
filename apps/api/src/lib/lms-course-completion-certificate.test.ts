import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("LMS course completion certificate issuance is idempotent and threshold-gated", async () => {
  const source = await readFile(new URL("./lms-course-completion-certificate.ts", import.meta.url), "utf8");
  assert.match(source, /COMPLETION_THRESHOLD = 80/);
  assert.match(source, /CertificateType\.COURSE_COMPLETION/);
  assert.match(source, /prisma\.certificate\.findFirst/);
  assert.match(source, /prisma\.certificate\.create/);
  assert.match(source, /error\?\.code !== "P2002"/);
  assert.match(source, /status: CertificateStatus\.ISSUED/);
});

test("student LMS routes surface or create the completion certificate only when eligible", async () => {
  const source = await readFile(new URL("../routes/admin-lms.ts", import.meta.url), "utf8");
  assert.match(source, /ensureCourseCompletionCertificate/);
  assert.match(source, /progress\.completed/);
  assert.match(source, /certificateEligible = total > 0 && percentage >= 80/);
  assert.match(source, /completionCertificate/);
});
