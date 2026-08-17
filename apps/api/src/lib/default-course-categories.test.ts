import assert from "node:assert/strict";
import test from "node:test";
import { defaultCourseCategories, ensureDefaultCourseCategories } from "./default-course-categories.js";

test("default course categories are unique and complete", () => {
  assert.deepEqual(defaultCourseCategories.map(({ name }) => name), [
    "SCHOOL", "JEE", "NEET", "CUET", "NDA", "FOUNDATION", "COMMERCE", "SKILL COURSE", "OTHER",
  ]);
  assert.equal(new Set(defaultCourseCategories.map(({ slug }) => slug)).size, defaultCourseCategories.length);
});

test("course category provisioning is tenant-scoped and idempotent", async () => {
  let received: unknown;
  const db = { category: { createMany: async (args: unknown) => { received = args; } } };
  await ensureDefaultCourseCategories(db, "org_test");
  assert.deepEqual(received, {
    data: defaultCourseCategories.map((category) => ({ organizationId: "org_test", ...category })),
    skipDuplicates: true,
  });
});
