import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("HR administration remains tenant and branch scoped", async () => {
  const source = await readFile(new URL("./hr-payroll.ts", import.meta.url), "utf8");

  assert.match(source, /org=\(r:AuthRequest\)=>r\.auth!\.organizationId/);
  assert.match(source, /branchUser\.findMany\(\{where:\{organizationId:org\(r\),userId:uid\(r\)\}/);
  assert.match(source, /employeeAccess\(r:AuthRequest,id:string\)/);
  assert.match(source, /if\(q\.branchId\)await access\(r,q\.branchId\)/);
  assert.match(source, /employee\.findMany\(\{where:\{organizationId:org\(r\)/);
  assert.match(source, /payrollRun\.findMany\(\{where:\{organizationId:org\(r\)/);
  assert.match(source, /auditLog\.findMany\(\{where/);
  assert.match(source, /where=\{organizationId:org\(r\),\.\.\.\(q\.search/);
});

test("HR child records are explicitly stamped with organization ownership", async () => {
  const source = await readFile(new URL("./hr-payroll.ts", import.meta.url), "utf8");

  for (const pattern of [
    /employeeMovement\.create\(\{data:\{organizationId:org\(r\)/,
    /employeeDocument\.create\(\{data:\{[^}]*organizationId:org\(r\)/,
    /recruitmentCandidate\.create\(\{data:\{\.\.\.d,organizationId:org\(r\)\}/,
    /hrHoliday\.create\(\{data:\{\.\.\.d,organizationId:org\(r\)/,
    /salaryStructure\.create\(\{data:\{\.\.\.d,organizationId:org\(r\)/,
    /payslip\.create\(\{data:\{organizationId:org\(r\)/,
    /payrollComponent\.createMany\(\{data:cs\.map\(x=>\(\{\.\.\.x,organizationId:org\(r\)/,
  ]) assert.match(source, pattern);
});

test("HR document and payroll reads require tenant ownership before branch or self access", async () => {
  const source = await readFile(new URL("./hr-payroll.ts", import.meta.url), "utf8");

  assert.match(source, /employeeDocument\.findFirst\(\{where:\{organizationId:org\(r\),id:String\(r\.params\.id\)\}/);
  assert.match(source, /taxDocument\.findFirst\(\{where:\{organizationId:org\(r\),id:String\(r\.params\.id\)\}/);
  assert.match(source, /payslip\.findFirst\(\{where:\{organizationId:org\(r\),id:String\(r\.params\.id\)\}/);
  assert.match(source, /payrollRun\.findFirst\(\{where:\{organizationId:org\(r\),id:String\(r\.params\.id\)\}/);
});
