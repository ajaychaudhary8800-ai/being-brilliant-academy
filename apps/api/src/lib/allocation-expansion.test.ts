import assert from "node:assert/strict";
import test from "node:test";
import { expandAllocationSelections } from "./allocation-expansion.js";

test("allocation expansion never creates cross-course subject combinations", () => {
  assert.deepEqual(expandAllocationSelections([
    { courseId: "class-11", batchIds: ["11-a", "11-b"], subjectIds: ["physics", "mathematics"] },
    { courseId: "class-12", batchIds: ["12-a"], subjectIds: ["physics"] },
  ]), [
    { courseId: "class-11", batchId: "11-a", subjectId: "physics" },
    { courseId: "class-11", batchId: "11-a", subjectId: "mathematics" },
    { courseId: "class-11", batchId: "11-b", subjectId: "physics" },
    { courseId: "class-11", batchId: "11-b", subjectId: "mathematics" },
    { courseId: "class-12", batchId: "12-a", subjectId: "physics" },
  ]);
});
