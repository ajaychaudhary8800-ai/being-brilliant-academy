import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (name: string) => readFile(new URL(`./${name}.ts`, import.meta.url), "utf8");

test("shared ERP branch scope constrains Super Admin to active branches in the authenticated organization", async () => {
  const source = await readFile(new URL("../lib/erp-branch-access.ts", import.meta.url), "utf8");
  assert.match(source, /role === Role\.SUPER_ADMIN[^]*prisma\.branch\.findMany\(\{[^]*organizationId[^]*isActive: true/);
  assert.match(source, /branch:\s*\{ organizationId, isActive: true \}/);
  assert.doesNotMatch(source, /Role\.SUPER_ADMIN\) return null/);
});

test("transport operational masters and child writes are tenant-owned", async () => {
  const source = await read("transport");
  assert.match(source, /transportVehicleType\.findMany\(\{where:\{organizationId:org\(q\)\}\}/);
  assert.match(source, /transportVehicleType\.findFirst\(\{where:\{organizationId:org\(q\),id:/);
  assert.match(source, /transportVehicle\.create\(\{data:\{\.\.\.d,organizationId:org\(q\)\}\}/);
  assert.match(source, /transportVehicleDocument\.create\(\{data:\{[^}]*organizationId:org\(q\)/);
  assert.match(source, /transportTrip\.create\(\{data:\{\.\.\.d,organizationId:org\(q\)\}\}/);
  assert.match(source, /transportFeePayment\.create\(\{data:\{organizationId:org\(q\)/);
});

test("library masters, membership identity, downloads and imports are tenant-bound", async () => {
  const source = await read("library");
  assert.match(source, /libraryCategory\.findMany\(\{where:\{organizationId:org\(q\)\}/);
  assert.match(source, /user\.findFirst\(\{where:\{organizationId,id:userId\}/);
  assert.match(source, /libraryDigitalResource\.findFirst\(\{where:\{organizationId:org\(q\),id:String\(q\.params\.id\)\}/);
  assert.match(source, /libraryBook\.create\(\{data:\{\.\.\.head,organizationId:org\(q\),authors:/);
  assert.match(source, /libraryStockVerification\.create\(\{data:\{organizationId:org\(q\)/);
});

test("hostel masters and lifecycle writes are tenant-owned", async () => {
  const source = await read("hostel");
  assert.match(source, /hostel\.create\(\{data:\{\.\.\.d,organizationId:org\(q\)\}\}/);
  assert.match(source, /hostelRoomType\.findFirst\(\{where:\{organizationId:org\(q\),id:/);
  assert.match(source, /hostelAllocation\.create\(\{data:\{\.\.\.d,organizationId:org\(q\)/);
  assert.match(source, /hostelFeePayment\.create\(\{data:\{organizationId:org\(q\)/);
  assert.match(source, /hostelRoom\.create\(\{data:\{\.\.\.data,organizationId:org\(q\)\}\}/);
});

test("inventory masters, audit logs and cross-module recipient resolution are tenant-bound", async () => {
  const source = await read("inventory");
  assert.match(source, /auditLog\.create\(\{data:\{organizationId:org\(q\)/);
  assert.match(source, /inventoryItem\.count\(\{where:\{organizationId:org\(q\),isArchived:false\}\}/);
  assert.match(source, /inventoryItemCategory\.findFirst\(\{where:\{organizationId,id:categoryId\}/);
  assert.match(source, /issuedRecipientBranch\(organizationId:string,module:string,recipientId:string\)/);
  assert.match(source, /ledgerAccount\.findFirst\(\{where:\{organizationId,id:recipientId\}/);
  assert.match(source, /inventoryStockMovement\.create\(\{data:\{\.\.\.d,organizationId:org\(q\)/);
  assert.match(source, /assetMaintenanceTicket\.create\(\{data:\{\.\.\.d,organizationId:org\(q\)/);
});
