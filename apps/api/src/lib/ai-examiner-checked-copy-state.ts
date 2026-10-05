import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  AIExaminerAnnotationApprovalState,
  AIExaminerAnnotationAuthorType,
  AIExaminerAnnotationType,
} from "@prisma/client";

export const checkedCopyAnchorSchema = z.object({
  pageNumber: z.coerce.number().int().min(1).max(1000),
  x: z.coerce.number().min(0).max(1),
  y: z.coerce.number().min(0).max(1),
  width: z.coerce.number().min(0).max(1),
  height: z.coerce.number().min(0).max(1),
  rotation: z.coerce.number().min(-360).max(360).default(0),
  placementConfidence: z.coerce.number().min(0).max(1).nullable().optional(),
  evidenceText: z.string().trim().max(4000).nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.x + value.width > 1.000001) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["width"], message: "Anchor extends beyond page width" });
  if (value.y + value.height > 1.000001) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["height"], message: "Anchor extends beyond page height" });
});

export const checkedCopyAnnotationTypeSchema = z.enum([
  "TICK","CROSS","UNDERLINE","CIRCLE","RECTANGLE","HIGHLIGHT","ARROW","FREEHAND",
  "TEXT_COMMENT","QUESTION_MARK","STEP_MARK","QUESTION_SCORE","PAGE_SCORE","TOTAL_SCORE",
  "RUBRIC_NOTE","ERROR_LABEL",
]);

export const CHECKED_COPY_AUTO_APPROVE_PLACEMENT_CONFIDENCE = 0.8;

function placementState(anchor: z.infer<typeof checkedCopyAnchorSchema> | null) {
  const confidence = anchor?.placementConfidence ?? 0;
  return anchor && confidence >= CHECKED_COPY_AUTO_APPROVE_PLACEMENT_CONFIDENCE
    ? ("AI_DRAFT" as const)
    : ("POSITION_REVIEW_REQUIRED" as const);
}

export const checkedCopyVectorDataSchema = z.object({
  points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(2).max(5000),
}).passthrough();

export type CheckedCopyDraftAnnotation = {
  questionKey: string | null;
  rubricCriterion: string | null;
  type: AIExaminerAnnotationType;
  content: string | null;
  marks: number | null;
  confidence: number | null;
  sourceEvidence: string | null;
  vectorData: unknown | null;
  authorType: AIExaminerAnnotationAuthorType;
  approvalState: AIExaminerAnnotationApprovalState;
  sortOrder: number;
  anchor: z.infer<typeof checkedCopyAnchorSchema> | null;
};

type Hint = {
  kind: "TICK" | "CROSS" | "UNDERLINE" | "HIGHLIGHT" | "NOTE";
  pageNumber: number;
  x: number; y: number; width: number; height: number;
  text?: string | null;
};

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function concise(value: string | null | undefined, maximum = 140) {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  return normalized.length <= maximum ? normalized : normalized.slice(0, maximum - 1).trimEnd() + "…";
}

type RubricBreakdownRow = {
  criterion: string;
  maxMarks: number;
  awardedMarks: number;
  rationale: string;
  evidenceText: string | null;
};

function rubricRows(value: unknown): RubricBreakdownRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const row = raw as Record<string, unknown>;
    const criterion = typeof row.criterion === "string" ? concise(row.criterion, 1000) : "";
    const rationale = typeof row.rationale === "string" ? concise(row.rationale, 2000) : "";
    const evidenceText = typeof row.evidenceText === "string" ? concise(row.evidenceText, 2000) : null;
    const maxMarks = Number(row.maxMarks);
    const awardedMarks = Number(row.awardedMarks);
    if (!criterion || !Number.isFinite(maxMarks) || !Number.isFinite(awardedMarks) || maxMarks < 0 || awardedMarks < 0) return [];
    return [{ criterion, maxMarks, awardedMarks, rationale, evidenceText }];
  });
}

function normalizedEvidence(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim().toLocaleLowerCase("en") ?? "";
}

