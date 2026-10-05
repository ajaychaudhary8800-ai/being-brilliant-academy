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
  assert.equal(uncertain.approvalState, "POSITION_REVIEW_REQUIRED");
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


test("auto-place uses trusted same-question anchors for legacy revisions without diagnostic hints", () => {
  const placements = autoPlaceCheckedCopyAnnotations({
    diagnostics: {},
    sourcePageCount: 2,
    annotations: [
      {
        id: "q1-score",
        questionKey: "Q1",
        type: "QUESTION_SCORE",
        sourceEvidence: null,
        approvalState: "APPROVED",
        anchor: { pageNumber: 1, x: 0.75, y: 0.12, width: 0.13, height: 0.04 },
      },
      {
        id: "q1-rubric-unplaced",
        questionKey: "Q1",
        type: "RUBRIC_NOTE",
        sourceEvidence: "Power calculation evidence",
        approvalState: "POSITION_REVIEW_REQUIRED",
        anchor: null,
      },
    ],
  });
  assert.equal(placements.length, 1);
  assert.equal(placements[0]!.id, "q1-rubric-unplaced");
  assert.equal(placements[0]!.anchor.pageNumber, 1);
  assert.equal(placements[0]!.anchor.placementConfidence, 0.55);
});


test("fresh checked-copy draft places question score beside the last visible evidence region", () => {
  const draft = buildAIExaminerCheckedCopyDraft({
    diagnostics: {
      questionDiagnostics: [{
        questionKey: "Q2",
        annotationHints: [
          { kind: "TICK", pageNumber: 1, x: 0.20, y: 0.15, width: 0.20, height: 0.04, text: "first step" },
          { kind: "UNDERLINE", pageNumber: 2, x: 0.42, y: 0.70, width: 0.22, height: 0.04, text: "final current = 1.0 A" },
        ],
      }],
    },
    questions: [{
      questionKey: "Q2",
      maxMarks: 10,
      finalMarks: 7.5,
      confidence: 0.93,
      rubricBreakdown: [],
    }],
    totalMarks: 7.5,
    maximumMarks: 10,
    sourcePageCount: 2,
  });
  const score = draft.find(row => row.type === "QUESTION_SCORE");
  assert.ok(score);
  assert.equal(score.anchor?.pageNumber, 2);
  assert.equal(score.approvalState, "AI_DRAFT");
  assert.ok((score.anchor?.placementConfidence ?? 0) >= 0.8);
});

test("fresh checked-copy draft uses NOTE as a locator without rendering duplicate note text", () => {
  const draft = buildAIExaminerCheckedCopyDraft({
    diagnostics: {
      questionDiagnostics: [{
        questionKey: "Q1",
        annotationHints: [
          { kind: "NOTE", pageNumber: 1, x: 0.30, y: 0.50, width: 0.20, height: 0.05, text: "sign error here" },
        ],
      }],
    },
    questions: [{
      questionKey: "Q1",
      maxMarks: 5,
      finalMarks: 3,
      confidence: 0.94,
      feedback: "Recheck the sign.",
      rubricBreakdown: [],
    }],
    totalMarks: 3,
    maximumMarks: 5,
    sourcePageCount: 1,
  });
  assert.equal(draft.filter(row => row.type === "TEXT_COMMENT").length, 0);
  const correction = draft.find(row => row.type === "ERROR_LABEL");
  assert.ok(correction);
  assert.equal(correction.anchor?.pageNumber, 1);
  assert.equal(correction.approvalState, "AI_DRAFT");
  assert.ok((correction.anchor?.placementConfidence ?? 0) >= 0.8);
});


test("fresh checked-copy draft routes low-confidence visual hints to teacher position review", () => {
  const draft = buildAIExaminerCheckedCopyDraft({
    diagnostics: {
      questionDiagnostics: [{
        questionKey: "Q3",
        annotationHints: [
          { kind: "TICK", pageNumber: 1, x: 0.20, y: 0.25, width: 0.18, height: 0.04, text: "visible but uncertain" },
        ],
      }],
    },
    questions: [{
      questionKey: "Q3",
      maxMarks: 4,
      finalMarks: 2,
      confidence: 0.61,
      rubricBreakdown: [],
    }],
    totalMarks: 2,
    maximumMarks: 4,
    sourcePageCount: 1,
  });
  const direct = draft.find(row => row.type === "TICK");
  assert.ok(direct);
  assert.equal(direct.approvalState, "POSITION_REVIEW_REQUIRED");
  assert.equal(direct.anchor?.placementConfidence, 0.61);
});

test("fresh checked-copy draft ignores provider hints outside the actual answer-sheet page count", () => {
  const draft = buildAIExaminerCheckedCopyDraft({
    diagnostics: {
      questionDiagnostics: [{
        questionKey: "Q4",
        annotationHints: [
          { kind: "UNDERLINE", pageNumber: 5, x: 0.25, y: 0.30, width: 0.20, height: 0.04, text: "impossible page" },
        ],
      }],
    },
    questions: [{
      questionKey: "Q4",
      maxMarks: 3,
      finalMarks: 2,
      confidence: 0.95,
      rubricBreakdown: [],
    }],
    totalMarks: 2,
    maximumMarks: 3,
    sourcePageCount: 2,
  });
  assert.equal(draft.filter(row => row.type === "UNDERLINE").length, 0);
  const score = draft.find(row => row.type === "QUESTION_SCORE");
  assert.ok(score);
  assert.equal(score.approvalState, "POSITION_REVIEW_REQUIRED");
  assert.equal(score.anchor, null);
});

test("auto-place never uses diagnostic hints beyond the source page count", () => {
  const placements = autoPlaceCheckedCopyAnnotations({
    diagnostics: {
      questionDiagnostics: [{
        questionKey: "Q5",
        annotationHints: [
          { kind: "NOTE", pageNumber: 4, x: 0.20, y: 0.30, width: 0.20, height: 0.05, text: "outside source" },
        ],
      }],
    },
    sourcePageCount: 2,
    annotations: [{
      id: "q5-score",
      questionKey: "Q5",
      type: "QUESTION_SCORE",
      sourceEvidence: null,
      approvalState: "POSITION_REVIEW_REQUIRED",
      anchor: null,
    }],
  });
  assert.equal(placements.length, 0);
});
