import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("./learning-ecosystem.ts", import.meta.url), "utf8");

test("random Question Bank selection accepts and applies Course scope", () => {
  assert.match(route, /router\.post\("\/learning\/questions\/random"/);
  assert.match(route, /courseId: id\.optional\(\)/);
  assert.match(route, /\.\.\.\(d\.courseId \? \{ courseId: d\.courseId \} : \{\}\)/);
  assert.match(route, /approvalStatus: ApprovalStatus\.APPROVED/);
  assert.match(route, /isArchived: false/);
});

test("Question Bank editing preserves version history and resets approval", () => {
  assert.match(route, /questionBankRevision\.create/);
  assert.match(route, /version: \{ increment: 1 \}/);
  assert.match(route, /approvalStatus: ApprovalStatus\.DRAFT/);
  assert.match(route, /router\.post\("\/learning\/questions\/bulk"/);
  assert.match(route, /router\.get\("\/learning\/questions\/export"/);
});


test("Question Bank 3.1 accepts configurable exam categories and richer assessment metadata", () => {
  assert.match(route, /examCategory: examCategoryCode/);
  assert.match(route, /classLevel: z\.nativeEnum\(ClassLevel\)/);
  assert.match(route, /academicBoard: z\.nativeEnum\(AcademicBoard\)/);
  assert.match(route, /learningOutcomes:/);
  assert.match(route, /expectedTimeSeconds:/);
  assert.match(route, /variantGroupCode:/);
  assert.match(route, /evaluationConfig:/);
  assert.doesNotMatch(route, /examCategory: z\.enum\(\["CBSE", "JEE_MAIN", "NEET", "CUET"\]\)/);
});

test("Question Bank 3.1 exposes normalized exact-content similarity detection", () => {
  assert.match(route, /router\.post\("\/learning\/questions\/similarity-check"/);
  assert.match(route, /questionSimilarityHash/);
  assert.match(route, /NORMALIZED_EXACT_FINGERPRINT/);
  assert.match(route, /similarityHash: questionSimilarityHash/);
});


test("new Learning Tests snapshot Question Bank content and scoring keys", () => {
  assert.match(route, /questionDeliverySnapshot/);
  assert.match(route, /questionVersion:source\.version/);
  assert.match(route, /questionSnapshot:questionJson/);
  assert.match(route, /studentQuestionFromSnapshot/);
  assert.match(route, /correctAnswerForTestQuestion\(tq\)/);
});
