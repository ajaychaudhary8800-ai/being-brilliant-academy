import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("bulk scan schema records batches and per-page routing without plaintext barcode secrets", async () => {
  const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  assert.match(schema, /model AIExaminerScanBatch \{/);
  assert.match(schema, /model AIExaminerScanBatchPage \{/);
  const start = schema.indexOf("model AIExaminerScanBatchPage {");
  const end = schema.indexOf("\n}", start);
  const model = schema.slice(start, end);
  assert.doesNotMatch(model, /barcodeToken/);
  assert.match(model, /routedScanPageId\s+String\?/);
  assert.match(model, /issueCodes\s+String\[\]/);
});

test("bulk scan intake resolves barcode by SHA-256 hash and never stores raw token", async () => {
  const routes = await readFile(new URL("./ai-examiner.ts", import.meta.url), "utf8");
  const start = routes.indexOf('router.post("/examinations/:examinationId/scan-batches"');
  const end = routes.indexOf('router.get("/examinations/:examinationId/scan-batches"', start);
  assert.ok(start >= 0 && end > start);
  const section = routes.slice(start, end);
  assert.match(section, /hashAIExaminerScanToken\(source\.barcodeToken\)/);
  assert.match(section, /tokenHash/);
  assert.match(section, /barcodeToken: "\[redacted\]"/);
  assert.doesNotMatch(section, /barcodeToken:\s*source\.barcodeToken/);
});

test("bulk scan intake reuses OMR validator and quarantines invalid pages", async () => {
  const routes = await readFile(new URL("./ai-examiner.ts", import.meta.url), "utf8");
  const start = routes.indexOf('router.post("/examinations/:examinationId/scan-batches"');
  const end = routes.indexOf('router.get("/examinations/:examinationId/scan-batches"', start);
  const section = routes.slice(start, end);
  assert.match(section, /validateAIExaminerOmrIngestion/);
  assert.match(section, /AIExaminerScanBatchPageStatus\.REVIEW_REQUIRED/);
  assert.match(section, /AIExaminerScanBatchPageStatus\.REJECTED/);
  assert.match(section, /UNKNOWN_BARCODE_TOKEN/);
  assert.match(section, /BARCODE_EXAMINATION_MISMATCH/);
  assert.match(section, /SCAN_ID_REUSED/);
});

test("bulk scan can only route into the requested completed examination", async () => {
  const routes = await readFile(new URL("./ai-examiner.ts", import.meta.url), "utf8");
  const start = routes.indexOf('router.post("/examinations/:examinationId/scan-batches"');
  const section = routes.slice(start, start + 12000);
  assert.match(section, /exam\.status !== ExaminationStatus\.COMPLETED/);
  assert.match(section, /binding\.answerSheet\.examinationId !== exam\.id/);
  assert.match(section, /organizationId: req\.auth!\.organizationId/);
});

test("AI Examiner remediation is generated only inside teacher-final approval from final marks", async () => {
  const routes = await readFile(new URL("./ai-examiner.ts", import.meta.url), "utf8");
  const start = routes.indexOf('router.post("/evaluations/:evaluationId/approve"');
  const end = routes.indexOf('router.post("/evaluations/:evaluationId/cancel"', start);
  assert.ok(start >= 0 && end > start);
  const section = routes.slice(start, end);
  assert.match(section, /AIExaminerEvaluationStatus\.APPROVED/);
  assert.match(section, /reviewed\.finalMarks/);
  assert.match(section, /learningRecommendation\.createMany/);
  assert.match(section, /kind: "AI_EXAMINER_REMEDIATION"/);
  assert.match(section, /ratio >= 0\.6/);
});

test("AI remediation links recommendations to the student user and question-level evaluation source", async () => {
  const routes = await readFile(new URL("./ai-examiner.ts", import.meta.url), "utf8");
  const start = routes.indexOf('router.post("/evaluations/:evaluationId/approve"');
  const end = routes.indexOf('router.post("/evaluations/:evaluationId/cancel"', start);
  const section = routes.slice(start, end);
  assert.match(section, /studentProfile\.findFirst/);
  assert.match(section, /userId: student\.userId/);
  assert.match(section, /entityType: "AI_EXAMINER_QUESTION"/);
  assert.match(section, /entityId: `\$\{evaluation\.id\}:\$\{question\.questionKey\}`/);
});
