import { test } from "@playwright/test";
import { configuredQaRoles } from "./support/environment";
import { loginApi } from "./support/api";
import { writeStoredAuthTokens } from "./support/auth-state";

for (const role of configuredQaRoles()) {
  test(`@auth ${role} authenticates through the assigned portal`, async ({ request, baseURL }) => {
    const session = await loginApi(request, role);
    const origin = new URL(baseURL ?? "http://127.0.0.1:3000").origin;
    writeStoredAuthTokens(role, session.accessToken, session.refreshToken, origin);
  });
}
