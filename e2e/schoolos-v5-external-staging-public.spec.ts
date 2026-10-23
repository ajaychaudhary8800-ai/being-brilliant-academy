import { expect, test, type Page } from "@playwright/test";

/**
 * Safe, unauthenticated UI checks against ONLY the isolated V5 staging host.
 * Must not log in, submit forms, or create/modify institution data.
 */
const approvedBase = "https://v5-staging.beingbrilliantedu.com";

/**
 * Use DOM ready rather than the browser's full load event: a slow external
 * resource must not hide already rendered, functional login UI. Role-specific
 * element assertions below still fail if the app/SSR/hydration is broken.
 * No retries here: Playwright's own bounded CI retry preserves incident evidence.
 */
async function openPublicLogin(page: Page, pathname: string) {
  const started = Date.now();
  try {
    const response = await page.goto(pathname, { waitUntil: "domcontentloaded", timeout: 20_000 });
    console.log(`V5_PUBLIC_BROWSER_NAVIGATION route=${pathname} http=${response?.status() ?? "NULL"} dom_ready_ms=${Date.now()-started}`);
    return response;
  } catch (error) {
    console.error(`V5_PUBLIC_BROWSER_NAVIGATION_FAILED route=${pathname} elapsed_ms=${Date.now()-started}`);
    throw error; // Fail closed. No silent retry/suppression of DNS/TLS/TCP failures.
  }
}


test.beforeAll(({ baseURL }) => {
  if (baseURL !== approvedBase) {
    throw new Error("V5 staging UI QA refuses any non-approved baseURL");
  }
});

test("V5 staging portal selector renders five role-specific login options", async ({ page }) => {
  const response = await openPublicLogin(page, "/login");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Choose your portal" })).toBeVisible();
  for (const title of ["Student Portal", "Parent Portal", "Teacher Portal", "Employee Portal", "Admin Portal"]) {
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  }
});

test("V5 staging role login forms render without credentials or mutations", async ({ page }) => {
  for (const portal of ["admin", "teacher", "student", "parent", "employee"]) {
    const response = await openPublicLogin(page, "/login/" + portal);
    expect(response?.status()).toBe(200);
    await expect(page.getByLabel("Workspace", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in to/i })).toBeVisible();
  }
});

test("@mobile V5 staging mobile portal selector and admin login remain usable", async ({ page }) => {
  const response = await openPublicLogin(page, "/login");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Choose your portal" })).toBeVisible();
  await page.getByRole("link", { name: /Admin Portal/ }).click();
  await expect(page).toHaveURL(/\/login\/admin$/);
  await expect(page.getByLabel("Workspace", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
});
