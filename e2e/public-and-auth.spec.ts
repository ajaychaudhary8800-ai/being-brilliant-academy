import { expect, test } from "@playwright/test";
import { account, assertSafeTarget, login } from "./support/environment";

test.beforeAll(({ baseURL }) => assertSafeTarget(baseURL ?? "http://127.0.0.1:3000"));

test("@smoke portal selector and all login pages render", async ({ page }) => {
  await page.goto("/login");
  for (const name of ["Student Portal", "Parent Portal", "Teacher Portal", "Employee Portal", "Admin Portal"]) {
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }
  for (const portal of ["admin", "teacher", "student", "parent", "employee"]) {
    await page.goto(`/login/${portal}`);
    await expect(page.getByLabel("School workspace")).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
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
