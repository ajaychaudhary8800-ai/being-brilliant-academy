import assert from "node:assert/strict";
import test from "node:test";
import {
  parseAIExaminerExamProfile,
  resolveAIExaminerMarkingRule,
} from "./ai-examiner-exam-profile.js";

const profile = parseAIExaminerExamProfile({
  code: "JEE_MAIN_2027_LOCAL",
  name: "JEE Main 2027 local profile",
  kind: "JEE_MAIN",
  version: "2027.1",
  questionRules: [
    {
      questionType: "MCQ",
      scoring: {
        correctMarks: 4,
        incorrectMarks: -1,
        unansweredMarks: 0,
        partialMode: "NONE",
        caseSensitive: false,
        trimWhitespace: true,
        numericalTolerance: { absolute: 0, relative: 0 },
      },
    },
    {
      questionType: "NUMERICAL",
      scoring: {
        correctMarks: 4,
        incorrectMarks: 0,
        unansweredMarks: 0,
        partialMode: "NONE",
        caseSensitive: false,
        trimWhitespace: true,
        numericalTolerance: { absolute: 0.001, relative: 0 },
      },
    },
  ],
  sections: [
    {
      key: "physics-a",
      title: "Physics Section A",
      questionTypes: ["MCQ"],
      scoring: {
        correctMarks: 4,
        incorrectMarks: -2,
        unansweredMarks: 0,
        partialMode: "NONE",
        caseSensitive: false,
        trimWhitespace: true,
        numericalTolerance: { absolute: 0, relative: 0 },
      },
    },
  ],
});

test("exam profile resolves marking rules from most specific to least specific", () => {
  const question = resolveAIExaminerMarkingRule({
    profile,
    questionType: "MCQ",
    sectionKey: "physics-a",
    questionScoring: { correctMarks: 5, incorrectMarks: -1 },
  });
  assert.equal(question.source, "QUESTION");
  assert.equal(question.scoring.correctMarks, 5);

  const section = resolveAIExaminerMarkingRule({
    profile,
    questionType: "MCQ",
    sectionKey: "physics-a",
  });
  assert.equal(section.source, "SECTION");
  assert.equal(section.scoring.incorrectMarks, -2);

  const profileLevel = resolveAIExaminerMarkingRule({
    profile,
    questionType: "NUMERICAL",
  });
  assert.equal(profileLevel.source, "PROFILE");
  assert.equal(profileLevel.scoring.numericalTolerance?.absolute, 0.001);

  const fallback = resolveAIExaminerMarkingRule({
    profile,
    questionType: "LONG_ANSWER",
  });
  assert.equal(fallback.source, "DEFAULT");
  assert.equal(fallback.scoring.partialMode, "NONE");
});

test("exam profile validation prevents ambiguous or invalid configuration", () => {
  assert.throws(() => parseAIExaminerExamProfile({
    code: "CUSTOM",
    name: "Custom school profile",
    kind: "INSTITUTION_DEFINED",
    version: "1",
    institutionDefined: false,
  }));

  assert.throws(() => parseAIExaminerExamProfile({
    code: "CBSE_2027",
    name: "CBSE profile",
    kind: "CBSE",
    version: "1",
    institutionDefined: false,
    questionRules: [
      { questionType: "MCQ", scoring: { correctMarks: 1 } },
      { questionType: "MCQ", scoring: { correctMarks: 2 } },
    ],
  }));

  assert.throws(() => parseAIExaminerExamProfile({
    code: "SCHOOL_2027",
    name: "School profile",
    kind: "SCHOOL",
    version: "1",
    effectiveFrom: "2027-04-01",
    effectiveTo: "2027-03-31",
  }));
});

test("profile names do not imply fixed official marking rules", () => {
  const neet = parseAIExaminerExamProfile({
    code: "NEET_CONFIGURED",
    name: "NEET configured profile",
    kind: "NEET",
    version: "institution-approved",
  });
  const rule = resolveAIExaminerMarkingRule({ profile: neet, questionType: "MCQ" });
  assert.equal(rule.source, "DEFAULT");
  assert.equal(rule.scoring.correctMarks, undefined);
  assert.equal(rule.scoring.incorrectMarks, undefined);
});
