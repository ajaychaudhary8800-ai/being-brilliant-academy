import assert from "node:assert/strict";
import test from "node:test";
import { planTeacherSubjectSync } from "./teacher-subject-sync.js";

test("confirmed selection removes a hidden review-required mapping when unused", () => {
  const plan = planTeacherSubjectSync(["physics", "legacy-mathematics-physics"], ["physics"]);
  assert.deepEqual(plan.keepSubjectIds, ["physics"]);
  assert.deepEqual(plan.removeSubjectIds, ["legacy-mathematics-physics"]);
  assert.deepEqual(plan.blockedSubjectIds, []);
});

test("hidden mapping removal is blocked when an active allocation uses it", () => {
  const plan = planTeacherSubjectSync(
    ["physics", "legacy-mathematics-physics"],
    ["physics"],
    ["legacy-mathematics-physics"],
  );
  assert.deepEqual(plan.removeSubjectIds, ["legacy-mathematics-physics"]);
  assert.deepEqual(plan.blockedSubjectIds, ["legacy-mathematics-physics"]);
});

test("empty selection intentionally removes every unused mapping", () => {
  const plan = planTeacherSubjectSync(["physics", "chemistry"], []);
  assert.deepEqual(plan.keepSubjectIds, []);
  assert.deepEqual(plan.removeSubjectIds, ["physics", "chemistry"]);
  assert.deepEqual(plan.blockedSubjectIds, []);
});

test("empty selection remains blocked for subjects used by active allocations", () => {
  const plan = planTeacherSubjectSync(["physics", "chemistry"], [], ["chemistry"]);
  assert.deepEqual(plan.blockedSubjectIds, ["chemistry"]);
});
