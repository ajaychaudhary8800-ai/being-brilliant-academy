export type AIExaminerOriginalityAnswer = {
  answerSheetId: string;
  studentId: string;
  questionKey: string;
  text: string | null | undefined;
};

export type AIExaminerOriginalitySignal = {
  questionKey: string;
  answerSheetAId: string;
  studentAId: string;
  answerSheetBId: string;
  studentBId: string;
  similarity: number;
  sharedShingleCount: number;
  shingleCountA: number;
  shingleCountB: number;
  reviewRequired: true;
  interpretation: "TEXT_SIMILARITY_SIGNAL";
};

export type AIExaminerOriginalityReport = {
  comparedAnswers: number;
  comparedPairs: number;
  signals: AIExaminerOriginalitySignal[];
  methodology: {
    shingleSize: number;
    minimumTokens: number;
    signalThreshold: number;
  };
  warning: string;
};

function normalizeText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string) {
  const normalized = normalizeText(value);
  return normalized ? normalized.split(" ") : [];
}

function shingles(words: string[], size: number) {
  const values = new Set<string>();
  if (words.length < size) return values;
  for (let index = 0; index <= words.length - size; index += 1) {
    values.add(words.slice(index, index + size).join(" "));
  }
  return values;
}

function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size && !b.size) return 0;
  let shared = 0;
  for (const value of a) if (b.has(value)) shared += 1;
  const union = a.size + b.size - shared;
  return union ? shared / union : 0;
}

function round(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function analyzeAIExaminerOriginality(
  answers: AIExaminerOriginalityAnswer[],
  options?: {
    shingleSize?: number;
    minimumTokens?: number;
    signalThreshold?: number;
    maximumSignals?: number;
  },
): AIExaminerOriginalityReport {
  const shingleSize = options?.shingleSize ?? 5;
  const minimumTokens = options?.minimumTokens ?? 20;
  const signalThreshold = options?.signalThreshold ?? 0.8;
  const maximumSignals = options?.maximumSignals ?? 500;

  if (!Number.isInteger(shingleSize) || shingleSize < 2 || shingleSize > 12) {
    throw new Error("Originality shingleSize must be an integer between 2 and 12");
  }
  if (!Number.isInteger(minimumTokens) || minimumTokens < shingleSize || minimumTokens > 5000) {
    throw new Error("Originality minimumTokens must be an integer greater than or equal to shingleSize");
  }
  if (!Number.isFinite(signalThreshold) || signalThreshold < 0.5 || signalThreshold > 1) {
    throw new Error("Originality signalThreshold must be between 0.5 and 1");
  }
  if (!Number.isInteger(maximumSignals) || maximumSignals < 1 || maximumSignals > 10000) {
    throw new Error("Originality maximumSignals must be between 1 and 10000");
  }

  const prepared = answers
    .map(answer => {
      const words = tokens(answer.text ?? "");
      return { ...answer, words, shingles: shingles(words, shingleSize) };
    })
    .filter(answer => answer.words.length >= minimumTokens && answer.shingles.size > 0);

  const byQuestion = new Map<string, typeof prepared>();
  for (const answer of prepared) {
    const key = answer.questionKey.trim().toLocaleLowerCase("en");
    const bucket = byQuestion.get(key) ?? [];
    bucket.push(answer);
    byQuestion.set(key, bucket);
  }

  const signals: AIExaminerOriginalitySignal[] = [];
  let comparedPairs = 0;
  for (const group of byQuestion.values()) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const a = group[i]!, b = group[j]!;
        if (a.studentId === b.studentId) continue;
        comparedPairs += 1;
        const similarity = jaccard(a.shingles, b.shingles);
        if (similarity < signalThreshold) continue;
        let shared = 0;
        for (const value of a.shingles) if (b.shingles.has(value)) shared += 1;
        signals.push({
          questionKey: a.questionKey,
          answerSheetAId: a.answerSheetId,
          studentAId: a.studentId,
          answerSheetBId: b.answerSheetId,
          studentBId: b.studentId,
          similarity: round(similarity),
          sharedShingleCount: shared,
          shingleCountA: a.shingles.size,
          shingleCountB: b.shingles.size,
          reviewRequired: true,
          interpretation: "TEXT_SIMILARITY_SIGNAL",
        });
      }
    }
  }

  signals.sort((a, b) => b.similarity - a.similarity || a.questionKey.localeCompare(b.questionKey));
  return {
    comparedAnswers: prepared.length,
    comparedPairs,
    signals: signals.slice(0, maximumSignals),
    methodology: { shingleSize, minimumTokens, signalThreshold },
    warning: "Text similarity is only an originality review signal. It does not establish plagiarism, collusion, authorship, intent, or misconduct and must be reviewed in academic context.",
  };
}
