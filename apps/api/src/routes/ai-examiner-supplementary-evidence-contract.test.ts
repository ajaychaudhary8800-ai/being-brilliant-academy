import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("supplementary evidence is a tenant-scoped answer-sheet relation with provenance and review status", async () => {
  const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  assert.match(schema, /model AIExaminerEvidenceAttachment \{/);
  assert.match(schema, /organizationId\s+String/);
  assert.match(schema, /answerSheetId\s+String/);
  assert.match(schema, /questionKey\s+String/);
  assert.match(schema, /contentSha256\s+String\?/);
  assert.match(schema, /uploadedById\s+String/);
  assert.match(schema, /reviewedById\s+String\?/);
  assert.match(schema, /identityMasked\s+Boolean/);
  assert.match(schema, /evidenceAttachments AIExaminerEvidenceAttachment\[\]/);
});

test("oral and practical questions cannot receive AI marks from the written script alone", async () => {
  const orchestration = await readFile(new URL("../lib/ai-examiner-orchestration.ts", import.meta.url), "utf8");
  assert.match(orchestration, /supplementaryEvidenceTypes/);
  assert.match(orchestration, /"ORAL_AUDIO_VIDEO"/);
  assert.match(orchestration, /"PRACTICAL_PROJECT_VIVA"/);
  assert.match(orchestration, /evaluationMode: route\.deterministic \|\| supplementaryEvidenceTypes\.has\(question\.questionType\) \? "EXTRACT_ONLY"/);
  assert.match(orchestration, /suggestedMarks: null/);
  assert.match(orchestration, /AI_EXAMINER_SUPPLEMENTARY_EVIDENCE_REVIEW_REQUIRED/);
});

test("evidence creation validates active-rubric question keys and never enables automatic scoring", async () => {
  const routes = await readFile(new URL("./ai-examiner.ts", import.meta.url), "utf8");
  const start = routes.indexOf('router.post("/answer-sheets/:answerSheetId/evidence"');
  assert.ok(start >= 0);
  const section = routes.slice(start, start + 7500);
  assert.match(section, /await answerSheetForManager\(req, answerSheetId\)/);
  assert.match(section, /AIExaminerRubricStatus\.ACTIVE/);
  assert.match(section, /resolveAIExaminerRubricQuestions/);
  assert.match(section, /AI_EXAMINER_EVIDENCE_QUESTION_INVALID/);
  assert.match(section, /contentSha256/);
  assert.match(section, /automaticScoring: false/);
  assert.match(section, /reviewRequired: true/);
});

test("final approval requires verified evidence for every oral or practical rubric question", async () => {
  const routes = await readFile(new URL("./ai-examiner.ts", import.meta.url), "utf8");
  const start = routes.indexOf('router.post("/evaluations/:evaluationId/approve"');
  assert.ok(start >= 0);
  const section = routes.slice(start, start + 9500);
  assert.match(section, /questionType === "ORAL_AUDIO_VIDEO"/);
  assert.match(section, /questionType === "PRACTICAL_PROJECT_VIVA"/);
  assert.match(section, /aIExaminerEvidenceAttachment\.findMany/);
  assert.match(section, /status: "VERIFIED"/);
  assert.match(section, /AI_EXAMINER_SUPPLEMENTARY_EVIDENCE_INCOMPLETE/);
});

test("blind review exposes only identity-masked verified evidence", async () => {
  const routes = await readFile(new URL("./ai-examiner.ts", import.meta.url), "utf8");
  const workspace = routes.indexOf('router.get("/review-rounds/:roundId/workspace"');
  const submit = routes.indexOf('router.post("/review-rounds/:roundId/submit"', workspace);
  const section = routes.slice(workspace, submit);
  assert.match(section, /where: \{ status: "VERIFIED" \}/);
  assert.match(section, /filter\(item => !round\.anonymizeStudentIdentity \|\| item\.identityMasked\)/);
  assert.match(section, /externalUrl: round\.anonymizeStudentIdentity \? null : item\.externalUrl/);

  const fileStart = routes.indexOf('router.get("/review-rounds/:roundId/evidence/:evidenceId/file"');
  const fileSection = routes.slice(fileStart, fileStart + 5500);
  assert.match(fileSection, /reviewerId !== req\.auth!\.userId/);
  assert.match(fileSection, /organizationId: req\.auth!\.organizationId/);
  assert.match(fileSection, /status: "VERIFIED"/);
  assert.match(fileSection, /identityMasked: true/);
  assert.match(fileSection, /AI_EXAMINER_REVIEW_EVIDENCE_ACCESSED/);
});
