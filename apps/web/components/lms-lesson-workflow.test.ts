import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/admin/lms/page.tsx", import.meta.url), "utf8");

test("LMS Lesson actions follow the backend lifecycle", () => {
  assert.match(page, /x\.status==="DRAFT"&&<button[^>]*title="Publish Lesson"[^>]*onClick=\{\(\)=>state\(x,"PUBLISHED"\)\}/);
  assert.match(page, /x\.status!=="ARCHIVED"&&<button[^>]*title="Edit Lesson"/);
  assert.match(page, /x\.status!=="ARCHIVED"&&<button[^>]*title="Archive Lesson"/);
  assert.match(page, /x\.status==="ARCHIVED"&&<button[^>]*title="Delete Lesson"/);
});

test("Lesson form does not offer a fake status editor", () => {
  assert.match(page, /Status<input[^>]*value=\{mode==="add"\?"DRAFT":form\.status\}[^>]*readOnly/);
  assert.doesNotMatch(page, /<label>Status<select/);
});
