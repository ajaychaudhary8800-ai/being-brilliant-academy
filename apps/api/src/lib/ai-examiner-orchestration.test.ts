import assert from "node:assert/strict";
import test from "node:test";
import {
  aiExaminerProviderQuestions,
  overlayTrustedAIExaminerOmrAnswers,
  reconcileAIExaminerProviderResult,
  resolveAIExaminerRubricQuestions,
} from "./ai-examiner-orchestration.js";
import type { AIExaminerProviderResult } from "./ai-examiner-engine.js";

function provider(questions: AIExaminerProviderResult["questions"]): AIExaminerProviderResult {
  return {
    extractedText: null,
    overallFeedback: "Reviewed.",
    confidence: 0.95,
    diagnostics: { weakConcepts: [], strongConcepts: [], qualityFlags: [] },
    questions,
  };
}

function row(questionKey:string, extractedAnswer:string|null, awardedMarks=3, confidence=0.95): AIExaminerProviderResult["questions"][number] {
  return {
    questionKey,
    maxMarks: 4,
    awardedMarks,
    confidence,
    extractedAnswer,
    feedback: "Extracted.",
    rubricBreakdown: [],
    visualObservations: [],
    concepts: [],
    flags: [],
  };
}

test("legacy rubric resolves to rubric-semantic provider grading", () => {
  const questions=resolveAIExaminerRubricQuestions({
    questions:[{key:"Q1",maxMarks:4,criteria:"Explain the concept.",concepts:[]}],
  },{questions:[{key:"Q1",answer:"Model explanation"}]});
  const request=aiExaminerProviderQuestions(questions);
  assert.equal(request[0]?.questionType,"LONG_ANSWER");
  assert.equal(request[0]?.evaluationMode,"RUBRIC");
  assert.equal(request[0]?.modelAnswer,"Model explanation");
});

test("deterministic provider request withholds answer key and only asks for extraction", () => {
  const questions=resolveAIExaminerRubricQuestions({
    questions:[{
      key:"Q1",maxMarks:4,criteria:"Select one.",concepts:[],questionType:"MCQ",
      answerKey:"B",scoring:{correctMarks:4,incorrectMarks:-1},
    }],
  },null);
  const request=aiExaminerProviderQuestions(questions);
  assert.equal(request[0]?.evaluationMode,"EXTRACT_ONLY");
  assert.equal(request[0]?.modelAnswer,null);
});

test("MCQ provider marks are ignored and negative marking is deterministic", () => {
  const questions=resolveAIExaminerRubricQuestions({
    questions:[{
      key:"Q1",maxMarks:4,criteria:"Select one.",concepts:[],questionType:"MCQ",
      answerKey:"B",scoring:{correctMarks:4,incorrectMarks:-1},
    }],
  },null);
  const result=reconcileAIExaminerProviderResult(questions,provider([row("Q1","A",4)]),0.75);
  assert.equal(result.questions[0]?.suggestedMarks,-1);
  assert.equal(result.questions[0]?.deterministicStatus,"INCORRECT");
  assert.equal(result.questions[0]?.engine,"DETERMINISTIC_OBJECTIVE");
  assert.equal(result.suggestedMarks,-1);
});

test("MSQ extraction uses structured JSON then deterministic partial scoring", () => {
  const questions=resolveAIExaminerRubricQuestions({
    questions:[{
      key:"Q1",maxMarks:4,criteria:"Choose all.",concepts:[],questionType:"MSQ",
      answerKey:["A","C","D"],scoring:{partialMode:"PROPORTIONAL_NO_WRONG"},
    }],
  },null);
  const result=reconcileAIExaminerProviderResult(questions,provider([row("Q1",'["A","D"]',4)]),0.75);
  assert.equal(result.questions[0]?.suggestedMarks,2.6667);
  assert.equal(result.questions[0]?.deterministicStatus,"PARTIAL");
});

test("malformed structured extraction fails closed to human review without inventing marks", () => {
  const questions=resolveAIExaminerRubricQuestions({
    questions:[{
      key:"Q1",maxMarks:4,criteria:"Choose all.",concepts:[],questionType:"MSQ",
      answerKey:["A","C"],scoring:{partialMode:"PROPORTIONAL_NO_WRONG"},
    }],
  },null);
  const result=reconcileAIExaminerProviderResult(questions,provider([row("Q1","A,C",4)]),0.75);
  assert.equal(result.questions[0]?.suggestedMarks,null);
  assert.equal(result.questions[0]?.reviewRequired,true);
  assert.equal(result.questions[0]?.scoringError?.code,"AI_EXAMINER_EXTRACTION_INVALID");
  assert.equal(result.suggestedMarks,null);
});

test("semantic questions preserve provider suggestion and always stay teacher supervised", () => {
  const questions=resolveAIExaminerRubricQuestions({
    questions:[{key:"Q1",maxMarks:4,criteria:"Explain.",concepts:[],questionType:"SHORT_ANSWER"}],
  },{questions:[{key:"Q1",answer:"Expected explanation"}]});
  const result=reconcileAIExaminerProviderResult(questions,provider([row("Q1","Student explanation",3,0.99)]),0.75);
  assert.equal(result.questions[0]?.suggestedMarks,3);
  assert.equal(result.questions[0]?.reviewRequired,true);
  assert.equal(result.questions[0]?.engine,"RUBRIC_SEMANTIC");
});


