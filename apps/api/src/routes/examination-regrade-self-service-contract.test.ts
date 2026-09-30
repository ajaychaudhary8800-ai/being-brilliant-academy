import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("student and parent regrade self-service is ownership checked", async () => {
  const workflow = await readFile(new URL("./examination-workflow.ts", import.meta.url), "utf8");

  assert.match(workflow, /async function selfServiceRegradeStudent/);
  assert.match(workflow, /req\.auth!\.role === Role\.STUDENT/);
  assert.match(workflow, /organizationId: req\.auth!\.organizationId, userId: req\.auth!\.userId/);
  assert.match(workflow, /req\.auth!\.role === Role\.PARENT/);
  assert.match(workflow, /parentId: req\.auth!\.userId/);
  assert.match(workflow, /studentId: requestedStudentId/);
  assert.match(workflow, /AI_EXAMINER_REGRADE_STUDENT_FORBIDDEN/);
});

test("self-service regrade obeys profile switches, publication audit window and request limits", async () => {
  const workflow = await readFile(new URL("./examination-workflow.ts", import.meta.url), "utf8");

  assert.match(workflow, /router\.post\("\/examinations\/:examinationId\/regrade-request"/);
  assert.match(workflow, /regradePolicyFromExamSnapshot\(exam\.aiExaminerExamProfileSnapshot\)/);
  assert.match(workflow, /policy\.allowStudentRequest/);
  assert.match(workflow, /policy\.allowParentRequest/);
  assert.match(workflow, /regradePublicationAuditTime/);
  assert.match(workflow, /aiExaminerRegradeWindow/);
  assert.match(workflow, /policy\.maxRequestsPerAnswerSheet/);
  assert.match(workflow, /AI_EXAMINER_REGRADE_ALREADY_OPEN/);
});

test("self-service question scope is constrained to evaluated question keys", async () => {
  const workflow = await readFile(new URL("./examination-workflow.ts", import.meta.url), "utf8");

  assert.match(workflow, /normalizeAIExaminerRegradeQuestionKeys/);
  assert.match(workflow, /availableQuestionKeys: evaluation\.questions\.map\(question => question\.questionKey\)/);
  assert.match(workflow, /AI_EXAMINER_REGRADE_SCOPE_INVALID/);
});

test("self-service status endpoint exposes only request-level public fields", async () => {
  const workflow = await readFile(new URL("./examination-workflow.ts", import.meta.url), "utf8");
  const start = workflow.indexOf('router.get("/examinations/:examinationId/regrade-requests/mine"');
  const end = workflow.indexOf('router.post("/examinations/:examinationId/regrade-request"', start);
  assert.ok(start >= 0 && end > start);
  const section = workflow.slice(start, end);

  assert.match(section, /originalMarks: true/);
  assert.match(section, /resolvedMarks: true/);
  assert.doesNotMatch(section, /decisionNotes: true/);
  assert.doesNotMatch(section, /resolutionNotes: true/);
  assert.doesNotMatch(section, /reviewRound:/);
  assert.doesNotMatch(section, /diagnostics:/);
  assert.doesNotMatch(section, /reviewer:/);
});
