import assert from "node:assert/strict";
import test from "node:test";
import { buildSubjectMergePlan, describeSubjectDependencies, subjectDependencyLabels, usedSubjectDependencies, type SubjectDependencyCounts } from "./subject-dependencies.js";

const empty = Object.fromEntries(Object.keys(subjectDependencyLabels).map(key => [key, 0])) as SubjectDependencyCounts;

test("subject dependency coverage includes every current subjectId-bearing model", () => {
  assert.deepEqual(Object.keys(subjectDependencyLabels).sort(), [
    "courses", "doubtThreads", "examinations", "homeworks", "learningTests", "lessons", "liveClasses",
    "questionBankItems", "studyMaterials", "substitutions", "teacherAllocations", "teachers", "tests", "timetables",
  ]);
});

test("dependency descriptions report only records that block deletion", () => {
  const counts = { ...empty, courses: 1, questionBankItems: 2, liveClasses: 3 };
  assert.deepEqual(usedSubjectDependencies(counts).map(([key]) => key), ["courses", "questionBankItems", "liveClasses"]);
  assert.equal(describeSubjectDependencies(counts), "1 course mappings, 2 question-bank items, 3 live classes");
});

test("merge planning only accepts an active replacement course mapping", async () => {
  let replacementFilter: Record<string, unknown> | undefined;
  const client = {
    courseSubject: {
      count: async () => 0,
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        if (where.subjectId === "source") return [{ courseId: "course-1" }];
        replacementFilter = where;
        return [{ courseId: "course-1" }];
      },
    },
    teacherSubject: { count: async () => 0, findMany: async () => [] },
    teacherAllocation: { count: async () => 0 }, timetable: { count: async () => 0 }, homework: { count: async () => 0 },
    examination: { count: async () => 0 }, teacherSubstitution: { count: async () => 0 }, test: { count: async () => 0 },
    lesson: { count: async () => 0 }, doubtThread: { count: async () => 0 }, questionBankItem: { count: async () => 0 },
    learningTest: { count: async () => 0 }, studyMaterial: { count: async () => 0 }, liveClass: { count: async () => 0 },
  };
  const plan = await buildSubjectMergePlan(client as never, "organization-1", "source", "replacement");
  assert.equal(replacementFilter?.isActive, true);
  assert.deepEqual(plan.duplicateCourseIds, ["course-1"]);
  assert.equal(plan.canMerge, true);
});