test("semantic evidence audit verifies linked rubric excerpts", () => {
  const questions=resolveAIExaminerRubricQuestions({
    questions:[{key:"Q1",maxMarks:4,criteria:"Explain.",concepts:[],questionType:"SHORT_ANSWER"}],
  },{questions:[{key:"Q1",answer:"Expected explanation"}]});

  const providerRow = row("Q1","The force increases because acceleration increases.",3,0.95);
  providerRow.rubricBreakdown = [{
    criterion: "Causal explanation",
    maxMarks: 4,
    awardedMarks: 3,
    rationale: "Correct causal relationship.",
    evidenceText: "acceleration increases",
  }];

  const result=reconcileAIExaminerProviderResult(questions,provider([providerRow]),0.75);
  assert.equal(result.questions[0]?.evidenceAudit?.reviewRequired,false);
  assert.equal(result.questions[0]?.evidenceAudit?.coverageRate,1);
});

test("semantic positive marks without linked evidence are flagged for verification", () => {
  const questions=resolveAIExaminerRubricQuestions({
    questions:[{key:"Q1",maxMarks:4,criteria:"Explain.",concepts:[],questionType:"LONG_ANSWER"}],
  },{questions:[{key:"Q1",answer:"Expected explanation"}]});

  const providerRow = row("Q1","A short answer.",3,0.95);
  providerRow.rubricBreakdown = [{
    criterion: "Explanation",
    maxMarks: 4,
    awardedMarks: 3,
    rationale: "Awarded by provider.",
  }];

  const result=reconcileAIExaminerProviderResult(questions,provider([providerRow]),0.75);
  assert.equal(result.questions[0]?.evidenceAudit?.reviewRequired,true);
  assert.equal(result.questions[0]?.evidenceAudit?.coverageRate,0);
});


test("trusted OMR evidence replaces provider extraction only for objective OMR questions", () => {
  const questions = resolveAIExaminerRubricQuestions({
    questions: [
      { key: "Q1", maxMarks: 4, criteria: "Choose.", concepts: [], questionType: "MCQ", answerKey: "B", omrValidation: { allowedOptions: ["A", "B", "C", "D"] } },
      { key: "Q2", maxMarks: 4, criteria: "Choose all.", concepts: [], questionType: "MSQ", answerKey: ["A", "C"], omrValidation: { allowedOptions: ["A", "B", "C", "D"] } },
      { key: "Q3", maxMarks: 4, criteria: "Explain.", concepts: [], questionType: "SHORT_ANSWER" },
    ],
  }, { questions: [{ key: "Q3", answer: "Explanation" }] });

  const providerResult = provider([
    row("Q1", "A", 0, 0.6),
    row("Q2", JSON.stringify(["B"]), 0, 0.6),
    row("Q3", "Student explanation", 3, 0.9),
  ]);
  const omr = new Map([
    ["q1", { questionKey: "Q1", selections: ["B"], confidence: 0.99 }],
    ["q2", { questionKey: "Q2", selections: ["A", "C"], confidence: 0.98 }],
    ["q3", { questionKey: "Q3", selections: ["X"], confidence: 0.99 }],
  ]);

  const overlaid = overlayTrustedAIExaminerOmrAnswers(questions, providerResult, omr);
  assert.deepEqual(overlaid.appliedQuestionKeys, ["Q1", "Q2"]);
  assert.equal(overlaid.result.questions[0]?.extractedAnswer, "B");
  assert.equal(overlaid.result.questions[0]?.confidence, 0.99);
  assert.equal(overlaid.result.questions[1]?.extractedAnswer, JSON.stringify(["A", "C"]));
  assert.equal(overlaid.result.questions[2]?.extractedAnswer, "Student explanation");

  const scored = reconcileAIExaminerProviderResult(questions, overlaid.result, 0.75);
  assert.equal(scored.questions[0]?.suggestedMarks, 4);
  assert.equal(scored.questions[1]?.suggestedMarks, 4);
});


test("multimodal visual criteria are passed to the provider and reconciled as structured evidence", () => {
  const questions = resolveAIExaminerRubricQuestions({
    questions: [{
      key: "Q1",
      maxMarks: 4,
      criteria: "Draw and label the velocity-time graph.",
      concepts: ["Graphing"],
      questionType: "GRAPH",
      visualValidation: {
        minimumObservationConfidence: 0.8,
        requiredObservations: [
          { key: "axes", description: "Both axes are labelled", weight: 2, required: true },
          { key: "scale", description: "Scale is consistent", weight: 1, required: true },
        ],
      },
    }],
  }, null);

  const request = aiExaminerProviderQuestions(questions);
  assert.equal(request[0]?.visualValidation?.requiredObservations.length, 2);

  const providerRow = row("Q1", "Graph response", 3, 0.95);
  providerRow.visualObservations = [
    { key: "axes", status: "PRESENT", confidence: 0.95, evidence: "time and velocity labels visible" },
    { key: "scale", status: "UNCLEAR", confidence: 0.7, evidence: "interval markings faint" },
  ];
  const result = reconcileAIExaminerProviderResult(questions, provider([providerRow]), 0.75);
  assert.equal(result.questions[0]?.engine, "MULTIMODAL");
  assert.equal(result.questions[0]?.reviewRequired, true);
  const evidence = result.questions[0]?.specializedEvidence;
  assert.ok(evidence && "engine" in evidence && evidence.engine === "MULTIMODAL");
  assert.equal(evidence.reviewRequired, true);
  assert.equal(evidence.checks.some(check => check.status === "REVIEW"), true);
});
