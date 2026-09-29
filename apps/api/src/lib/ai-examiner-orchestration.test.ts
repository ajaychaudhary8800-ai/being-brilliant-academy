import assert from "node:assert/strict";
import test from "node:test";
import {
  aiExaminerProviderQuestions,
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

function row(questionKey:string, extractedAnswer:string|null, awardedMarks=3, confidence=0.95) {
  return {
    questionKey,
    maxMarks: 4,
    awardedMarks,
    confidence,
    extractedAnswer,
    feedback: "Extracted.",
    rubricBreakdown: [],
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
