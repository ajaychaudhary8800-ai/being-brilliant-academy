import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("enquiry CRM routes remain organization-scoped", async () => {
  const source = await readFile(new URL("./admin-enquiries.ts", import.meta.url), "utf8");

  assert.match(source, /where:\{organizationId:req\.auth!\.organizationId,\.\.\.\(ids\?/);
  assert.match(source, /findFirst\(\{where:\{organizationId:req\.auth!\.organizationId,id:String\(req\.params\.id\)\}/);
  assert.match(source, /where:\{organizationId:req\.auth!\.organizationId,status:\{notIn:/);
  assert.match(source, /organizationId:req\.auth!\.organizationId,enquiryId:old\.id/);
  assert.match(source, /organizationId:req\.auth!\.organizationId,enquiryNumber/);
  assert.match(source, /where:\{organizationId:req\.auth!\.organizationId,userId:req\.auth!\.userId\}/);
  assert.doesNotMatch(source, /prisma\.enquiry\.findUnique\(\{where:\{id:String\(req\.params\.id\)\}/);
});

test("enquiry related branch, course and counsellor validation is tenant-bound", async () => {
  const source = await readFile(new URL("./admin-enquiries.ts", import.meta.url), "utf8");

  assert.match(source, /prisma\.branch\.findFirst\(\{where:\{organizationId,id:x\.branchId\}/);
  assert.match(source, /prisma\.course\.findFirst\(\{where:\{organizationId,id:x\.courseId\}/);
  assert.match(source, /prisma\.user\.findFirst\(\{where:\{organizationId,id:x\.counsellorId\}/);
});
