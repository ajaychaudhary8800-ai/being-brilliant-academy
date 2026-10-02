import assert from "node:assert/strict";
import test from "node:test";
import { buildAIExaminerCheckedCopyDraft } from "./ai-examiner-checked-copy-state.js";

test("checked-copy rubric notes anchor only when localized evidence is available", () => {
  const draft = buildAIExaminerCheckedCopyDraft({
    diagnostics: {
      questionDiagnostics: [{
        questionKey: "Q1",
        annotationHints: [{
          kind: "UNDERLINE",
          pageNumber: 1,
          x: 0.2,
          y: 0.3,
          width: 0.25,
          height: 0.04,
          text: "I1 = 3.0 A and I2 = 2.0 A",
        }],
      }],
    },
    questions: [{
      questionKey: "Q1",
      maxMarks: 10,
      finalMarks: 7.5,
      confidence: 0.92,
      feedback: "Recheck simultaneous-equation solution.",
      rubricBreakdown: [
        {
          criterion: "Simultaneous equation solution",
          maxMarks: 2,
          awardedMarks: 0,
          rationale: "The reported currents do not satisfy both equations.",
          evidenceText: "I1 = 3.0 A and I2 = 2.0 A",
        },
        {
          criterion: "Correct unit",
          maxMarks: 0.5,
          awardedMarks: 0,
          rationale: "Unit evidence is missing.",
          evidenceText: "unit missing",
        },
      ],
    }],
    totalMarks: 7.5,
    maximumMarks: 10,
  });

  const localized = draft.find(row => row.type === "RUBRIC_NOTE" && row.rubricCriterion === "Simultaneous equation solution");
  assert.ok(localized);
  assert.equal(localized.approvalState, "AI_DRAFT");
  assert.equal(localized.anchor?.pageNumber, 1);
  assert.equal(localized.sourceEvidence, "I1 = 3.0 A and I2 = 2.0 A");
  assert.equal(localized.marks, 0);

  const uncertain = draft.find(row => row.type === "RUBRIC_NOTE" && row.rubricCriterion === "Correct unit");
  assert.ok(uncertain);
  assert.equal(uncertain.approvalState, "POSITION_REVIEW_REQUIRED");
  assert.equal(uncertain.anchor, null);
  assert.equal(uncertain.sourceEvidence, "unit missing");
});

test("checked-copy rubric rows never invent coordinates when diagnostics contain no location", () => {
  const draft = buildAIExaminerCheckedCopyDraft({
    diagnostics: {},
    questions: [{
      questionKey: "Q2",
      maxMarks: 5,
      finalMarks: 4,
      rubricBreakdown: [{
        criterion: "Method",
        maxMarks: 2,
        awardedMarks: 1,
        rationale: "Method is partially correct.",
        evidenceText: "substitution",
      }],
    }],
    totalMarks: 4,
    maximumMarks: 5,
  });
  const note = draft.find(row => row.type === "RUBRIC_NOTE");
  assert.ok(note);
  assert.equal(note.approvalState, "POSITION_REVIEW_REQUIRED");
  assert.equal(note.anchor, null);
});
