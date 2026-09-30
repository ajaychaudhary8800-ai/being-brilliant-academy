import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  reconcileAIExaminerProviderResult,
  resolveAIExaminerRubricQuestions,
} from "./ai-examiner-orchestration.js";
import type { AIExaminerProviderResult } from "./ai-examiner-engine.js";

function provider(extractedAnswer: string): AIExaminerProviderResult {
  return {
    extractedText: extractedAnswer,
    overallFeedback: "Accounting response extracted for teacher review.",
    confidence: 0.95,
    diagnostics: { weakConcepts: [], strongConcepts: [], qualityFlags: [] },
    questions: [{
      questionKey: "Q1",
      maxMarks: 5,
      awardedMarks: 4,
      confidence: 0.95,
      extractedAnswer,
      feedback: "Structured statement extracted.",
      rubricBreakdown: [],
      concepts: [],
      flags: [],
    }],
  };
}

test("accounting validation is retained only for accounting statement questions", () => {
  const questions = resolveAIExaminerRubricQuestions({
    questions: [{
      key: "Q1",
      maxMarks: 5,
      criteria: "Prepare the trial balance.",
      questionType: "ACCOUNTING_STATEMENT",
      concepts: ["Trial balance"],
      accountingValidation: {
        format: "TRIAL_BALANCE",
        requireBalanced: true,
        expectedRows: [
          { label: "Cash", debit: 1000, side: "DEBIT" },
          { label: "Capital", credit: 1000, side: "CREDIT" },
        ],
      },
    }],
  }, null);

  assert.equal(questions[0]?.accountingValidation?.format, "TRIAL_BALANCE");
  assert.throws(() => resolveAIExaminerRubricQuestions({
    questions: [{
      key: "Q1",
      maxMarks: 5,
      criteria: "Explain a concept.",
      questionType: "SHORT_ANSWER",
      concepts: [],
      accountingValidation: { format: "TRIAL_BALANCE" },
    }],
  }, null));
});

test("accounting reconciliation records structured evidence and remains teacher supervised", () => {
  const questions = resolveAIExaminerRubricQuestions({
    questions: [{
      key: "Q1",
      maxMarks: 5,
      criteria: "Prepare the trial balance.",
      questionType: "ACCOUNTING_STATEMENT",
      concepts: ["Trial balance"],
      accountingValidation: {
        format: "TRIAL_BALANCE",
        requireBalanced: true,
        expectedRows: [
          { label: "Cash", debit: 1000 },
          { label: "Capital", credit: 1000 },
        ],
      },
    }],
  }, null);

  const extracted = JSON.stringify({
    headings: ["Trial Balance"],
    rows: [
      { label: "Cash", debit: 1000 },
      { label: "Capital", credit: 1000 },
    ],
  });
  const result = reconcileAIExaminerProviderResult(questions, provider(extracted), 0.75);
  const row = result.questions[0]!;
  assert.equal(row.engine, "SPECIALIZED_SYMBOLIC");
  assert.equal(row.reviewRequired, true);
  assert.equal(row.suggestedMarks, 4);
  assert.ok(row.specializedEvidence && "format" in row.specializedEvidence);
  if (row.specializedEvidence && "format" in row.specializedEvidence) {
    assert.equal(row.specializedEvidence.format, "TRIAL_BALANCE");
    assert.equal(row.specializedEvidence.checks.find(check => check.criterion === "Debit-credit balance")?.status, "PASS");
  }
});

test("accounting provider prompt requires fail-closed structured extraction", async () => {
  const source = await readFile(new URL("./ai-examiner-engine.ts", import.meta.url), "utf8");
  assert.match(source, /For ACCOUNTING_STATEMENT questions, extractedAnswer must be a compact JSON object string/);
  assert.match(source, /do not invent missing values/);
});
