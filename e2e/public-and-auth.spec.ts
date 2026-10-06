import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { account, assertSafeTarget, login } from "./support/environment";

test.beforeAll(({ baseURL }) => assertSafeTarget(baseURL ?? "http://127.0.0.1:3000"));

test("@smoke portal selector and all login pages render", async ({ page }) => {
  await page.goto("/login");
  for (const name of ["Student Portal", "Parent Portal", "Teacher Portal", "Employee Portal", "Admin Portal"]) {
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }
  for (const portal of ["admin", "teacher", "student", "parent", "employee"]) {
    await page.goto(`/login/${portal}`);
    await expect(page.getByLabel("Workspace", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  }
});

for (const role of ["superAdmin", "branchAdmin", "accountant", "teacher", "student", "parent", "employee"] as const) {
  test(`@smoke ${role} can sign in to the correct portal`, async ({ page }) => {
    account(role);
    await login(page, role);
  });
}

test("@smoke @mobile portal selector works on mobile", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByText("Choose your portal")).toBeVisible();
  await expect(page.getByText("Student Portal", { exact: true })).toBeVisible();
});

test("@smoke public legal publication matches the controlled launch gate", async ({ page }) => {
  const manifest = JSON.parse(
    readFileSync("config/launch-readiness.json", "utf8"),
  ) as { gates: Array<{ id: string; status: string }> };
  const legalGate = manifest.gates.find(gate => gate.id === "public-legal-pages");
  expect(legalGate).toBeTruthy();
  const published = legalGate?.status === "READY";

  for (const route of ["/privacy", "/terms", "/acceptable-use"]) {
    const response = await page.goto(route);
    expect(response).not.toBeNull();
    if (published) {
      expect(response?.status()).toBe(200);
      await expect(page.getByText("Legal", { exact: true })).toBeVisible();
    } else {
      expect(response?.status()).toBe(404);
    }
  }

  await page.goto("/");
  const footer = page.locator("footer");
  if (published) {
    await expect(footer.getByRole("link", { name: "Privacy", exact: true })).toBeVisible();
    await expect(footer.getByRole("link", { name: "Terms", exact: true })).toBeVisible();
    await expect(footer.getByRole("link", { name: "Acceptable Use", exact: true })).toBeVisible();
  } else {
    await expect(footer.getByRole("link", { name: "Privacy", exact: true })).toHaveCount(0);
    await expect(footer.getByRole("link", { name: "Terms", exact: true })).toHaveCount(0);
    await expect(footer.getByRole("link", { name: "Acceptable Use", exact: true })).toHaveCount(0);
  }
});

