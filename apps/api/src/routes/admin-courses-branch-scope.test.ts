import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./admin-courses.ts", import.meta.url), "utf8");

test("branch admins cannot mutate organization-wide courses", () => {
  assert.match(source, /async function writeScope/);
  assert.match(source, /BRANCH_SCOPE_REQUIRED/);
  assert.match(source, /await writeScope\(req, data\.branchId\)/);
  assert.match(source, /await writeScope\(req, old\.branchId\)/);
  assert.match(source, /await writeScope\(req, existing\.branchId\)/);
  assert.match(source, /await writeScope\(req, course\.branchId\)/);
});

test("branch administrators cannot create shared courses through the POST create route", () => {
  const handlerStart = source.indexOf('router.post("/courses"');
  const nextHandler = source.indexOf('router.patch("/courses/:id"', handlerStart);
  assert.ok(handlerStart >= 0 && nextHandler > handlerStart);
  const createHandler = source.slice(handlerStart, nextHandler);
  assert.match(createHandler, /await writeScope\(req, data\.branchId\)/);
  assert.doesNotMatch(createHandler, /await scope\(req, data\.branchId\)/);
});

test("branch course catalog returns no entries without branch assignments", () => {
  const handlerStart = source.indexOf('router.get("/courses"');
  const nextHandler = source.indexOf('router.get("/courses/:id"', handlerStart);
  assert.ok(handlerStart >= 0 && nextHandler > handlerStart);
  const listHandler = source.slice(handlerStart, nextHandler);
  assert.match(listHandler, /ids && ids\.length === 0/);
  assert.match(listHandler, /readCourseSelect\(visibleBranchIds\)/);
  const helperStart = source.indexOf("function readCourseSelect");
  const helperEnd = source.indexOf("async function scope", helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const helper = source.slice(helperStart, helperEnd);
  assert.match(helper, /enrollments: \{ where:/);
  assert.match(helper, /batches: \{ where:/);
});

test("course detail also filters campus-level student and batch aggregate counts", () => {
  const start = source.indexOf('router.get("/courses/:id"');
  const stop = source.indexOf('router.post("/courses"', start);
  assert.ok(start >= 0 && stop > start);
  const detail = source.slice(start, stop);
  assert.match(detail, /await writeScope\(req, data\.branchId\)/);
  assert.match(detail, /readCourseSelect\(assigned \?\? \[\]\)/);
  assert.match(source, /batches: \{ where: \{ branchId: \{ in:/);
});
