import assert from "node:assert/strict";
import test from "node:test";
import {
  aiExaminerRubricInputSchema,
  aiExaminerRubricStorage,
  aiExaminerStoredQuestionRoute,
} from "./ai-examiner-question-config.js";

test("legacy rubric questions remain backward compatible and default to semantic review", () => {
  const parsed = aiExaminerRubricInputSchema.parse({
    instructions: "Use the rubric.",
    questions: [{
      key: "Q1",
      maxMarks: 5,
      criteria: "Award marks for correct reasoning.",
      modelAnswer: "A valid explanation.",
      concepts: ["Reasoning"],
    }],
  });

  assert.equal(parsed.questions[0]?.questionType, "LONG_ANSWER");
  assert.equal(aiExaminerStoredQuestionRoute(parsed.questions[0]!).engine, "RUBRIC_SEMANTIC");

  const stored = aiExaminerRubricStorage(parsed);
  assert.equal(stored.rubric.questions[0]?.questionType, "LONG_ANSWER");
  assert.equal(stored.modelAnswer.questions[0]?.answer, "A valid explanation.");
});

test("objective questions store marking rules and deterministic answer keys", () => {
  const parsed = aiExaminerRubricInputSchema.parse({
    questions: [{
      key: "Q1",
      maxMarks: 4,
      criteria: "Select the correct option.",
      questionType: "MCQ",
      answerKey: "B",
      scoring: { correctMarks: 4, incorrectMarks: -1, unansweredMarks: 0 },
    }],
  });

  const stored = aiExaminerRubricStorage(parsed);
  const question = stored.rubric.questions[0]!;
  assert.equal(question.questionType, "MCQ");
  assert.equal(question.answerKey, "B");
  assert.equal(question.scoring?.incorrectMarks, -1);
  assert.equal(aiExaminerStoredQuestionRoute(question).engine, "DETERMINISTIC_OBJECTIVE");
});

test("deterministic question types require an answer key or model answer", () => {
  const result = aiExaminerRubricInputSchema.safeParse({
    questions: [{
      key: "Q1",
      maxMarks: 4,
      criteria: "Select the correct option.",
      questionType: "MCQ",
    }],
  });
  assert.equal(result.success, false);
});

test("question configuration rejects duplicate keys and invalid scoring", () => {
  const duplicate = aiExaminerRubricInputSchema.safeParse({
    questions: [
      { key: "Q1", maxMarks: 2, criteria: "First", modelAnswer: "A" },
      { key: "q1", maxMarks: 2, criteria: "Second", modelAnswer: "B" },
    ],
  });
  assert.equal(duplicate.success, false);

  const over = aiExaminerRubricInputSchema.safeParse({
    questions: [{
      key: "Q2",
      maxMarks: 4,
      criteria: "Select the correct option.",
      questionType: "MCQ",
      answerKey: "A",
      scoring: { correctMarks: 5 },
    }],
  });
  assert.equal(over.success, false);
});

test("MSQ and matching answer-key shapes are validated", () => {
  assert.equal(aiExaminerRubricInputSchema.safeParse({
    questions: [{ key: "Q1", maxMarks: 4, criteria: "Choose all.", questionType: "MSQ", answerKey: "A,C" }],
  }).success, false);

  assert.equal(aiExaminerRubricInputSchema.safeParse({
    questions: [{ key: "Q2", maxMarks: 4, criteria: "Match.", questionType: "MATCHING", answerKey: ["A-1"] }],
  }).success, false);
});


test("programming questions require an explicit isolated sandbox policy", () => {
  const missing = aiExaminerRubricInputSchema.safeParse({
    questions: [{
      key: "Q3",
      maxMarks: 10,
      criteria: "Write a program.",
      questionType: "PROGRAMMING",
      requiresCodeExecution: true,
    }],
  });
  assert.equal(missing.success, false);

  const parsed = aiExaminerRubricInputSchema.parse({
    questions: [{
      key: "Q3",
      maxMarks: 10,
      criteria: "Write a program.",
      questionType: "PROGRAMMING",
      requiresCodeExecution: true,
      codeExecution: {
        language: "PYTHON",
        timeoutMs: 2000,
        memoryMb: 128,
        maxOutputBytes: 8192,
        networkAccess: false,
        fileSystem: "EPHEMERAL",
        testCases: [
          { key: "visible-1", input: "2", expectedOutput: "4", weight: 4 },
          { key: "hidden-1", input: "10", expectedOutput: "100", weight: 6, hidden: true },
        ],
      },
    }],
  });
  assert.equal(parsed.questions[0]?.codeExecution?.networkAccess, false);
  assert.equal(aiExaminerStoredQuestionRoute(parsed.questions[0]!).engine, "CODE_SANDBOX");
});

test("programming sandbox configuration rejects network access and duplicate test keys", () => {
  const result = aiExaminerRubricInputSchema.safeParse({
    questions: [{
      key: "Q4",
      maxMarks: 10,
      criteria: "Write a program.",
      questionType: "PROGRAMMING",
      requiresCodeExecution: true,
      codeExecution: {
        language: "JAVASCRIPT",
        networkAccess: true,
        testCases: [
          { key: "same", weight: 5 },
          { key: "SAME", weight: 5 },
        ],
      },
    }],
  });
  assert.equal(result.success, false);
});


test("OMR configuration is optional and constrained to MCQ/MSQ", () => {
  const parsed = aiExaminerRubricInputSchema.parse({
    questions: [{
      key: "Q1",
      maxMarks: 4,
      criteria: "Select the correct option.",
      questionType: "MCQ",
      answerKey: "B",
      omrValidation: { allowedOptions: ["A", "B", "C", "D"] },
    }],
  });
  assert.deepEqual(parsed.questions[0]?.omrValidation?.allowedOptions, ["A", "B", "C", "D"]);

  assert.equal(aiExaminerRubricInputSchema.safeParse({
    questions: [{
      key: "Q2",
      maxMarks: 5,
      criteria: "Explain.",
      questionType: "LONG_ANSWER",
      modelAnswer: "Explanation",
      omrValidation: { allowedOptions: ["A", "B"] },
    }],
  }).success, false);

  assert.equal(aiExaminerRubricInputSchema.safeParse({
    questions: [{
      key: "Q3",
      maxMarks: 4,
      criteria: "Choose all.",
      questionType: "MSQ",
      answerKey: ["A"],
      omrValidation: { allowedOptions: ["A", "a", "B"] },
    }],
  }).success, false);
});
