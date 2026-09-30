import type { AIExaminerProviderResult, AIExaminerRubricQuestion } from "./ai-examiner-engine.js";
import {
  AI_EXAMINER_QUESTION_TYPES,
  type AIExaminerQuestionType,
} from "./ai-examiner-assessment-router.js";
import {
  AIExaminerScoringError,
  scoreDeterministicQuestion,
  type AIExaminerDeterministicInput,
  type AIExaminerDeterministicScoringRule,
} from "./ai-examiner-deterministic.js";
import {
  aiExaminerRubricQuestionInputSchema,
  aiExaminerStoredQuestionRoute,
} from "./ai-examiner-question-config.js";
import {
  verifyAIExaminerStemResponse,
  type AIExaminerStemValidationConfig,
  type AIExaminerStemVerification,
} from "./ai-examiner-stem-verifier.js";
import {
  verifyChemistryEquation,
  type ChemistryVerification,
} from "./ai-examiner-chemistry-verifier.js";
import {
  verifyAccountingStatement,
  type AccountingValidationConfig,
  type AccountingVerification,
} from "./ai-examiner-accounting-verifier.js";
import {
  auditAIExaminerSemanticEvidence,
  type AIExaminerEvidenceAudit,
} from "./ai-examiner-evidence.js";

export type AIExaminerResolvedRubricQuestion = {
  key: string;
  maxMarks: number;
  criteria: string;
  modelAnswer?: string | null;
  concepts: string[];
  questionType: AIExaminerQuestionType;
  answerKey?: unknown;
  scoring?: AIExaminerDeterministicScoringRule;
  requiresVisualEvidence: boolean;
  requiresCodeExecution: boolean;
  stemValidation?: AIExaminerStemValidationConfig;
  chemistryValidation?: {
    expectedEquation?: string;
    requireBalanced: boolean;
    allowReverse: boolean;
  };
  accountingValidation?: AccountingValidationConfig;
};

type ProviderQuestion = AIExaminerProviderResult["questions"][number];

export type AIExaminerReconciledQuestion = {
  questionKey: string;
  maxMarks: number;
  suggestedMarks: number | null;
  confidence: number;
  feedback: string;
  extractedAnswer: string | null;
  rubricBreakdown: Array<{
    criterion: string;
    maxMarks: number;
    awardedMarks: number;
    rationale: string;
    evidenceText?: string | null;
  }>;
  concepts: ProviderQuestion["concepts"];
  flags: ProviderQuestion["flags"];
  reviewRequired: boolean;
  engine: string;
  deterministicStatus: string | null;
  scoringError: { code: string; message: string } | null;
  specializedEvidence: AIExaminerStemVerification | ChemistryVerification | AccountingVerification | null;
  evidenceAudit: AIExaminerEvidenceAudit | null;
};

const deterministicTypes = new Set<AIExaminerQuestionType>([
  "MCQ",
  "MSQ",
  "TRUE_FALSE",
  "ASSERTION_REASON",
  "FILL_BLANK",
  "MATCHING",
  "ONE_WORD",
  "NUMERICAL",
]);

function isKnownQuestionType(value: unknown): value is AIExaminerQuestionType {
  return typeof value === "string" && (AI_EXAMINER_QUESTION_TYPES as readonly string[]).includes(value);
}

function modelAnswers(value: unknown) {
  const answers = new Map<string, string>();
  if (!value || typeof value !== "object" || !("questions" in value)) return answers;
  const rows = (value as { questions?: unknown[] }).questions;
  if (!Array.isArray(rows)) return answers;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const key = "key" in row ? String((row as { key?: unknown }).key ?? "").trim() : "";
    const answer = "answer" in row ? String((row as { answer?: unknown }).answer ?? "") : "";
    if (key && answer) answers.set(key.toLowerCase(), answer);
  }
  return answers;
}

