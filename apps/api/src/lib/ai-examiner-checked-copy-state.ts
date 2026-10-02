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
      if (x < 0 || y < 0 || width < 0 || height < 0 || x + width > 1.000001 || y + height > 1.000001) continue;
      hints.push({ kind: kind as Hint["kind"], pageNumber: Math.trunc(pageNumber), x, y, width, height, text: typeof hint.text === "string" ? concise(hint.text, 300) : null });
    }
    if (hints.length) byQuestion.set(record.questionKey.toLocaleLowerCase("en"), hints);
  }
  return byQuestion;
}

function hintType(kind: Hint["kind"]): AIExaminerAnnotationType {
  return kind === "NOTE" ? "TEXT_COMMENT" : kind;
}

function scoreAnchor(hint: Hint) {
  const width = 0.13;
  const height = 0.04;
  const x = clamp(hint.x + hint.width + 0.01, 0, 1 - width);
  const y = clamp(hint.y, 0, 1 - height);
  return checkedCopyAnchorSchema.parse({
    pageNumber: hint.pageNumber, x, y, width, height, rotation: -2,
    placementConfidence: 0.9, evidenceText: hint.text ?? null,
  });
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
}) {
  const hintsByQuestion = checkedCopyHintsFromDiagnostics(input.diagnostics);
  const annotations: CheckedCopyDraftAnnotation[] = [];
  let order = 0;

  for (const question of input.questions) {
    const key = question.questionKey.toLocaleLowerCase("en");
    const hints = hintsByQuestion.get(key) ?? [];
    for (const hint of hints) {
      const content = hint.kind === "NOTE" ? concise(hint.text || question.teacherComment || question.feedback || "Check this step") : hint.text ?? null;
      annotations.push({
        questionKey: question.questionKey,
        rubricCriterion: null,
        type: hintType(hint.kind),
        content,
        marks: null,
        confidence: question.confidence ?? null,
        sourceEvidence: hint.text ?? null,
        vectorData: null,
        authorType: "AI",
        approvalState: "AI_DRAFT",
        sortOrder: order++,
        anchor: checkedCopyAnchorSchema.parse({
          pageNumber: hint.pageNumber, x: hint.x, y: hint.y, width: hint.width, height: hint.height,
          rotation: 0, placementConfidence: question.confidence ?? null, evidenceText: hint.text ?? null,
        }),
      });
    }

    const firstHint = hints[0] ?? null;
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
      approvalState: firstHint ? "AI_DRAFT" : "POSITION_REVIEW_REQUIRED",
      sortOrder: order++,
      anchor: firstHint ? scoreAnchor(firstHint) : null,
    });

    const note = concise(question.teacherComment || (question.finalMarks < question.maxMarks ? question.feedback : null));
    if (note) {
      const noteHint = hints.find(hint => hint.kind === "NOTE") ?? firstHint;
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
        approvalState: noteHint ? "AI_DRAFT" : "POSITION_REVIEW_REQUIRED",
        sortOrder: order++,
        anchor: noteHint ? scoreAnchor(noteHint) : null,
      });
    }
  }

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
    approvalState: "POSITION_REVIEW_REQUIRED",
    sortOrder: order++,
    anchor: null,
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
