import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = new URL("./learning-ecosystem.ts", import.meta.url);
const webRoot = new URL("../../../web/", import.meta.url);

async function web(path: string) {
  return readFile(new URL(path, webRoot), "utf8");
}

test("manager dashboard accepts only authorized explicit student learning-plan targets", async () => {
  const source = await readFile(route, "utf8");
  const start = source.indexOf('router.get("/learning/dashboard"');
  const end = source.indexOf('const doubtInput', start);
  const dashboard = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(dashboard, /userId: id\.optional\(\)/);
  assert.match(dashboard, /assertStudentTargetAccess\(actor, query\.userId\)/);
  assert.match(dashboard, /query\.userId \? \[query\.userId\] : undefined/);
  assert.match(dashboard, /query\.userId \? \{ studentId: query\.userId \}/);
});

test("assessment workflow exposes explicit downloads for papers and submitted answers", async () => {
  const source = await web("components/examination-workflow.tsx");
  assert.match(source, /Download Paper/);
  assert.match(source, /Download Answer Sheet/);
  assert.match(source, /answer-sheets\/\$\{sheet\.id\}\/file/);
  assert.match(source, /When students submit answers/);
});

test("academic operations is a complete operational workspace instead of a sparse form", async () => {
  const source = await web("app/admin/academic-operations/page.tsx");
  for (const expected of [
    "Available teachers",
    "Active timetables",
    "Assigned substitutions",
    "Configured periods",
    "No workload calculated yet",
    "Substitution history",
    "Save {pretty(day)} configuration",
  ]) assert.ok(source.includes(expected), expected);
  assert.match(source, /checked=\{period\.isActive\}/);
});
