import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("checked-copy workflow keeps teacher-approved marks authoritative and renders red-pen artifacts", async () => {
  const [engine, orchestration, worker, renderer, route, examWorkflow, review, portal, dockerfile] = await Promise.all([
    readFile(new URL("../lib/ai-examiner-engine.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai-examiner-orchestration.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai-examiner-worker.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai-examiner-checked-copy.ts", import.meta.url), "utf8"),
    readFile(new URL("ai-examiner.ts", import.meta.url), "utf8"),
    readFile(new URL("examination-workflow.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../web/components/portal-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../web/components/ai-examiner-review.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../Dockerfile", import.meta.url), "utf8"),
  ]);

  assert.match(engine, /annotationHints/);
  assert.match(engine, /STUDENT ANSWER SHEET page/);
  assert.match(engine, /Never invent coordinates/);
  assert.match(orchestration, /annotationHints: provider\.annotationHints/);
  assert.match(worker, /annotationHints: question\.annotationHints/);

  assert.match(renderer, /AI-assisted red-pen layer/);
  assert.match(renderer, /teacher-approved/);
  assert.match(renderer, /pdftoppm/);
  assert.match(renderer, /magick/);
  assert.match(renderer, /APPROXIMATE/);
  assert.match(renderer, /EXACT/);
  assert.match(renderer, /MIXED/);
  assert.match(renderer, /Total \$\{input\.totalMarks\}\/\$\{input\.maximumMarks\}/);

  assert.match(route, /\/evaluations\/:evaluationId\/checked-copy/);
  assert.match(route, /status: AIExaminerEvaluationStatus\.APPROVED/);
  assert.match(route, /question\.finalMarks == null/);
  assert.match(route, /AI_EXAMINER_CHECKED_COPY_DOWNLOADED/);
  assert.match(route, /X-Checked-Copy-Placement/);

  assert.match(review, /Checked Copy/);
  assert.match(review, /openCheckedCopy/);
  assert.match(review, /evaluation\.status!==["']APPROVED["']/);
  assert.match(examWorkflow, /\/answer-sheets\/:answerSheetId\/checked-copy/);
  assert.match(examWorkflow, /ExaminationStatus\.RESULTS_PUBLISHED/);
  assert.match(portal, /Download checked copy/);
  assert.match(portal, /checked-answer-sheet\.pdf/);

  assert.match(dockerfile, /imagemagick/);
  assert.match(dockerfile, /poppler-utils/);
  assert.match(dockerfile, /font-dejavu/);
});
