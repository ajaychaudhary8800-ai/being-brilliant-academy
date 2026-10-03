import assert from "node:assert/strict";
import test from "node:test";
import { autoPlaceCheckedCopyAnnotations, buildAIExaminerCheckedCopyDraft } from "./ai-examiner-checked-copy-state.js";

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
    sourcePageCount: 1,
  });

  const localized = draft.find(row => row.type === "RUBRIC_NOTE" && row.rubricCriterion === "Simultaneous equation solution");
  assert.ok(localized);
  assert.equal(localized.approvalState, "AI_DRAFT");
  assert.equal(localized.anchor?.pageNumber, 1);
  assert.equal(localized.sourceEvidence, "I1 = 3.0 A and I2 = 2.0 A");
  assert.equal(localized.marks, 0);

  const uncertain = draft.find(row => row.type === "RUBRIC_NOTE" && row.rubricCriterion === "Correct unit");
  assert.ok(uncertain);
  assert.equal(uncertain.approvalState, "AI_DRAFT");
  assert.equal(uncertain.anchor?.pageNumber, 1);
  assert.equal(uncertain.anchor?.placementConfidence, 0.68);
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


test("checked-copy draft auto-places total score when source page count is known", () => {
  const draft = buildAIExaminerCheckedCopyDraft({
    diagnostics: {},
    questions: [{
      questionKey: "Q1",
      maxMarks: 2,
      finalMarks: 2,
      rubricBreakdown: [],
    }],
    totalMarks: 2,
    maximumMarks: 2,
    sourcePageCount: 3,
  });
  const total = draft.find(row => row.type === "TOTAL_SCORE");
  assert.ok(total);
  assert.equal(total.approvalState, "AI_DRAFT");
  assert.equal(total.anchor?.pageNumber, 3);
  assert.ok((total.anchor?.placementConfidence ?? 0) >= 0.9);
});

test("auto-place resolves existing unpositioned annotations from question hints without approving them", () => {
  const placements = autoPlaceCheckedCopyAnnotations({
    diagnostics: {
      questionDiagnostics: [{
        questionKey: "Q2",
        annotationHints: [{
          kind: "UNDERLINE",
          pageNumber: 2,
          x: 0.3,
          y: 0.4,
          width: 0.25,
          height: 0.04,
          text: "I1 = 3.0 A and I2 = 2.0 A",
        }],
      }],
    },
    sourcePageCount: 2,
    annotations: [
      {
        id: "rubric-1",
        questionKey: "Q2",
        type: "RUBRIC_NOTE",
        sourceEvidence: "different evidence wording",
        approvalState: "POSITION_REVIEW_REQUIRED",
        anchor: null,
      },
      {
        id: "total-1",
        questionKey: null,
        type: "TOTAL_SCORE",
        sourceEvidence: null,
        approvalState: "POSITION_REVIEW_REQUIRED",
        anchor: null,
      },
    ],
  });
  assert.equal(placements.length, 2);
  const rubric = placements.find(row => row.id === "rubric-1");
  assert.ok(rubric);
  assert.equal(rubric.anchor.pageNumber, 2);
  assert.equal(rubric.anchor.placementConfidence, 0.68);
  const total = placements.find(row => row.id === "total-1");
  assert.ok(total);
  assert.equal(total.anchor.pageNumber, 2);
});
