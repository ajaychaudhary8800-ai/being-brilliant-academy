import assert from "node:assert/strict";
import test from "node:test";
import { auditAIExaminerSemanticEvidence } from "./ai-examiner-evidence.js";

test("evidence audit links awarded semantic marks to extracted student text", () => {
  const audit = auditAIExaminerSemanticEvidence({
    extractedAnswer: "The Treaty of Versailles imposed reparations on Germany and redrew borders.",
    rubricBreakdown: [
      { criterion: "Identifies reparations", awardedMarks: 2, evidenceText: "imposed reparations on Germany" },
      { criterion: "Explains territorial change", awardedMarks: 2, evidenceText: "redrew borders" },
    ],
  });

  assert.equal(audit.reviewRequired, false);
  assert.equal(audit.coverageRate, 1);
  assert.equal(audit.evidenceLinkedMarks, 4);
});

test("positive marks without traceable evidence require human verification", () => {
  const audit = auditAIExaminerSemanticEvidence({
    extractedAnswer: "Photosynthesis uses light energy.",
    rubricBreakdown: [
      { criterion: "Explains chlorophyll", awardedMarks: 2, evidenceText: "chlorophyll absorbs red light" },
      { criterion: "States energy source", awardedMarks: 1 },
    ],
  });

  assert.equal(audit.reviewRequired, true);
  assert.equal(audit.coverageRate, 0);
  assert.equal(audit.checks[0]?.status, "REVIEW");
  assert.equal(audit.checks[1]?.status, "REVIEW");
});

test("zero-mark criteria do not require supporting evidence", () => {
  const audit = auditAIExaminerSemanticEvidence({
    extractedAnswer: "Incomplete response.",
    rubricBreakdown: [{ criterion: "Evaluation", awardedMarks: 0 }],
  });

  assert.equal(audit.reviewRequired, false);
  assert.equal(audit.coverageRate, 1);
  assert.equal(audit.checks[0]?.status, "NOT_REQUIRED");
});

test("evidence normalization tolerates unicode quotes and whitespace", () => {
  const audit = auditAIExaminerSemanticEvidence({
    extractedAnswer: "The author writes “freedom”   as the central idea.",
    rubricBreakdown: [{ criterion: "Uses textual support", awardedMarks: 3, evidenceText: 'writes "freedom" as the central idea' }],
  });

  assert.equal(audit.reviewRequired, false);
  assert.equal(audit.coverageRate, 1);
});