function evidenceHint(hints: Hint[], evidenceText: string | null) {
  const evidence = normalizedEvidence(evidenceText);
  if (!evidence) return null;
  return hints.find(hint => {
    const text = normalizedEvidence(hint.text);
    if (!text) return false;
    return text.includes(evidence) || evidence.includes(text);
  }) ?? null;
}

function lastVisibleHint(hints: Hint[]) {
  return [...hints].sort((left, right) =>
    right.pageNumber - left.pageNumber ||
    (right.y + right.height) - (left.y + left.height) ||
    (right.x + right.width) - (left.x + left.width)
  )[0] ?? null;
}

function correctionHint(hints: Hint[]) {
  const priority: Hint["kind"][] = ["NOTE", "CROSS", "HIGHLIGHT", "UNDERLINE", "TICK"];
  for (const kind of priority) {
    const candidates = hints.filter(hint => hint.kind === kind);
    const candidate = lastVisibleHint(candidates);
    if (candidate) return candidate;
  }
  return lastVisibleHint(hints);
}

export function sha256Buffer(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

export function checkedCopyHintsFromDiagnostics(diagnostics: unknown) {
  const byQuestion = new Map<string, Hint[]>();
  if (!diagnostics || typeof diagnostics !== "object" || Array.isArray(diagnostics)) return byQuestion;
  const rows = (diagnostics as Record<string, unknown>).questionDiagnostics;
  if (!Array.isArray(rows)) return byQuestion;
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const record = row as Record<string, unknown>;
    if (typeof record.questionKey !== "string" || !Array.isArray(record.annotationHints)) continue;
    const hints: Hint[] = [];
    for (const raw of record.annotationHints) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const hint = raw as Record<string, unknown>;
      const kind = String(hint.kind);
      if (!["TICK","CROSS","UNDERLINE","HIGHLIGHT","NOTE"].includes(kind)) continue;
      const pageNumber = Number(hint.pageNumber);
      const x = Number(hint.x), y = Number(hint.y), width = Number(hint.width), height = Number(hint.height);
      if (![pageNumber,x,y,width,height].every(Number.isFinite) || pageNumber < 1) continue;
      if (x < 0 || y < 0 || width <= 0.002 || height <= 0.002 || x + width > 1.000001 || y + height > 1.000001) continue;
      hints.push({ kind: kind as Hint["kind"], pageNumber: Math.trunc(pageNumber), x, y, width, height, text: typeof hint.text === "string" ? concise(hint.text, 300) : null });
    }
    if (hints.length) byQuestion.set(record.questionKey.toLocaleLowerCase("en"), hints);
  }
  return byQuestion;
}

function hintType(kind: Hint["kind"]): AIExaminerAnnotationType {
  return kind === "NOTE" ? "TEXT_COMMENT" : kind;
}

type OccupiedAnchor = { pageNumber: number; x: number; y: number; width: number; height: number };

function placementSize(type: AIExaminerAnnotationType): [number, number] {
  if (type === "RUBRIC_NOTE") return [0.09, 0.035];
  if (type === "ERROR_LABEL") return [0.18, 0.04];
  if (type === "QUESTION_SCORE") return [0.13, 0.04];
  if (type === "TOTAL_SCORE") return [0.19, 0.05];
  return [0.12, 0.04];
}

function collides(candidate: OccupiedAnchor, occupied: OccupiedAnchor[]) {
  const padding = 0.008;
  return occupied.some(row => row.pageNumber === candidate.pageNumber &&
    candidate.x < row.x + row.width + padding &&
    candidate.x + candidate.width + padding > row.x &&
    candidate.y < row.y + row.height + padding &&
    candidate.y + candidate.height + padding > row.y);
}

