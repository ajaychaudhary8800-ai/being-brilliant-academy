import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("platform implementation kit is exposed only as a platform navigation workspace", async () => {
  const [page, sidebar, organizations] = await Promise.all([
    readFile(new URL("../../../web/app/admin/implementation-kit/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../web/components/sidebar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../web/app/admin/organizations/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /Client Implementation Kit/);
  assert.match(page, /user\.organizationId === "org_default"/);
  assert.match(page, /Direct import/);
  assert.match(page, /Collection \/ mapping/);
  assert.match(page, /100% · READY/);
  assert.match(page, /P1 Critical/);
  assert.match(page, /Do not promise off-site disaster recovery/);
  assert.match(sidebar, /Implementation Kit".*\/admin\/implementation-kit.*platformOnly: true/);
  assert.match(organizations, /href="\/admin\/implementation-kit"/);
});

test("client kit publishes the supported data templates with explicit import contracts", async () => {
  const [
    client,
    students,
    teachers,
    employees,
    courses,
    fees,
    finance,
  ] = await Promise.all([
    readFile(new URL("../../../web/public/client-kit/client-information.csv", import.meta.url), "utf8"),
    readFile(new URL("../../../web/public/client-kit/students-import.csv", import.meta.url), "utf8"),
    readFile(new URL("../../../web/public/client-kit/teachers-data-collection.csv", import.meta.url), "utf8"),
    readFile(new URL("../../../web/public/client-kit/employees-import.csv", import.meta.url), "utf8"),
    readFile(new URL("../../../web/public/client-kit/courses-data-collection.csv", import.meta.url), "utf8"),
    readFile(new URL("../../../web/public/client-kit/fees-data-collection.csv", import.meta.url), "utf8"),
    readFile(new URL("../../../web/public/client-kit/finance-accounts-import.csv", import.meta.url), "utf8"),
  ]);

  assert.match(client, /^organizationName,legalName,email,phone,/);
  assert.match(students, /^admissionNo,rollNo,name,gender,dateOfBirth,/);
  assert.match(students, /branchId,batchId,academicSession,admissionDate/);
  assert.match(employees, /^employeeCode,name,email,phone,password,branchId,departmentId,designationId,/);
  assert.match(finance, /^branchId,groupId,code,name,type,openingDebitPaise,openingCreditPaise,/);
  assert.match(teachers, /^employeeNo,name,email,mobile,qualification,specialization,branchName,/);
  assert.match(courses, /^title,courseCode,categoryType,classLevel,academicBoard,/);
  assert.match(fees, /^planCode,planName,academicSession,branchName,courseName,batchName,/);
});

test("student migration now uses the shared safe tabular parser", async () => {
  const page = await readFile(new URL("../../../web/app/admin/students/page.tsx", import.meta.url), "utf8");
  assert.match(page, /parseTabularFile/);
  assert.match(page, /accept="\.xlsx,\.csv,\.json"/);
  assert.match(page, /\/admin\/students\/import/);
  assert.doesNotMatch(page, /split\(\/\\r\?\\n\//);
});

test("implementation runbook distinguishes current capability from contractual promises", async () => {
  const runbook = await readFile(new URL("../../../docs/CLIENT_IMPLEMENTATION_KIT.md", import.meta.url), "utf8");
  assert.match(runbook, /Direct-import compatible/);
  assert.match(runbook, /Collection\/mapping templates/);
  assert.match(runbook, /Do not tell clients these are direct-import files/);
  assert.match(runbook, /Do not promise SLA times that are not in the signed agreement/);
  assert.match(runbook, /Do not promise off-site disaster recovery until off-site object storage is configured/);
  assert.match(runbook, /100% \/ READY/);
});
