import assert from "node:assert/strict";
import { test } from "node:test";
import { flattenReport, reportCsv, reportExcel, reportPdf, reportTable } from "./analytics-export.js";

test("report export contains actual rows and escapes spreadsheet formulas", () => {
  const table = reportTable([{ name: "=SUM(1,2)", total: 12 }], ["name", "total"]);
  assert.match(reportCsv(table.columns, table.rows), /"'=SUM\(1,2\)","12"/);
  assert.match(reportExcel(["name"], [{ name: "<Teacher>" }]), /&lt;Teacher&gt;/);
});

test("report columns must be available in a populated dataset", () => {
  assert.throws(() => reportTable([{ name: "A" }], ["name", "privateField"]));
  assert.deepEqual(flattenReport({ admissions: { students: 3 } }), [{ "admissions.students": 3 }]);
});

test("PDF has a cross reference and end marker", () => {
  const pdf = reportPdf("Report", ["name"], [{ name: "Teacher" }]).toString("latin1");
  assert.match(pdf, /^%PDF-1\.4/);
  assert.match(pdf, /\(Teacher\) Tj/);
  assert.match(pdf, /startxref\n\d+\n%%EOF/);
});
