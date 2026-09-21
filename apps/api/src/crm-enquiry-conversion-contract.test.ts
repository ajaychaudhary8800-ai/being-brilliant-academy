import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("CRM conversion requires real student demographics and never fabricates them", async () => {
  const [route, page] = await Promise.all([
    readFile(new URL("./routes/admin-enquiries.ts", import.meta.url), "utf8"),
    readFile(new URL("../../web/app/admin/enquiries/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(route, /dateOfBirth:z\.coerce\.date\(\)/);
  assert.match(route, /gender:z\.nativeEnum\(Gender\)/);
  assert.match(route, /fatherName:z\.string\(\).*\.min\(2\)/);
  assert.match(route, /motherName:z\.string\(\).*\.min\(2\)/);
  assert.match(route, /address:z\.string\(\).*\.min\(5\)/);
  assert.match(route, /gender:data\.gender/);
  assert.match(route, /dateOfBirth:data\.dateOfBirth/);
  assert.match(route, /fatherName:data\.fatherName/);
  assert.match(route, /motherName:data\.motherName/);
  assert.match(route, /address:data\.address/);
  assert.doesNotMatch(route, /new Date\("2000-01-01"\)/);
  assert.doesNotMatch(route, /gender:"OTHER"/);
  assert.doesNotMatch(route, /motherName:"Not provided"/);

  for (const field of ["dateOfBirth", "gender", "fatherName", "motherName", "address"]) {
    assert.match(page, new RegExp(`name="${field}"`));
  }
  assert.match(page, /Confirm the student&apos;s real admission and demographic details/);
});
