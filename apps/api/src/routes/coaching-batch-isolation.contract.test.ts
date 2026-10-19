import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const batches = await readFile(new URL("./admin-batches.ts", import.meta.url), "utf8");
const session = await readFile(new URL("../lib/academic-session.ts", import.meta.url), "utf8");

test("coaching batch routes limit even super-admin reads and writes to their institution", () => {
  assert.match(batches, /async function access\(req:AuthRequest,branchId:string\)/);
  assert.match(batches, /prisma\.branch\.findFirst\(\{where:\{id:branchId,organizationId:req\.auth!\.organizationId\}/);
  assert.match(batches, /INSTITUTION_BRANCH_FORBIDDEN/);
  assert.match(batches, /const where=\{branch:\{organizationId:req\.auth!\.organizationId\}/);
  assert.match(batches, /prisma\.batch\.findFirst\(\{ where: \{ id, branch:\{organizationId:req\.auth!\.organizationId\} \}/);
  assert.match(batches, /batch\.create\(\{data:\{\.\.\.data,\.\.\.session,organizationId:req\.auth!\.organizationId\}/);
  assert.match(batches, /batch\.update\(\{where:\{id:old\.id\},data:\{\.\.\.data,\.\.\.session,organizationId:req\.auth!\.organizationId\}/);
});

test("coaching batch academic session selection cannot borrow a different institution's session", () => {
  assert.match(session, /resolveAcademicSession\(name: string, organizationId\?: string\)/);
  assert.match(session, /organizationId \? \{ organizationId \} : \{\}/);
  assert.match(batches, /resolveAcademicSession\(data\.academicSession,req\.auth!\.organizationId\)/);
  assert.match(batches, /name: String\(body\.academicSession\)\.trim\(\), organizationId:req\.auth!\.organizationId/);
});
