import assert from "node:assert/strict";
import test from "node:test";
import { QuestionType } from "@prisma/client";
import { parseGeneratedLearningQuestions } from "./learning-question-generator.js";

test("question generator parser accepts strict requested question types", () => {
  const rows = parseGeneratedLearningQuestions(JSON.stringify({
    questions: [{
      type: "MCQ",
      body: "Which quantity is conserved in an isolated collision?",
      options: ["Momentum", "Force", "Acceleration", "Power"],
      correctAnswer: "Momentum",
      solution: "Total linear momentum is conserved for an isolated system.",
      difficulty: "EASY",
      bloomLevel: "UNDERSTAND",
      learningOutcomes: ["Apply conservation of linear momentum"],
      expectedTimeSeconds: 45,
    }],
  }), [QuestionType.MCQ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.type, QuestionType.MCQ);
  assert.equal(rows[0]?.options instanceof Array, true);
});

test("question generator parser rejects provider type drift", () => {
  assert.throws(() => parseGeneratedLearningQuestions(JSON.stringify({
    questions: [{
      type: "LONG_ANSWER",
      body: "Explain momentum conservation.",
      correctAnswer: "See solution",
      solution: "Use Newton's third law and impulse.",
      difficulty: "MEDIUM",
    }],
  }), [QuestionType.MCQ]), /outside the requested set/);
});

test("question generator parser rejects malformed MCQ and MSQ structures", () => {
  assert.throws(() => parseGeneratedLearningQuestions(JSON.stringify({
    questions: [{
      type: "MCQ",
      body: "Broken item",
      options: ["Only one"],
      correctAnswer: "Only one",
      solution: "Invalid by design",
      difficulty: "EASY",
    }],
  }), [QuestionType.MCQ]));

  assert.throws(() => parseGeneratedLearningQuestions(JSON.stringify({
    questions: [{
      type: "MSQ",
      body: "Select valid statements",
      options: ["A", "B", "C"],
      correctAnswer: "A",
      solution: "Invalid by design",
      difficulty: "MEDIUM",
    }],
  }), [QuestionType.MSQ]));
});

test("question generator parser handles fenced JSON but rejects non-JSON prose", () => {
  const rows = parseGeneratedLearningQuestions(````json
{"questions":[{"type":"TRUE_FALSE","body":"Momentum is a vector quantity.","correctAnswer":true,"solution":"Momentum has magnitude and direction.","difficulty":"EASY"}]}
````, [QuestionType.TRUE_FALSE]);
  assert.equal(rows[0]?.type, QuestionType.TRUE_FALSE);
  assert.throws(() => parseGeneratedLearningQuestions("Here are your questions...", [QuestionType.MCQ]));
});
