import { test } from "@playwright/test";
import { configuredQaRoles, loginFresh } from "./support/environment";
import { savePageAuthState } from "./support/auth-state";

test.describe.configure({ mode: "serial" });

for (const role of configuredQaRoles()) {
  test(`@auth ${role} authenticates through the assigned portal`, async ({ page }) => {
    await loginFresh(page, role);
    await savePageAuthState(page, role);
  });
}
