import { expect, test } from "@playwright/test";

const legalRoutes = [
  ["/privacy", /Privacy Notice/i],
  ["/terms", /Being Brilliant SaaS Master Agreement/i],
  ["/acceptable-use", /Acceptable Use Policy/i],
] as const;

test("@legal-publication staging public legal pages render on desktop and mobile", async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);

    for (const [route, heading] of legalRoutes) {
      const response = await page.goto(route, { waitUntil: "networkidle" });
      expect(response?.status(), `${route} should return 200 at ${viewport.width}px`).toBe(200);
      await expect(page.getByText(heading).first()).toBeVisible();
      await expect(page.locator("body")).not.toContainText("[[DATE]]");
    }

    await page.goto("/", { waitUntil: "networkidle" });
    const footer = page.locator("footer");
    await expect(footer.getByRole("link", { name: "Privacy", exact: true })).toBeVisible();
    await expect(footer.getByRole("link", { name: "Terms", exact: true })).toBeVisible();
    await expect(footer.getByRole("link", { name: "Acceptable Use", exact: true })).toBeVisible();

    await expect(page.getByRole("link", { name: "Privacy Notice", exact: true })).toBeVisible();
  }

  await page.goto("/privacy", { waitUntil: "networkidle" });
  await expect(page.locator("body")).toContainText("2026-10-06");
});