export function resolveAIExaminerRubricQuestions(value: unknown, modelAnswer: unknown): AIExaminerResolvedRubricQuestion[] {
  const rows = value && typeof value === "object" && "questions" in value
    ? (value as { questions?: unknown[] }).questions
    : null;
  if (!Array.isArray(rows)) throw new AIExaminerScoringError("AI_EXAMINER_RUBRIC_INVALID", "Active rubric has no question definitions");

  const answers = modelAnswers(modelAnswer);
  return rows.map((row, index) => {
    if (!row || typeof row !== "object") {
      throw new AIExaminerScoringError("AI_EXAMINER_RUBRIC_INVALID", `Rubric question ${index + 1} is invalid`);
    }
    const source = row as Record<string, unknown>;
    const key = String(source.key ?? "").trim();
    const parsed = aiExaminerRubricQuestionInputSchema.safeParse({
      ...source,
      questionType: isKnownQuestionType(source.questionType) ? source.questionType : "LONG_ANSWER",
      modelAnswer: answers.get(key.toLowerCase()) ?? null,
    });
    if (!parsed.success) {
      throw new AIExaminerScoringError(
        "AI_EXAMINER_RUBRIC_INVALID",
        `Rubric question ${index + 1} is invalid: ${parsed.error.issues.slice(0, 3).map(issue => issue.message).join("; ")}`,
      );
    }
    return parsed.data as AIExaminerResolvedRubricQuestion;
  });
}

export function aiExaminerProviderQuestions(questions: AIExaminerResolvedRubricQuestion[]): AIExaminerRubricQuestion[] {
  return questions.map(question => {
    const route = aiExaminerStoredQuestionRoute(question);
    return {
      key: question.key,
      maxMarks: question.maxMarks,
      criteria: question.criteria,
      concepts: question.concepts,
      questionType: question.questionType,
      evaluationMode: route.deterministic ? "EXTRACT_ONLY" : "RUBRIC",
      // Withhold deterministic answer keys from extraction to avoid anchoring/bias.
      modelAnswer: route.deterministic ? null : question.modelAnswer ?? null,
    };
  });
}

function decodeStructuredAnswer(questionType: AIExaminerQuestionType, extractedAnswer: string | null | undefined): unknown {
  if (extractedAnswer == null) {
    throw new AIExaminerScoringError("AI_EXAMINER_EXTRACTION_MISSING", "No extractable answer was returned for deterministic scoring");
  }
  if (questionType === "MSQ") {
    let parsed: unknown;
    try { parsed = JSON.parse(extractedAnswer); }
    catch { throw new AIExaminerScoringError("AI_EXAMINER_EXTRACTION_INVALID", "MSQ extraction must be a JSON array"); }
    if (!Array.isArray(parsed)) throw new AIExaminerScoringError("AI_EXAMINER_EXTRACTION_INVALID", "MSQ extraction must be a JSON array");
    return parsed;
  }
  if (questionType === "MATCHING") {
    let parsed: unknown;
    try { parsed = JSON.parse(extractedAnswer); }
    catch { throw new AIExaminerScoringError("AI_EXAMINER_EXTRACTION_INVALID", "Matching extraction must be a JSON object"); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new AIExaminerScoringError("AI_EXAMINER_EXTRACTION_INVALID", "Matching extraction must be a JSON object");
    }
    return parsed;
  }
  return extractedAnswer;
}

function deterministicInput(
  question: AIExaminerResolvedRubricQuestion,
  provider: ProviderQuestion,
): AIExaminerDeterministicInput {
  if (!deterministicTypes.has(question.questionType)) {
    throw new AIExaminerScoringError("AI_EXAMINER_ROUTE_INVALID", "Question is not supported by deterministic scoring");
  }
  const correctAnswer = question.answerKey ?? question.modelAnswer;
  if (correctAnswer === undefined || correctAnswer === null || correctAnswer === "") {
    throw new AIExaminerScoringError("AI_EXAMINER_ANSWER_KEY_INVALID", "Deterministic answer key is missing");
  }
  return {
    questionKey: question.key,
    questionType: question.questionType as AIExaminerDeterministicInput["questionType"],
    maxMarks: question.maxMarks,
    correctAnswer,
    studentAnswer: decodeStructuredAnswer(question.questionType, provider.extractedAnswer),
    scoring: question.scoring,
  };
}

function providerByKey(result: AIExaminerProviderResult) {
  return new Map(result.questions.map(question => [question.questionKey.toLowerCase(), question]));
}

