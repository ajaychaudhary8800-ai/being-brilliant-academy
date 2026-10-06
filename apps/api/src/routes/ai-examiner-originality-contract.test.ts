import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("originality endpoint is examination-manager scoped and uses approved evaluation text", async () => {
  const routes = await readFile(new URL("./ai-examiner.ts", import.meta.url), "utf8");
  const start = routes.indexOf('router.get("/examinations/:examinationId/originality"');
  assert.ok(start >= 0);
  const section = routes.slice(start, start + 7000);

  assert.match(section, /await examinationForManager\(req, examinationId\)/);
  assert.match(section, /status: AIExaminerEvaluationStatus\.APPROVED/);
  assert.match(section, /organizationId: req\.auth!\.organizationId/);
  assert.match(section, /latestBySheet/);
  assert.match(section, /analyzeAIExaminerOriginality/);
  assert.match(section, /AI_EXAMINER_ORIGINALITY_ANALYZED/);
});

test("originality signals are not persisted as misconduct findings", async () => {
  const routes = await readFile(new URL("./ai-examiner.ts", import.meta.url), "utf8");
  const start = routes.indexOf('router.get("/examinations/:examinationId/originality"');
  const end = routes.indexOf('router.get("/capabilities"', start);
  const section = routes.slice(start, end);

  assert.doesNotMatch(section, /PLAGIARISM_CONFIRMED/);
  assert.doesNotMatch(section, /MISCONDUCT_CONFIRMED/);
  assert.doesNotMatch(section, /disciplin/i);
  assert.match(section, /signalCount/);
});
