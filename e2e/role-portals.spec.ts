import { expect, test } from "@playwright/test";
import { assertSafeTarget, expectHealthyPage, login } from "./support/environment";

test.beforeAll(({ baseURL }) => assertSafeTarget(baseURL ?? "http://127.0.0.1:3000"));

test("@smoke teacher workspace and protected assessment flow load", async ({ page }) => {
  await login(page, "teacher");
  await expectHealthyPage(page, /teacher/i);
  await page.goto("/teacher/homeworks");
  await expectHealthyPage(page, /homework/i);
  await page.goto("/teacher/examinations");
  await expectHealthyPage(page, /question papers|answer sheets/i);
  await expect(page).toHaveURL(/\/teacher\/examinations/);
});

test("@smoke student portal exposes assigned academic work", async ({ page }) => {
  await login(page, "student");
  await expectHealthyPage(page, /student/i);
  await expect(page.getByText(/homework/i).first()).toBeVisible();
});

test("@smoke parent portal exposes linked student progress", async ({ page }) => {
  await login(page, "parent");
  await expectHealthyPage(page, /linked students/i);
  await expect(page.getByText(/homework results/i).first()).toBeVisible();
});

test("@smoke employee portal loads", async ({ page }) => {
  await login(page, "employee");
  await expectHealthyPage(page, /employee/i);
});

test("teacher cannot open the admin assessment workspace", async ({ page }) => {
  await login(page, "teacher");
  await page.goto("/admin/examination-submissions");
  await expect(page).not.toHaveURL(/\/admin\/examination-submissions$/);
});
