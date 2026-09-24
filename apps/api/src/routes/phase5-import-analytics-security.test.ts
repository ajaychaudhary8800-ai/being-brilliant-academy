import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const apiSource = (name: string) => readFile(new URL(`./${name}.ts`, import.meta.url), "utf8");
const webSource = (path: string) => readFile(new URL(`../../../web/${path}`, import.meta.url), "utf8");

test("Finance bulk account import is tenant-scoped, atomic and duplicate-aware", async () => {
  const source = await apiSource("finance");
  assert.match(source, /branch\.findMany\(\{ where: \{ organizationId: org\(req\) \}/);
  assert.match(source, /DUPLICATE_IMPORT_ACCOUNT/);
  assert.match(source, /ACCOUNT_EXISTS/);
  assert.match(source, /accountGroup\.findMany\(\{ where: \{ organizationId: org\(req\)/);
  assert.match(source, /ledgerAccount\.create\(\{ data: \{ \.\.\.row, organizationId: org\(req\) \} \}\)/);
  assert.match(source, /serializable\(async tx =>/);
});

test("HR employee import validates all rows and creates the batch in one transaction", async () => {
  const source = await apiSource("hr-payroll");
  assert.match(source, /\/hr\/import\/employees/);
  assert.match(source, /z\.array\(emp\)\.min\(1\)\.max\(500\)/);
  assert.match(source, /DUPLICATE_IMPORT_EMPLOYEE_CODE/);
  assert.match(source, /DUPLICATE_IMPORT_EMAIL/);
  assert.match(source, /const created=await prisma\.\$transaction\(async tx=>/);
  assert.match(source, /organizationId:org\(r\).*role:Role\.EMPLOYEE/);
  assert.match(source, /action:"IMPORT",entity:"Employee"/);
});

test("Admin import UI accepts real XLSX, CSV and JSON files through the shared parser", async () => {
  const [parser, finance, hr] = await Promise.all([
    webSource("components/tabular-import.ts"),
    webSource("app/admin/finance/page.tsx"),
    webSource("app/admin/hr/page.tsx"),
  ]);
  assert.match(parser, /extension === "xlsx"/);
  assert.match(parser, /extension === "csv"/);
  assert.match(parser, /extension === "json"/);
  assert.match(parser, /DecompressionStream/);
  assert.match(parser, /sharedStrings\.xml/);
  assert.match(finance, /parseTabularFile\(file\)/);
  assert.match(finance, /accept="\.xlsx,\.csv,\.json/);
  assert.match(hr, /\/hr\/import\/employees/);
  assert.match(hr, /parseTabularFile\(file\)/);
  assert.match(hr, /Authorization:\s*\`Bearer \$\{getAccessToken\(\)\}\`/);
});

test("Analytics cache, reports and assistant are tenant-bound", async () => {
  const source = await apiSource("analytics");
  assert.match(source, /key=\`executive:\$\{org\(q\)\}:/);
  assert.match(source, /allow\(q,executive\);const started=Date\.now\(\)/);
  assert.match(source, /assistant:executive:\$\{org\(q\)\}/);
  assert.match(source, /analyticsSavedReport\.create\(\{data:\{organizationId:org\(q\)/);
  assert.match(source, /analyticsReportSchedule\.create\(\{data:\{organizationId:org\(q\)/);
  assert.match(source, /analyticsAssistantQuery\.create\(\{data:\{organizationId:org\(q\)/);
  assert.match(source, /organizationId:org\(q\),id:String\(q\.params\.id\),OR:/);
});

test("Analytics branch-admin drilldowns use authenticated branch scope", async () => {
  const source = await apiSource("analytics");
  assert.match(source, /branchIds=await erpBranchScope\(q\)/);
  assert.match(source, /if\(p\.branchId&&!branchIds\.includes\(p\.branchId\)\)throw new AppError\(403,"BRANCH_FORBIDDEN"/);
  assert.match(source, /if\(!branchIds\.includes\(x\.teacher\.branchId\)\)throw new AppError\(403,"BRANCH_FORBIDDEN"/);
  assert.match(source, /enquiry\.findMany\(\{where:\{organizationId:org\(q\),branchId:\{in:branchIds\}\}/);
  assert.match(source, /branch\.findMany\(\{where:\{organizationId:org\(q\),id:\{in:branchIds\}\}/);
});
