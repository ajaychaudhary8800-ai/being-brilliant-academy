import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("tenant generated documents and notifications do not hard-code Being Brilliant branding", async () => {
  const [certificates, students, completion, premium] = await Promise.all([
    readFile(new URL("../routes/admin-certificates.ts", import.meta.url), "utf8"),
    readFile(new URL("../routes/admin-students.ts", import.meta.url), "utf8"),
    readFile(new URL("./lms-course-completion-certificate.ts", import.meta.url), "utf8"),
    readFile(new URL("../routes/premium-experience.ts", import.meta.url), "utf8"),
  ]);

  for (const source of [certificates, students, completion, premium]) {
    assert.match(source, /loadTenantDocumentIdentity/);
  }

  assert.doesNotMatch(certificates, /BEING BRILLIANT ACADEMY|BBA-CERT/);
  assert.doesNotMatch(students, /BEING BRILLIANT ACADEMY - STUDENT DIRECTORY/);
  assert.doesNotMatch(completion, /BBA-COURSE/);
  assert.doesNotMatch(premium, /Your Being Brilliant family/);
  assert.match(certificates, /brand\.certificatePrefix/);
  assert.match(completion, /brand\.certificatePrefix/);
});
