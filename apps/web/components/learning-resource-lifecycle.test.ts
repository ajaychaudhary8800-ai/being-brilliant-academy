import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./learning-ecosystem-workspace.tsx", import.meta.url), "utf8");

test("manager Study Material cards expose edit, publish and soft archive", () => {
  assert.match(source, /setEditingResource\(x\);setForm\("materials"\)/);
  assert.match(source, /"Material published"/);
  assert.match(source, /call\("\/learning\/materials\/"\+x\.id,\{method:"DELETE"\}\)/);
  assert.match(source, /"Material archived"/);
});

test("Study Material form supports edit and file-or-external-url workflows", () => {
  assert.match(source, /function Material\(\{options,initial,save\}/);
  assert.match(source, /External HTTPS URL \(optional\)/);
  assert.match(source, /Replacement file \(optional when editing\)/);
  assert.match(source, /editingResource\?"\/learning\/materials\/"\+editingResource\.id:"\/learning\/materials"/);
});

test("manager Live Class cards expose edit, publish and terminal archive", () => {
  assert.match(source, /setEditingResource\(x\);setForm\("live-classes"\)/);
  assert.match(source, /"Live class published"/);
  assert.match(source, /approvalStatus/); // Question Bank lifecycle remains composed into this workspace.
  assert.match(source, /"Live class archived"/);
  assert.match(source, /x\.status!=="ARCHIVED"&&<button[^>]*onClick=\{\(\)=>\{setEditingResource\(x\);setForm\("live-classes"\)\}\}/);
});

test("Live Class form preserves local datetime editing and does not offer archived on create", () => {
  assert.match(source, /const localDateTime=/);
  assert.match(source, /initial&&<option>ARCHIVED<\/option>/);
  assert.match(source, /editingResource\?"\/learning\/live-classes\/"\+editingResource\.id:"\/learning\/live-classes"/);
});


test("published Live Classes expose an operational start action and Jitsi room generation", () => {
  assert.match(source, /Start \/ Open Class/);
  assert.match(source, /openLiveClass/);
  assert.match(source, /Generate Jitsi Room/);
  assert.match(source, /https:\/\/meet\.jit\.si\//);
});
