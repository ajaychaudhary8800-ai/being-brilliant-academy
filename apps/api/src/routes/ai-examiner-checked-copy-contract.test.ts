import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("checked-copy workflow persists non-destructive annotations, approval gates and published access", async () => {
  const [schema,migration,state,renderer,draftService,route,examWorkflow,adminExaminations,review,editor,portal,studentAnswerCenter] = await Promise.all([
    readFile(new URL("../../prisma/schema.prisma", import.meta.url),"utf8"),
    readFile(new URL("../../prisma/migrations/20261003001000_ai_examiner_checked_copy_annotations/migration.sql", import.meta.url),"utf8"),
    readFile(new URL("../lib/ai-examiner-checked-copy-state.ts", import.meta.url),"utf8"),
    readFile(new URL("../lib/ai-examiner-checked-copy.ts", import.meta.url),"utf8"),
    readFile(new URL("../lib/ai-examiner-checked-copy-draft.ts", import.meta.url),"utf8"),
    readFile(new URL("ai-examiner-checked-copy.ts", import.meta.url),"utf8"),
    readFile(new URL("examination-workflow.ts", import.meta.url),"utf8"),
    readFile(new URL("admin-examinations.ts", import.meta.url),"utf8"),
    readFile(new URL("../../../web/components/ai-examiner-review.tsx", import.meta.url),"utf8"),
    readFile(new URL("../../../web/components/ai-examiner-checked-copy-editor.tsx", import.meta.url),"utf8"),
    readFile(new URL("../../../web/components/portal-workspace.tsx", import.meta.url),"utf8"),
    readFile(new URL("../../../web/app/portal/examinations/page.tsx", import.meta.url),"utf8"),
  ]);
  assert.match(schema,/model AIExaminerCheckedCopy\s*\{/);assert.match(schema,/model AIExaminerCheckedCopyRevision\s*\{/);assert.match(schema,/model AIExaminerAnnotation\s*\{/);assert.match(schema,/model AIExaminerAnnotationAnchor\s*\{/);assert.match(schema,/sourceAnswerSheetSha256/);assert.match(schema,/renderedFileSha256/);
  assert.match(migration,/normalized_check/);assert.match(migration,/immutable outside draft revisions/);
  assert.match(state,/POSITION_REVIEW_REQUIRED/);assert.match(state,/QUESTION_SCORE_MISMATCH/);assert.match(state,/TOTAL_SCORE_MISMATCH/);assert.match(state,/sha256/);
  assert.match(renderer,/renderLabel\?: "Approved" \| "Draft Preview"/);assert.match(renderer,/input\.renderLabel \?\? "Approved"/);assert.match(renderer,/renderAIExaminerCheckedCopyPage/);assert.match(renderer,/teacherPenTextSvg/);assert.match(renderer,/URW Chancery L/);assert.match(renderer,/FREEHAND/);assert.match(renderer,/CIRCLE/);assert.match(renderer,/ARROW/);
  assert.match(draftService,/ensureAIExaminerCheckedCopyDraft/);assert.match(draftService,/AUTO_DRAFT_SERVICE/);assert.match(draftService,/P2002/);assert.match(draftService,/AI_CHECKED_COPY_SUGGESTIONS_INCOMPLETE/);
  assert.match(route,/AI_CHECKED_COPY_GENERATED/);assert.match(route,/AI_CHECKED_COPY_ANNOTATION_CREATED/);assert.match(route,/AIExaminerEvaluationStatus\.REVIEW_REQUIRED/);assert.match(route,/AI Suggested Checked Copy — Draft/);assert.match(route,/gradingMode:finalized\?"FINAL":"SUGGESTED"/);assert.match(route,/AI_CHECKED_COPY_ANNOTATION_EDITED/);assert.match(route,/AI_CHECKED_COPY_ANNOTATION_REJECTED/);assert.match(route,/AI_CHECKED_COPY_APPROVED/);assert.match(route,/AI_CHECKED_COPY_RENDERED/);assert.match(route,/AI_CHECKED_COPY_PREVIEWED/);assert.match(route,/AI_CHECKED_COPY_REVISION_CREATED/);assert.match(route,/renderLabel:"Draft Preview"/);assert.match(route,/Score annotations are generated from finalized grading/);assert.match(route,/sourceAnswerSheetSha256/);
  assert.match(examWorkflow,/Role\.PARENT/);assert.match(examWorkflow,/parentStudent\.findFirst/);assert.match(examWorkflow,/RESULTS_PUBLISHED/);assert.match(examWorkflow,/AI_CHECKED_COPY_PUBLISHED/);assert.match(examWorkflow,/AI_CHECKED_COPY_DOWNLOADED/);
  assert.match(adminExaminations,/publishRenderedCheckedCopies/);assert.match(adminExaminations,/source: "RESULT_PUBLICATION"/);assert.match(adminExaminations,/publishedCheckedCopies/);
  assert.match(review,/Review AI Red-Pen Draft/);assert.match(review,/Review Checked Copy/);assert.match(review,/automatically approved and rendered/);assert.match(editor,/AI Suggested Checked Copy — Draft/);assert.match(editor,/AI Checked Copy — Draft/);assert.match(editor,/scores are not authoritative yet/i);assert.match(editor,/Download draft PDF preview/);assert.match(editor,/Approve whole checked copy/);assert.match(editor,/position review required/);assert.match(editor,/FREEHAND/);assert.match(editor,/Download checked copy PDF/);
  assert.match(portal,/function ParentExaminations/);assert.match(portal,/Download checked copy/);assert.match(portal,/answer-sheets\/\$\{answerSheetId\}\/checked-copy/);assert.match(portal,/\["overview", "examinations", "notifications"/);
  assert.match(studentAnswerCenter,/View \/ Download Checked Copy/);assert.match(studentAnswerCenter,/answer-sheets\/\$\{exam\.answerSheet\.id\}\/checked-copy/);
});