function placeNearHint(
  hint: Hint,
  type: AIExaminerAnnotationType,
  occupied: OccupiedAnchor[],
  placementConfidence: number,
  evidenceText: string | null,
  ordinal = 0,
) {
  const [width, height] = placementSize(type);
  const candidates = [
    { x: hint.x + hint.width + 0.012, y: hint.y },
    { x: hint.x - width - 0.012, y: hint.y },
    { x: hint.x, y: hint.y + hint.height + 0.008 },
    { x: hint.x, y: hint.y - height - 0.008 },
    { x: 0.82 - width, y: hint.y + ordinal * (height + 0.012) },
    { x: 0.05, y: hint.y + ordinal * (height + 0.012) },
  ];
  for (const candidate of candidates) {
    const row = {
      pageNumber: hint.pageNumber,
      x: clamp(candidate.x, 0, 1 - width),
      y: clamp(candidate.y, 0, 1 - height),
      width,
      height,
    };
    if (!collides(row, occupied)) {
      occupied.push(row);
      return checkedCopyAnchorSchema.parse({
        ...row,
        rotation: ordinal % 2 ? 1.2 : -1.2,
        placementConfidence,
        evidenceText,
      });
    }
  }
  return null;
}

function placeTotalScore(sourcePageCount: number, occupied: OccupiedAnchor[]) {
  const [width, height] = placementSize("TOTAL_SCORE");
  for (let step = 0; step < 8; step++) {
    const row = {
      pageNumber: Math.max(1, sourcePageCount),
      x: 0.94 - width,
      y: clamp(0.9 - step * (height + 0.018), 0.55, 1 - height),
      width,
      height,
    };
    if (!collides(row, occupied)) {
      occupied.push(row);
      return checkedCopyAnchorSchema.parse({
        ...row,
        rotation: -1.5,
        placementConfidence: 0.9,
        evidenceText: null,
      });
    }
  }
  return null;
}

export function autoPlaceCheckedCopyAnnotations(input: {
  diagnostics: unknown;
  sourcePageCount: number;
  annotations: Array<{
    id: string;
    questionKey: string | null;
    type: AIExaminerAnnotationType;
    sourceEvidence?: string | null;
    approvalState: AIExaminerAnnotationApprovalState;
    anchor?: OccupiedAnchor | null;
  }>;
}) {
  const hintsByQuestion = checkedCopyHintsFromDiagnostics(input.diagnostics);
  const occupied: OccupiedAnchor[] = input.annotations
    .filter(row => row.approvalState !== "REJECTED" && row.anchor)
    .map(row => ({ ...row.anchor! }));

  // Older evaluation revisions may predate diagnostic annotation hints. In that case,
  // reuse trusted, already-positioned annotations for the same question as low-confidence
  // spatial seeds rather than forcing the teacher to place every remaining rubric mark.
  const seededHintsByQuestion = new Map<string, Hint[]>();
  for (const row of input.annotations) {
    if (row.approvalState === "REJECTED" || !row.questionKey || !row.anchor) continue;
    const key = row.questionKey.toLocaleLowerCase("en");
    const existing = seededHintsByQuestion.get(key) ?? [];
    existing.push({
      kind: "NOTE",
      pageNumber: row.anchor.pageNumber,
      x: row.anchor.x,
      y: row.anchor.y,
      width: row.anchor.width,
      height: row.anchor.height,
      text: row.sourceEvidence ?? null,
    });
    seededHintsByQuestion.set(key, existing);
  }

  const ordinals = new Map<string, number>();
  const placements: Array<{ id: string; anchor: z.infer<typeof checkedCopyAnchorSchema> }> = [];

  for (const annotation of input.annotations) {
    if (annotation.approvalState === "REJECTED" || annotation.anchor) continue;
    if (annotation.type === "TOTAL_SCORE") {
      const anchor = placeTotalScore(input.sourcePageCount, occupied);
      if (anchor) placements.push({ id: annotation.id, anchor });
      continue;
    }
    if (!annotation.questionKey) continue;
    const key = annotation.questionKey.toLocaleLowerCase("en");
    const diagnosticHints = (hintsByQuestion.get(key) ?? []).filter(hint => hint.pageNumber <= input.sourcePageCount);
    const seededHints = seededHintsByQuestion.get(key) ?? [];
    const hints = diagnosticHints.length ? diagnosticHints : seededHints;
    if (!hints.length) continue;

    const ordinal = ordinals.get(key) ?? 0;
    ordinals.set(key, ordinal + 1);
    const exact = diagnosticHints.length ? evidenceHint(diagnosticHints, annotation.sourceEvidence ?? null) : null;
    const hint = exact ?? hints[Math.min(ordinal, hints.length - 1)] ?? hints[0]!;
    const anchor = placeNearHint(
      hint,
      annotation.type,
      occupied,
      exact ? 0.92 : diagnosticHints.length ? 0.68 : 0.55,
      annotation.sourceEvidence ?? hint.text ?? null,
      ordinal,
    );
    if (anchor) placements.push({ id: annotation.id, anchor });
  }
  return placements;
}