export function reconcileAIExaminerProviderResult(
  questions: AIExaminerResolvedRubricQuestion[],
  result: AIExaminerProviderResult,
  reviewThreshold: number,
) {
  const providerQuestions = providerByKey(result);
  const reconciled: AIExaminerReconciledQuestion[] = questions.map(question => {
    const provider = providerQuestions.get(question.key.toLowerCase());
    if (!provider) {
      throw new AIExaminerScoringError("AI_EXAMINER_PROVIDER_QUESTION_MISSING", `Provider result is missing ${question.key}`);
    }
    const route = aiExaminerStoredQuestionRoute(question);
    const baseReview = provider.confidence < reviewThreshold || provider.flags.length > 0;

    if (!route.deterministic) {
      let specializedEvidence: AIExaminerStemVerification | ChemistryVerification | AccountingVerification | null = null;
      let evidenceAudit: AIExaminerEvidenceAudit | null = null;
      if (route.engine === "RUBRIC_SEMANTIC") {
        evidenceAudit = auditAIExaminerSemanticEvidence({
          extractedAnswer: provider.extractedAnswer,
          awardedMarks: provider.awardedMarks,
          rubricBreakdown: provider.rubricBreakdown,
        });
      }
      if (route.engine === "SPECIALIZED_SYMBOLIC" && provider.extractedAnswer) {
        if (question.stemValidation) {
          specializedEvidence = verifyAIExaminerStemResponse({
            response: provider.extractedAnswer,
            config: question.stemValidation,
          });
        } else if (question.questionType === "CHEMISTRY_EQUATION" && question.chemistryValidation) {
          specializedEvidence = verifyChemistryEquation({
            response: provider.extractedAnswer,
            expectedEquation: question.chemistryValidation.expectedEquation,
            requireBalanced: question.chemistryValidation.requireBalanced,
            allowReverse: question.chemistryValidation.allowReverse,
          });
        } else if (question.questionType === "ACCOUNTING_STATEMENT" && question.accountingValidation) {
          specializedEvidence = verifyAccountingStatement({
            response: provider.extractedAnswer,
            config: question.accountingValidation,
          });
        }
      }
      return {
        questionKey: question.key,
        maxMarks: question.maxMarks,
        suggestedMarks: provider.awardedMarks,
        confidence: provider.confidence,
        feedback: provider.feedback,
        extractedAnswer: provider.extractedAnswer ?? null,
        rubricBreakdown: provider.rubricBreakdown,
        concepts: provider.concepts,
        flags: provider.flags,
        reviewRequired: true,
        engine: route.engine,
        deterministicStatus: null,
        scoringError: null,
        specializedEvidence,
        evidenceAudit,
      };
    }

    try {
      const scored = scoreDeterministicQuestion(deterministicInput(question, provider));
      return {
        questionKey: question.key,
        maxMarks: question.maxMarks,
        suggestedMarks: scored.awardedMarks,
        confidence: provider.confidence,
        feedback: provider.feedback,
        extractedAnswer: provider.extractedAnswer ?? null,
        rubricBreakdown: [{
          criterion: "Deterministic answer-key scoring",
          maxMarks: question.maxMarks,
          awardedMarks: scored.awardedMarks,
          rationale: scored.evidence.rule,
        }],
        concepts: provider.concepts,
        flags: provider.flags,
        reviewRequired: baseReview,
        engine: route.engine,
        deterministicStatus: scored.status,
        scoringError: null,
        specializedEvidence: null,
        evidenceAudit: null,
      };
    } catch (error) {
      const scoringError = error instanceof AIExaminerScoringError
        ? { code: error.code, message: error.message }
        : { code: "AI_EXAMINER_SCORING_ERROR", message: error instanceof Error ? error.message : "Deterministic scoring failed" };
      return {
        questionKey: question.key,
        maxMarks: question.maxMarks,
        suggestedMarks: null,
        confidence: provider.confidence,
        feedback: provider.feedback,
        extractedAnswer: provider.extractedAnswer ?? null,
        rubricBreakdown: [],
        concepts: provider.concepts,
        flags: provider.flags,
        reviewRequired: true,
        engine: route.engine,
        deterministicStatus: null,
        scoringError,
        specializedEvidence: null,
      };
    }
  });

  const complete = reconciled.every(question => question.suggestedMarks != null);
  const suggestedMarks = complete
    ? reconciled.reduce((sum, question) => sum + (question.suggestedMarks ?? 0), 0)
    : null;
  const questionConfidence = reconciled.reduce((sum, question) => sum + question.confidence, 0) / Math.max(1, reconciled.length);

  return {
    questions: reconciled,
    suggestedMarks,
    confidence: Math.min(result.confidence, questionConfidence),
    unresolvedDeterministicCount: reconciled.filter(question => question.scoringError).length,
  };
}
