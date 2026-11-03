import { expect, test, type Page } from "@playwright/test";

/**
 * Same public portal-selector and login-form contract as remote read-only QA,
 * but on a disposable local Next.js production preview only.
 * No real credentials, customer, API mutations, merchant or staging traffic.
 */
test.beforeAll(({ baseURL }) => {
  if (baseURL !== "http://127.0.0.1:3000") {
    throw new Error("V5 local portal QA refuses non-local preview target");
  }
});

async function preventBackendContact(page: Page) {
  await page.route("**/api/v1/**", async route => {
    // Browser never reaches remote API or submits a login from this suite.
    await route.fulfill({ status: 503, contentType: "application/json",
      body: '{"error":"SYNTHETIC_OFFLINE_BACKEND"}' });
  });
}

test("V5 local public portal selector renders all five roles offline", async ({ page }) => {
  await preventBackendContact(page);
  const response = await page.goto("/login", {
    waitUntil: "domcontentloaded", timeout: 20_000,
  });
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Choose your portal" })).toBeVisible();
  for (const title of [
    "Student Portal", "Parent Portal", "Teacher Portal",
    "Employee Portal", "Admin Portal",
  ]) {
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  }
  console.log("V5_LOCAL_LOGIN_SELECTOR=PASS_DISPOSABLE_PREVIEW");
});

test("V5 local all role-login forms are rendered without API or credentials", async ({ page }) => {
  await preventBackendContact(page);
  for (const portal of ["admin", "teacher", "student", "parent", "employee"]) {
    const response = await page.goto("/login/" + portal, {
      waitUntil: "domcontentloaded", timeout: 20_000,
    });
    expect(response?.status()).toBe(200);
    await expect(page.getByLabel("Workspace", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in to/i })).toBeVisible();
  }
  console.log("V5_LOCAL_LOGIN_FIVE_FORMS=PASS_DISPOSABLE_PREVIEW");
});

test("@mobile V5 mobile portal selector opens local admin login without credentials", async ({ page }) => {
  await preventBackendContact(page);
  const response = await page.goto("/login", {
    waitUntil: "domcontentloaded", timeout: 20_000,
  });
  expect(response?.status()).toBe(200);
  await page.getByRole("link", { name: /Admin Portal/ }).click();
  await expect(page).toHaveURL(/\/login\/admin$/);
  await expect(page.getByLabel("Workspace", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
  console.log("V5_LOCAL_LOGIN_MOBILE=PASS_DISPOSABLE_PREVIEW");
});