export function buildAIExaminerCheckedCopyDraft(input: {
  diagnostics: unknown;
  questions: Array<{
    questionKey: string;
    maxMarks: number;
    finalMarks: number;
    confidence?: number | null;
    teacherComment?: string | null;
    feedback?: string | null;
    rubricBreakdown?: unknown;
  }>;
  totalMarks: number;
  maximumMarks: number;
  sourcePageCount?: number;
}) {
  const hintsByQuestion = checkedCopyHintsFromDiagnostics(input.diagnostics);
  const annotations: CheckedCopyDraftAnnotation[] = [];
  const occupied: OccupiedAnchor[] = [];
  let order = 0;

  for (const question of input.questions) {
    const key = question.questionKey.toLocaleLowerCase("en");
    const hints = (hintsByQuestion.get(key) ?? []).filter(hint => !input.sourcePageCount || hint.pageNumber <= input.sourcePageCount);
    for (const hint of hints) {
      // NOTE hints are semantic locators for rubric/error comments. Rendering them directly
      // duplicates the teacher comment and makes a fresh AI-checked copy unnecessarily noisy.
      if (hint.kind === "NOTE") continue;
      const directAnchor = checkedCopyAnchorSchema.parse({
        pageNumber: hint.pageNumber, x: hint.x, y: hint.y, width: hint.width, height: hint.height,
        rotation: 0, placementConfidence: question.confidence ?? null, evidenceText: hint.text ?? null,
      });
      annotations.push({
        questionKey: question.questionKey,
        rubricCriterion: null,
        type: hintType(hint.kind),
        content: hint.text ?? null,
        marks: null,
        confidence: question.confidence ?? null,
        sourceEvidence: hint.text ?? null,
        vectorData: null,
        authorType: "AI",
        approvalState: placementState(directAnchor),
        sortOrder: order++,
        anchor: directAnchor,
      });
    }

    occupied.push(...hints.map(hint => ({ pageNumber: hint.pageNumber, x: hint.x, y: hint.y, width: hint.width, height: hint.height })));
    let rubricOrdinal = 0;
    for (const criterion of rubricRows(question.rubricBreakdown)) {
      const matchedHint = evidenceHint(hints, criterion.evidenceText);
      const fallbackHint = matchedHint ?? hints[Math.min(rubricOrdinal, hints.length - 1)] ?? null;
      const inferredAnchor = fallbackHint ? placeNearHint(
        fallbackHint,
        "RUBRIC_NOTE",
        occupied,
        matchedHint ? 0.92 : 0.68,
        criterion.evidenceText ?? fallbackHint.text ?? null,
        rubricOrdinal,
      ) : null;
      rubricOrdinal += 1;
      const content = concise(
        `${criterion.criterion}: +${criterion.awardedMarks}/${criterion.maxMarks}${criterion.rationale ? ` — ${criterion.rationale}` : ""}`,
        300,
      );
      annotations.push({
        questionKey: question.questionKey,
        rubricCriterion: criterion.criterion,
        type: "RUBRIC_NOTE",
        content,
        marks: criterion.awardedMarks,
        confidence: question.confidence ?? null,
        sourceEvidence: criterion.evidenceText,
        vectorData: null,
        authorType: "AI",
        approvalState: placementState(inferredAnchor),
        sortOrder: order++,
        anchor: inferredAnchor,
      });
    }

    const firstHint = hints[0] ?? null;
    const scoreHint = lastVisibleHint(hints);
    const questionScoreAnchor = scoreHint ? placeNearHint(scoreHint, "QUESTION_SCORE", occupied, 0.86, scoreHint.text ?? null, 0) : null;
    annotations.push({
      questionKey: question.questionKey,
      rubricCriterion: null,
      type: "QUESTION_SCORE",
      content: `${question.questionKey}: ${question.finalMarks}/${question.maxMarks}`,
      marks: question.finalMarks,
      confidence: question.confidence ?? null,
      sourceEvidence: null,
      vectorData: null,
      authorType: "AI",
      approvalState: placementState(questionScoreAnchor),
      sortOrder: order++,
      anchor: questionScoreAnchor,
    });

    const note = concise(question.teacherComment || (question.finalMarks < question.maxMarks ? question.feedback : null));
    if (note) {
      const noteHint = question.finalMarks < question.maxMarks ? correctionHint(hints) : (hints.find(hint => hint.kind === "NOTE") ?? firstHint);
      const explicitCorrection = Boolean(noteHint && ["NOTE","CROSS","HIGHLIGHT"].includes(noteHint.kind));
      const noteAnchor = noteHint ? placeNearHint(noteHint, question.finalMarks < question.maxMarks ? "ERROR_LABEL" : "TEXT_COMMENT", occupied, explicitCorrection ? 0.88 : 0.66, noteHint.text ?? null, 1) : null;
      annotations.push({
        questionKey: question.questionKey,
        rubricCriterion: null,
        type: question.finalMarks < question.maxMarks ? "ERROR_LABEL" : "TEXT_COMMENT",
        content: note,
        marks: null,
        confidence: question.confidence ?? null,
        sourceEvidence: null,
        vectorData: null,
        authorType: "AI",
        approvalState: placementState(noteAnchor),
        sortOrder: order++,
        anchor: noteAnchor,
      });
    }
  }

  const totalAnchor = input.sourcePageCount ? placeTotalScore(input.sourcePageCount, occupied) : null;
  annotations.push({
    questionKey: null,
    rubricCriterion: null,
    type: "TOTAL_SCORE",
    content: `Total = ${input.totalMarks}/${input.maximumMarks}`,
    marks: input.totalMarks,
    confidence: null,
    sourceEvidence: null,
    vectorData: null,
    authorType: "SYSTEM",
    approvalState: placementState(totalAnchor),
    sortOrder: order++,
    anchor: totalAnchor,
  });

  return annotations;
}

