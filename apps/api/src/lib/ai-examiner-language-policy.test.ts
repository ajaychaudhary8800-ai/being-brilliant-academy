import assert from "node:assert/strict";
import test from "node:test";
import { aiExaminerRubricQuestionInputSchema } from "./ai-examiner-question-config.js";

test("multilingual rubric defaults to English-only evidence-preserving content grading", () => {
  const parsed = aiExaminerRubricQuestionInputSchema.parse({
    key: "Q1",
    maxMarks: 5,
    criteria: "Explain the concept accurately.",
    questionType: "LONG_ANSWER",
  });
  assert.deepEqual(parsed.languagePolicy.acceptedLanguages, ["English"]);
  assert.equal(parsed.languagePolicy.allowCodeSwitching, false);
  assert.equal(parsed.languagePolicy.allowTransliteration, false);
  assert.equal(parsed.languagePolicy.evaluateLanguageMechanics, false);
  assert.equal(parsed.languagePolicy.requireOriginalLanguageEvidence, true);
});

test("rubric can explicitly permit bilingual code-switching and transliteration", () => {
  const parsed = aiExaminerRubricQuestionInputSchema.parse({
    key: "Q2",
    maxMarks: 5,
    criteria: "Explain the concept accurately.",
    questionType: "LANGUAGE",
    languagePolicy: {
      acceptedLanguages: ["English", "Hindi"],
      allowCodeSwitching: true,
      allowTransliteration: true,
      evaluateLanguageMechanics: true,
      requireOriginalLanguageEvidence: true,
    },
  });
  assert.deepEqual(parsed.languagePolicy.acceptedLanguages, ["English", "Hindi"]);
  assert.equal(parsed.languagePolicy.allowCodeSwitching, true);
  assert.equal(parsed.languagePolicy.allowTransliteration, true);
  assert.equal(parsed.languagePolicy.evaluateLanguageMechanics, true);
});

test("duplicate academic languages are rejected case-insensitively", () => {
  const parsed = aiExaminerRubricQuestionInputSchema.safeParse({
    key: "Q3",
    maxMarks: 5,
    criteria: "Explain the concept.",
    questionType: "LONG_ANSWER",
    languagePolicy: {
      acceptedLanguages: ["English", "english"],
    },
  });
  assert.equal(parsed.success, false);
});

test("provider contract preserves original-language evidence and does not silently grade mechanics", async () => {
  const source = await import("node:fs/promises").then(fs =>
    fs.readFile(new URL("./ai-examiner-engine.ts", import.meta.url), "utf8")
  );
  assert.match(source, /Respect each question's languagePolicy/);
  assert.match(source, /do not deduct marks for grammar, spelling, script choice, accent, or language mechanics/);
  assert.match(source, /preserve the student's original-language wording/);
  assert.match(source, /Do not substitute a translation as quoted evidence/);
});
