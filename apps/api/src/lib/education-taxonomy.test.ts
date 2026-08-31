import assert from "node:assert/strict";
import test from "node:test";
import { academicClassLevels, courseTaxonomyError, slugifyCourseTitle } from "./education-taxonomy.js";

const academic = { categoryType: "ACADEMIC", academicBoard: "CBSE", classLevel: "CLASS_6" } as const;
test("academic taxonomy supports Play through Class 10 without stream", () => {
  for (const classLevel of academicClassLevels.filter(value => !["CLASS_11", "CLASS_12"].includes(value))) assert.equal(courseTaxonomyError({ ...academic, classLevel }), null);
  assert.match(courseTaxonomyError({ ...academic, academicStream: "SCIENCE" }) ?? "", /only to Classes 11 and 12/);
});
test("senior science combinations and preparation are validated", () => {
  assert.equal(courseTaxonomyError({ ...academic, classLevel: "CLASS_11", academicStream: "SCIENCE", scienceCombination: "PCM", academicPreparation: "ACADEMIC_ONLY" }), null);
  assert.equal(courseTaxonomyError({ ...academic, classLevel: "CLASS_11", academicStream: "SCIENCE", scienceCombination: "PCB", academicPreparation: "ACADEMIC_NEET" }), null);
  assert.equal(courseTaxonomyError({ ...academic, classLevel: "CLASS_12", academicStream: "SCIENCE", scienceCombination: "PCM", academicPreparation: "ACADEMIC_JEE" }), null);
  assert.equal(courseTaxonomyError({ ...academic, classLevel: "CLASS_12", academicStream: "SCIENCE", scienceCombination: "PCB", academicPreparation: "ACADEMIC_NEET" }), null);
  assert.equal(courseTaxonomyError({ ...academic, classLevel: "CLASS_11", academicStream: "COMMERCE" }), null);
  assert.equal(courseTaxonomyError({ ...academic, classLevel: "CLASS_12", academicStream: "HUMANITIES" }), null);
  assert.match(courseTaxonomyError({ ...academic, classLevel: "CLASS_11", academicStream: "COMMERCE", scienceCombination: "PCB" }) ?? "", /only to the Science stream/);
  assert.match(courseTaxonomyError({ ...academic, classLevel: "CLASS_12", academicStream: "SCIENCE", scienceCombination: "PCB", academicPreparation: "ACADEMIC_JEE" }) ?? "", /requires PCM or PCMB/);
});
test("competitive and skill categories reject school-only fields", () => {
  assert.equal(courseTaxonomyError({ categoryType: "COMPETITIVE", competitiveExamId: "exam" }), null);
  assert.equal(courseTaxonomyError({ categoryType: "SKILL_BASED", skillCategoryId: "skill" }), null);
  assert.match(courseTaxonomyError({ categoryType: "COMPETITIVE", competitiveExamId: "exam", classLevel: "CLASS_12" }) ?? "", /cannot use school/);
  assert.match(courseTaxonomyError({ categoryType: "SKILL_BASED", skillCategoryId: "skill", academicBoard: "CBSE" }) ?? "", /cannot use school/);
});
test("course slug is generated deterministically", () => assert.equal(slugifyCourseTitle(" Class 12 Science PCM "), "class-12-science-pcm"));
