import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = new URL("./ai-examiner.ts", import.meta.url);
const source = await readFile(route, "utf8");
function section(begin: string, end: string) {
  const a = source.indexOf(begin);
  const b = source.indexOf(end, a + begin.length);
  assert.ok(a >= 0 && b > a, "Missing AI Examiner endpoint section");
  return source.slice(a, b);
}

test("supplementary evidence create must serialize with finalization, before mutation", () => {
  const body = section('router.post("/answer-sheets/:answerSheetId/evidence"', 'router.get("/answer-sheets/:answerSheetId/evidence"');
  assert.match(body, /const evidence = await prisma\.\$transaction\(async tx =>/);
  const lock = body.indexOf("await lockMutableEvidenceAnswerSheet(tx, req.auth!.organizationId, sheet.id)");
  const write = body.indexOf("tx.aIExaminerEvidenceAttachment.create(");
  assert.ok(lock >= 0 && write > lock, "Row lock and finalization guard must precede insert");
  assert.doesNotMatch(body, /prisma\.aIExaminerEvidenceAttachment\.create\(/);
});

test("evidence review must serialize with finalization, before status mutation", () => {
  const body = section('router.patch("/evidence/:evidenceId/review"', 'router.post("/answer-sheets/:answerSheetId/evaluate"');
  assert.match(body, /const updated = await prisma\.\$transaction\(async tx =>/);
  const lock = body.indexOf("await lockMutableEvidenceAnswerSheet(tx, req.auth!.organizationId, evidence.answerSheetId)");
  const write = body.indexOf("tx.aIExaminerEvidenceAttachment.update(");
  assert.ok(lock >= 0 && write > lock, "Row lock and finalization guard must precede review update");
  assert.doesNotMatch(body, /prisma\.aIExaminerEvidenceAttachment\.update\(/);
});

test("human grading finalization updates the same sheet row as evidence lock", () => {
  const body = section('router.post("/evaluations/:evaluationId/approve"', 'router.');
  assert.match(body, /tx\.examinationAnswerSheet\.updateMany\(/);
  assert.match(body, /finalizedAt: now/);
  assert.match(body, /AI_EXAMINER_REVIEW_POLICY_INCOMPLETE/);
  assert.match(body, /AI_EXAMINER_SUPPLEMENTARY_EVIDENCE_INCOMPLETE/);
});