export function assertCheckedCopyApprovalReady(input: {
  annotations: Array<{
    type: AIExaminerAnnotationType;
    questionKey: string | null;
    content: string | null;
    marks: unknown;
    approvalState: AIExaminerAnnotationApprovalState;
    anchor: unknown | null;
  }>;
  questions: Array<{ questionKey: string; finalMarks: number }>;
  totalMarks: number;
}) {
  const active = input.annotations.filter(annotation => annotation.approvalState !== "REJECTED");
  const unpositioned = active.filter(annotation => annotation.approvalState === "POSITION_REVIEW_REQUIRED" || !annotation.anchor);
  if (unpositioned.length) {
    throw new Error(`POSITION_REVIEW_REQUIRED:${unpositioned.length}`);
  }

  const scores = new Map(active.filter(row => row.type === "QUESTION_SCORE" && row.questionKey).map(row => [row.questionKey!.toLocaleLowerCase("en"), Number(row.marks)]));
  for (const question of input.questions) {
    const displayed = scores.get(question.questionKey.toLocaleLowerCase("en"));
    if (displayed == null || !Number.isFinite(displayed) || Math.abs(displayed - question.finalMarks) > 0.001) {
      throw new Error(`QUESTION_SCORE_MISMATCH:${question.questionKey}`);
    }
  }
  const totals = active.filter(row => row.type === "TOTAL_SCORE");
  if (totals.length !== 1 || !Number.isFinite(Number(totals[0]!.marks)) || Math.abs(Number(totals[0]!.marks) - input.totalMarks) > 0.001) {
    throw new Error("TOTAL_SCORE_MISMATCH");
  }
}
