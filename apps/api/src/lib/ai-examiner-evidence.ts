export type AIExaminerEvidenceBreakdownRow = {
  criterion: string;
  awardedMarks: number;
  evidenceText?: string | null;
};

export type AIExaminerEvidenceAuditStatus = "PASS" | "REVIEW" | "NOT_REQUIRED";

export type AIExaminerEvidenceAudit = {
  reviewRequired: boolean;
  coverageRate: number;
  positivelyAwardedMarks: number;
  evidenceLinkedMarks: number;
  checks: Array<{
    criterion: string;
    status: AIExaminerEvidenceAuditStatus;
    awardedMarks: number;
    evidenceText: string | null;
    rationale: string;
  }>;
};

function normalizeEvidenceText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function auditAIExaminerSemanticEvidence(input: {
  extractedAnswer?: string | null;
  awardedMarks?: number;
  rubricBreakdown: AIExaminerEvidenceBreakdownRow[];
}): AIExaminerEvidenceAudit {
  const answer = normalizeEvidenceText(input.extractedAnswer ?? "");
  let positivelyAwardedMarks = 0;
  let evidenceLinkedMarks = 0;

  const checks = input.rubricBreakdown.map(row => {
    const awardedMarks = Number.isFinite(row.awardedMarks) ? Math.max(0, row.awardedMarks) : 0;
    const evidenceText = row.evidenceText?.trim() || null;

    if (awardedMarks <= 0) {
      return {
        criterion: row.criterion,
        status: "NOT_REQUIRED" as const,
        awardedMarks,
        evidenceText,
        rationale: "No positive marks were awarded for this criterion, so a supporting student-evidence excerpt is not required.",
      };
    }

    positivelyAwardedMarks += awardedMarks;
    if (!evidenceText) {
      return {
        criterion: row.criterion,
        status: "REVIEW" as const,
        awardedMarks,
        evidenceText: null,
        rationale: "Positive rubric marks were awarded without a linked student-evidence excerpt.",
      };
    }

    const normalizedEvidence = normalizeEvidenceText(evidenceText);
    const linked = Boolean(answer) && normalizedEvidence.length >= 2 && answer.includes(normalizedEvidence);
    if (linked) evidenceLinkedMarks += awardedMarks;

    return {
      criterion: row.criterion,
      status: linked ? "PASS" as const : "REVIEW" as const,
      awardedMarks,
      evidenceText,
      rationale: linked
        ? "The evidence excerpt is traceable to the provider's extracted student answer."
        : "The evidence excerpt is not literally traceable to the extracted student answer and requires human verification.",
    };
  });

  if (!input.rubricBreakdown.length && (input.awardedMarks ?? 0) > 0) {
    positivelyAwardedMarks = input.awardedMarks ?? 0;
    checks.push({
      criterion: "Rubric evidence coverage",
      status: "REVIEW",
      awardedMarks: input.awardedMarks ?? 0,
      evidenceText: null,
      rationale: "Positive semantic marks were awarded without criterion-level rubric breakdown evidence.",
    });
  }

  const coverageRate = positivelyAwardedMarks > 0
    ? Math.max(0, Math.min(1, evidenceLinkedMarks / positivelyAwardedMarks))
    : 1;

  return {
    reviewRequired: checks.some(check => check.status === "REVIEW"),
    coverageRate: Math.round(coverageRate * 1_000_000) / 1_000_000,
    positivelyAwardedMarks: Math.round(positivelyAwardedMarks * 10_000) / 10_000,
    evidenceLinkedMarks: Math.round(evidenceLinkedMarks * 10_000) / 10_000,
    checks,
  };
}

export const aiExaminerEvidenceInternals = { normalizeEvidenceText };
