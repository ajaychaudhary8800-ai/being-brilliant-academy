import { test } from "@playwright/test";
import { assertSafeTarget } from "./support/environment";

test("staging mutation suite is explicitly guarded", async ({ baseURL }) => {
  test.skip(process.env.QA_RUN_MUTATION_TESTS !== "true", "Mutation suite is disabled");
  assertSafeTarget(baseURL ?? "http://127.0.0.1:3000", true);
});
