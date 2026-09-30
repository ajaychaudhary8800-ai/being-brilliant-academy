export type LearningItemAnalysisResponse = {
  questionId: string;
  answer: unknown;
  isCorrect: boolean | null;
  awardedMarks: number | null;
  timeSpentSeconds: number;
};

export type LearningItemAnalysisAttempt = {
  studentId: string;
  totalScore: number;
  responses: LearningItemAnalysisResponse[];
};

export type LearningItemDefinition = {
  questionId: string;
  maxMarks: number;
  correctAnswer?: unknown;
};

export type LearningItemMetric = {
  questionId: string;
  attempts: number;
  answered: number;
  correct: number;
  facility: number | null;
  difficulty: number | null;
  nonResponseRate: number | null;
  meanAwardedMarks: number | null;
  meanScoreRatio: number | null;
  discrimination: number | null;
  meanTimeSeconds: number | null;
  distractors: Array<{ answer: string; count: number; rate: number }>;
  flags: string[];
};

export type LearningTestPsychometrics = {
  attemptCount: number;
  questionCount: number;
  reliabilityAlpha: number | null;
  items: LearningItemMetric[];
  caveats: string[];
};

function round(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function variance(values: number[]) {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
}

function answerLabel(value: unknown) {
  if (value === null || value === undefined) return "(unanswered)";
  if (typeof value === "string") return value.trim() || "(blank)";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "(unserializable)";
  }
}

export function calculateLearningTestPsychometrics(input: {
  items: LearningItemDefinition[];
  attempts: LearningItemAnalysisAttempt[];
}): LearningTestPsychometrics {
  const items = [...input.items];
  const attempts = [...input.attempts];
  const responseMaps = new Map(attempts.map(attempt => [
    attempt.studentId,
    new Map(attempt.responses.map(response => [response.questionId, response])),
  ]));

  const ranked = [...attempts].sort((a, b) => b.totalScore - a.totalScore || a.studentId.localeCompare(b.studentId));
  const bandSize = ranked.length >= 4 ? Math.max(1, Math.floor(ranked.length * 0.27)) : 0;
  const upper = new Set(ranked.slice(0, bandSize).map(row => row.studentId));
  const lower = new Set(ranked.slice(Math.max(0, ranked.length - bandSize)).map(row => row.studentId));

  const metrics = items.map(item => {
    const responses = attempts.map(attempt => ({
      studentId: attempt.studentId,
      response: responseMaps.get(attempt.studentId)?.get(item.questionId) ?? null,
    }));
    const answered = responses.filter(row => row.response?.answer !== null && row.response?.answer !== undefined);
    const correct = responses.filter(row => row.response?.isCorrect === true);
    const awarded = responses.map(row => row.response?.awardedMarks).filter((value): value is number => value !== null && value !== undefined);
    const times = responses.map(row => row.response?.timeSpentSeconds).filter((value): value is number => value !== null && value !== undefined);

    let discrimination: number | null = null;
    if (bandSize > 0) {
      const upperCorrect = responses.filter(row => upper.has(row.studentId) && row.response?.isCorrect === true).length / bandSize;
      const lowerCorrect = responses.filter(row => lower.has(row.studentId) && row.response?.isCorrect === true).length / bandSize;
      discrimination = round(upperCorrect - lowerCorrect);
    }

    const distractorCounts = new Map<string, number>();
    for (const row of answered) {
      const label = answerLabel(row.response?.answer);
      distractorCounts.set(label, (distractorCounts.get(label) ?? 0) + 1);
    }
    const distractors = [...distractorCounts.entries()]
      .map(([answer, count]) => ({ answer, count, rate: answered.length ? round(count / answered.length) : 0 }))
      .sort((a, b) => b.count - a.count || a.answer.localeCompare(b.answer));

    const facility = attempts.length ? correct.length / attempts.length : null;
    const nonResponseRate = attempts.length ? (attempts.length - answered.length) / attempts.length : null;
    const meanAwardedMarks = awarded.length ? awarded.reduce((sum, value) => sum + value, 0) / awarded.length : null;
    const meanScoreRatio = meanAwardedMarks !== null && item.maxMarks > 0 ? meanAwardedMarks / item.maxMarks : null;
    const flags: string[] = [];
    if (attempts.length < 20) flags.push("SMALL_SAMPLE");
    if (facility !== null && facility > 0.95) flags.push("VERY_EASY");
    if (facility !== null && facility < 0.2) flags.push("VERY_DIFFICULT");
    if (discrimination !== null && discrimination < 0) flags.push("NEGATIVE_DISCRIMINATION");
    if (discrimination !== null && discrimination >= 0 && discrimination < 0.2) flags.push("LOW_DISCRIMINATION");
    if (nonResponseRate !== null && nonResponseRate > 0.25) flags.push("HIGH_NON_RESPONSE");

    return {
      questionId: item.questionId,
      attempts: attempts.length,
      answered: answered.length,
      correct: correct.length,
      facility: facility === null ? null : round(facility),
      difficulty: facility === null ? null : round(1 - facility),
      nonResponseRate: nonResponseRate === null ? null : round(nonResponseRate),
      meanAwardedMarks: meanAwardedMarks === null ? null : round(meanAwardedMarks),
      meanScoreRatio: meanScoreRatio === null ? null : round(meanScoreRatio),
      discrimination,
      meanTimeSeconds: times.length ? round(times.reduce((sum, value) => sum + value, 0) / times.length) : null,
      distractors,
      flags,
    };
  });

  let reliabilityAlpha: number | null = null;
  if (items.length >= 2 && attempts.length >= 2) {
    const itemScores = items.map(item => attempts.map(attempt => {
      const response = responseMaps.get(attempt.studentId)?.get(item.questionId);
      return response?.awardedMarks ?? 0;
    }));
    const totalScores = attempts.map((attempt, attemptIndex) =>
      itemScores.reduce((sum, scores) => sum + (scores[attemptIndex] ?? 0), 0)
    );
    const totalVariance = variance(totalScores);
    if (totalVariance > 0) {
      const sumItemVariance = itemScores.reduce((sum, scores) => sum + variance(scores), 0);
      reliabilityAlpha = round(items.length / (items.length - 1) * (1 - sumItemVariance / totalVariance));
    }
  }

  const caveats = [
    "Item statistics describe this observed cohort and administration; they are not universal properties of a question.",
    "Small samples, teaching differences, accommodations, guessing and test conditions can materially affect these metrics.",
    "Negative or low discrimination is a review signal for the item and administration, not proof that the item is invalid.",
  ];
  return { attemptCount: attempts.length, questionCount: items.length, reliabilityAlpha, items: metrics, caveats };
}
