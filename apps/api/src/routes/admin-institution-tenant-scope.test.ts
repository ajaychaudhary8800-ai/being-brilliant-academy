import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sessions = readFileSync(new URL("./admin-academic-sessions.ts", import.meta.url), "utf8");
const catalogs = readFileSync(new URL("./admin-education-masters.ts", import.meta.url), "utf8");

function routeSection(source: string, path: string, method: "get" | "post" | "patch" | "delete") {
  const needle = `router.${method}("${path}"`;
  const start = source.indexOf(needle);
  assert.ok(start >= 0, `Missing route ${needle}`);
  const next = source.indexOf("router.", start + needle.length);
  return source.slice(start, next < 0 ? undefined : next);
}

test("academic-session catalogue, current selection and detail reads explicitly bind the authenticated tenant", () => {
  const listing = routeSection(sessions, "/academic-sessions", "get");
  const current = routeSection(sessions, "/academic-sessions/current", "get");
  const detail = routeSection(sessions, "/academic-sessions/:id", "get");
  for (const source of [listing, current, detail]) {
    assert.match(source, /organizationId:req\.auth!\.organizationId/);
  }
  assert.match(listing, /prisma\.academicSession\.count\(\{where\}\)/);
  assert.match(current, /isCurrent:true/);
  assert.match(detail, /prisma\.academicSession\.findFirst/);
});

test("academic-session duplicate names and all id-based mutations stay within the institution", () => {
  for (const [method, route] of [
    ["post", "/academic-sessions"],
    ["patch", "/academic-sessions/:id"],
    ["patch", "/academic-sessions/:id/archive"],
    ["patch", "/academic-sessions/:id/current"],
    ["delete", "/academic-sessions/:id"],
  ] as const) {
    assert.match(routeSection(sessions, route, method), /organizationId:req\.auth!\.organizationId/);
  }
  assert.match(sessions, /organizationId_id:\{organizationId:req\.auth!\.organizationId,id:old\.id\}/);
  assert.match(sessions, /organizationId_id:\{organizationId:req\.auth!\.organizationId,id:x\.id\}/);
  assert.match(sessions, /updateMany\(\{where:\{organizationId:req\.auth!\.organizationId,isCurrent:true\}/);
  for (const model of ["batch", "studentProfile", "examination", "timetable"]) {
    assert.ok(sessions.includes(`tx.${model}.updateMany({where:{organizationId:req.auth!.organizationId,academicSessionId:old.id}`));
  }
  assert.doesNotMatch(sessions, /academicSession\.findUnique\(\{where:\{id:/);
});

test("education master list cannot expose other organizations even with includeInactive=true", () => {
  const listing = routeSection(catalogs, "/education-masters", "get");
  assert.match(listing, /where = \{ organizationId: req\.auth!\.organizationId, /);
  assert.match(listing, /includeInactive \? \{\} : \{ status: MasterStatus\.ACTIVE \}/);
  for (const model of ["competitiveExam", "skillCategory", "specialization"]) {
    assert.match(listing, new RegExp(`prisma\\.${model}\\.findMany\\(\\{ where`));
  }
});

test("education master edits check target tenant before writes, including parent category selectors", () => {
  for (const [model, key] of [
    ["competitiveExam", "examId"],
    ["skillCategory", "skillId"],
    ["specialization", "specializationId"],
  ]) {
    assert.match(catalogs, new RegExp(`prisma\\.${model}\\.findFirst\\(\\{ where: \\{ id: ${key}, organizationId: req\\.auth!\\.organizationId`));
    assert.match(catalogs, new RegExp(`prisma\\.${model}\\.update\\(\\{ where: \\{ organizationId_id: \\{ organizationId: req\\.auth!\\.organizationId, id: ${key} \\}`));
  }
  assert.match(catalogs, /prisma\.skillCategory\.findFirst\(\{ where: \{ id: input\.parentId, organizationId: req\.auth!\.organizationId \}/);
  assert.match(catalogs, /course\.count\(\{ where: \{ organizationId: req\.auth!\.organizationId, competitiveExamId: examId \}/);
  assert.match(catalogs, /course\.count\(\{ where: \{ organizationId: req\.auth!\.organizationId, skillCategoryId: skillId \}/);
  assert.doesNotMatch(catalogs, /prisma\.(?:competitiveExam|skillCategory|specialization)\.findUnique\(\{ where: \{ id:/);
});

test("institution master audit records preserve tenant provenance", () => {
  assert.match(sessions, /organizationId:r\.auth!\.organizationId,actorId/);
  assert.match(catalogs, /organizationId: req\.auth!\.organizationId, actorId/);
});
