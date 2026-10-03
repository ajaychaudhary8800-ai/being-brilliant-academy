import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  AIExaminerProviderError,
  parseAIExaminerProviderText,
  validateAIExaminerResultAgainstRubric,
  type AIExaminerProviderResult,
  type AIExaminerRubricQuestion,
} from "./ai-examiner-engine.js";

const rubric: AIExaminerRubricQuestion[] = [
  { key: "Q1", maxMarks: 10, criteria: "Method and answer", concepts: ["Ohm's law"], modelAnswer: "V = IR" },
  { key: "Q2", maxMarks: 10, criteria: "Kirchhoff equations", concepts: ["Kirchhoff laws"], modelAnswer: "Use loop rules" },
];

const valid: AIExaminerProviderResult = {
  extractedText: "Q1 ... Q2 ...",
  overallFeedback: "Good attempt.",
  confidence: 0.91,
  diagnostics: { weakConcepts: [], strongConcepts: ["Ohm's law"], qualityFlags: [] },
  questions: [
    {
      questionKey: "Q1", maxMarks: 10, awardedMarks: 8, confidence: 0.95,
      extractedAnswer: "V = IR", feedback: "Correct method.",
      rubricBreakdown: [{ criterion: "Method", maxMarks: 10, awardedMarks: 8, rationale: "Minor arithmetic error" }],
      visualObservations: [],
      concepts: [{ concept: "Ohm's law", mastery: "STRONG" }], flags: [],
 annotationHints: [],
    },
    {
      questionKey: "Q2", maxMarks: 10, awardedMarks: 6, confidence: 0.82,
      extractedAnswer: "Loop equation", feedback: "Partial equation.",
      rubricBreakdown: [{ criterion: "Equation", maxMarks: 10, awardedMarks: 6, rationale: "One loop omitted" }],
      visualObservations: [],
      concepts: [{ concept: "Kirchhoff laws", mastery: "PARTIAL" }], flags: [],
 annotationHints: [],
    },
  ],
};

test("AI Examiner parses fenced structured JSON", () => {
  const parsed = parseAIExaminerProviderText(`\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``);
  assert.equal(parsed.questions.length, 2);
  assert.equal(parsed.questions[0]?.awardedMarks, 8);
});

test("AI Examiner rejects malformed provider JSON", () => {
  assert.throws(
    () => parseAIExaminerProviderText("not-json"),
    (error: unknown) => error instanceof AIExaminerProviderError && error.code === "AI_EXAMINER_INVALID_JSON",
  );
});

test("AI Examiner validates question keys, max marks and total marks against rubric", () => {
  assert.doesNotThrow(() => validateAIExaminerResultAgainstRubric(parseAIExaminerProviderText(JSON.stringify(valid)), rubric, 20));

  const unknown = structuredClone(valid);
  unknown.questions[1]!.questionKey = "Q99";
  assert.throws(
    () => validateAIExaminerResultAgainstRubric(parseAIExaminerProviderText(JSON.stringify(unknown)), rubric, 20),
    (error: unknown) => error instanceof AIExaminerProviderError && error.code === "AI_EXAMINER_UNKNOWN_QUESTION",
  );

  const over = structuredClone(valid);
  over.questions[0]!.awardedMarks = 11;
  over.questions[0]!.rubricBreakdown[0]!.awardedMarks = 11;
  assert.throws(
    () => validateAIExaminerResultAgainstRubric(parseAIExaminerProviderText(JSON.stringify(over)), rubric, 20),
    (error: unknown) => error instanceof AIExaminerProviderError && error.code === "AI_EXAMINER_MARKS_EXCEED_MAXIMUM",
  );
});

test("AI Examiner rejects duplicate question evaluations", () => {
  const duplicate = structuredClone(valid);
  duplicate.questions[1]!.questionKey = "Q1";
  assert.throws(
    () => validateAIExaminerResultAgainstRubric(parseAIExaminerProviderText(JSON.stringify(duplicate)), rubric, 20),
    (error: unknown) => error instanceof AIExaminerProviderError && error.code === "AI_EXAMINER_DUPLICATE_QUESTION",
  );
});


test("Responses API request omits unsupported temperature parameter", async () => {
  const source = await readFile(new URL("./ai-examiner-engine.ts", import.meta.url), "utf8");
  const responsesBranch = source.match(/if \(mode === "RESPONSES"\) \{([\s\S]*?)\} else \{/i)?.[1] ?? "";
  assert.ok(responsesBranch.includes("model: env.AI_EXAMINER_MODEL"));
  assert.doesNotMatch(responsesBranch, /temperature\s*:/);
});


test("AI Examiner accepts criterion evidenceText for auditable rubric grading", () => {
  const withEvidence = structuredClone(valid);
  withEvidence.questions[0]!.rubricBreakdown[0]!.evidenceText = "V = IR";
  const parsed = parseAIExaminerProviderText(JSON.stringify(withEvidence));
  assert.equal(parsed.questions[0]?.rubricBreakdown?.[0]?.evidenceText, "V = IR");
});


test("AI Examiner accepts structured visual observations for multimodal evidence", () => {
  const visual = structuredClone(valid);
  visual.questions[0]!.visualObservations = [
    { key: "axes", status: "PRESENT", confidence: 0.94, evidence: "Both axes labelled" },
  ];
  const parsed = parseAIExaminerProviderText(JSON.stringify(visual));
  assert.equal(parsed.questions[0]?.visualObservations?.[0]?.key, "axes");
  assert.equal(parsed.questions[0]?.visualObservations?.[0]?.status, "PRESENT");
});


test("AI Examiner prompt requires evidence-linked checked-copy localization", async () => {
  const source = await readFile(new URL("./ai-examiner-engine.ts", import.meta.url), "utf8");
  assert.match(source, /matching annotationHint\.text to the same faithful excerpt/);
  assert.match(source, /Order annotationHints in the same reading order/);
  assert.match(source, /route the item to position review instead/);
});
