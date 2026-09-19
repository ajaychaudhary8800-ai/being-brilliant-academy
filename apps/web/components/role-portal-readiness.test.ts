import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("all seven product roles have a supported login destination", () => {
  const provider = read("./auth-provider.tsx");
  const portalAuth = read("./portal-auth.tsx");
  const loginRoute = read("../app/login/[portal]/page.tsx");
  const forgotRoute = read("../app/forgot-password/[portal]/page.tsx");

  assert.match(provider, /"SUPER_ADMIN" \| "BRANCH_ADMIN" \| "ACCOUNTANT" \| "TEACHER" \| "STUDENT" \| "PARENT" \| "EMPLOYEE"/);
  assert.match(provider, /AuthPortal = "student" \| "parent" \| "teacher" \| "employee" \| "admin"/);

  assert.match(portalAuth, /student: \{[\s\S]*?roles: \["STUDENT"\]/);
  assert.match(portalAuth, /parent: \{[\s\S]*?roles: \["PARENT"\]/);
  assert.match(portalAuth, /teacher: \{[\s\S]*?roles: \["TEACHER"\]/);
  assert.match(portalAuth, /employee: \{[\s\S]*?dashboard: "\/employee"[\s\S]*?roles: \["EMPLOYEE"\]/);
  assert.match(portalAuth, /admin: \{[\s\S]*?roles: \["SUPER_ADMIN", "BRANCH_ADMIN", "ACCOUNTANT"\]/);
  assert.match(portalAuth, /user\.role === "ACCOUNTANT" \? "\/admin\/finance" : portal\.dashboard/);

  assert.match(loginRoute, /"student", "parent", "teacher", "employee", "admin"/);
  assert.match(forgotRoute, /"student", "parent", "teacher", "employee", "admin"/);
});

test("employee protected downloads use authenticated document delivery", () => {
  const employee = read("../app/employee/page.tsx");
  assert.match(employee, /openAuthenticatedDocument/);
  assert.match(employee, /\/hr\/payslips\/\$\{item\.id\}\/pdf/);
  assert.match(employee, /\/hr\/documents\/\$\{item\.id\}\/download/);
  assert.match(employee, /\/hr\/tax-documents\/\$\{item\.id\}\/download/);
  assert.doesNotMatch(employee, /<a[^>]+href=\{.*\/hr\/payslips/);
});
