import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("AI question generation is manager-authorized and relation checked", async () => {
  const routes = await readFile(new URL("./learning-ecosystem.ts", import.meta.url), "utf8");
  const start = routes.indexOf('router.post("/learning/questions/ai-generate"');
  assert.ok(start >= 0);
  const section = routes.slice(start, start + 10000);

  assert.match(section, /managers/);
  assert.match(section, /await relationCheck\(\{ subjectId: d\.subjectId, courseId: d\.courseId \}\)/);
  assert.match(section, /assertManagerQuestionAccess\(actor/);
  assert.match(section, /learningQuestionGeneratorConfigured/);
});

test("generated questions are always AI-marked DRAFT items requiring normal approval", async () => {
  const routes = await readFile(new URL("./learning-ecosystem.ts", import.meta.url), "utf8");
  const start = routes.indexOf('router.post("/learning/questions/ai-generate"');
  const end = routes.indexOf('router.post("/learning/questions/similarity-check"', start);
  const section = routes.slice(start, end);

  assert.match(section, /approvalStatus: ApprovalStatus\.DRAFT/);
  assert.match(section, /aiGenerated: true/);
  assert.match(section, /tags: \["AI_DRAFT"\]/);
  assert.match(section, /approvalRequired: true/);
  assert.doesNotMatch(section, /approvalStatus: ApprovalStatus\.APPROVED/);
});

test("generated questions are revalidated and exact duplicate fingerprints are suppressed", async () => {
  const routes = await readFile(new URL("./learning-ecosystem.ts", import.meta.url), "utf8");
  const start = routes.indexOf('router.post("/learning/questions/ai-generate"');
  const end = routes.indexOf('router.post("/learning/questions/similarity-check"', start);
  const section = routes.slice(start, end);

  assert.match(section, /const proposed = questionInput\.parse/);
  assert.match(section, /questionSimilarityHash\(proposed\.body, proposed\.options\)/);
  assert.match(section, /skippedDuplicates/);
  assert.match(section, /similarityHash/);
});

test("question generator provider errors fail explicitly instead of fabricating fallback items", async () => {
  const generator = await readFile(new URL("../lib/learning-question-generator.ts", import.meta.url), "utf8");

  assert.match(generator, /QUESTION_GENERATOR_NOT_CONFIGURED/);
  assert.match(generator, /QUESTION_GENERATOR_INVALID_JSON/);
  assert.match(generator, /QUESTION_GENERATOR_INVALID_RESULT/);
  assert.match(generator, /QUESTION_GENERATOR_PROVIDER_ERROR/);
  assert.doesNotMatch(generator, /deterministic fallback/i);
});
