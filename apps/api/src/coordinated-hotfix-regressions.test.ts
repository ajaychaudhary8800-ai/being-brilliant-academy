import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("branch creation provisions a branch admin and setup email", async () => {
  const route = await readFile(new URL("./routes/admin.ts", import.meta.url), "utf8");
  assert.match(route, /Role\.BRANCH_ADMIN/);
  assert.match(route, /branchUser\.create/);
  assert.match(route, /issueAccountSetup/);
  assert.match(route, /Only a Super Admin can create a branch/);
});

test("HR and finance imports accept bounded spreadsheet uploads", async () => {
  const [hr, finance] = await Promise.all([readFile(new URL("./routes/hr-payroll.ts", import.meta.url), "utf8"), readFile(new URL("./routes/finance.ts", import.meta.url), "utf8")]);
  assert.match(hr, /parseSpreadsheetUpload/);
  assert.match(hr, /prisma\.\$transaction/);
  assert.match(finance, /parseSpreadsheetUpload/);
  assert.match(finance, /INVALID_IMPORT_ROW/);
});

test("refresh rotation preserves remembered-session duration", async () => {
  const auth = await readFile(new URL("./routes/auth.ts", import.meta.url), "utf8");
  assert.match(auth, /rememberMe = session\.expiresAt/);
  assert.match(auth, /issueSession\(session\.user, rememberMe\)/);
});

test("student CSV import uses the shared parser and resolves branch and batch references", async () => {
  const students = await readFile(new URL("./routes/admin-students.ts", import.meta.url), "utf8");
  assert.match(students, /parseSpreadsheetUpload/);
  assert.match(students, /normalizedSpreadsheetRow/);
  assert.match(students, /branchCode/);
  assert.match(students, /batchReference/);
  assert.match(students, /optionalStudentImportText/);
});
