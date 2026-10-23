import { expect, test } from "@playwright/test";

/**
 * Runs ONLY against the locally built V5 preview on GitHub's disposable runner.
 * All API leads are intercepted at the browser boundary: no real school,
 * customer, subscription or payment record is created.
 */
test.beforeAll(({ baseURL }) => {
  if (baseURL !== "http://127.0.0.1:3000") {
    throw new Error("SchoolOS private demo browser QA refuses a remote environment");
  }
});

test("V5 SchoolOS private-demo landing is responsive, noindex and transparent about paid availability", async ({ page }) => {
  const response = await page.goto("/schoolos", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.getByRole("heading", { name: /one connected operating system/i })).toBeVisible();
  await expect(page.getByText("Commercial preview only.", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Request a SchoolOS demo" })).toBeVisible();
  await expect(page.getByRole("button", { name: /request private demo/i })).toBeVisible();
  await expect(page.getByText("No card details or payment are requested.", { exact: false })).toBeVisible();
});

test("Browser submits one consent-based institutional lead into intercepted CRM (no network write)", async ({ page }) => {
  let seen = 0;
  let body: any;
  await page.route("**/api/v1/public/saas-sales/leads", async route => {
    seen++;
    body = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ data: { id: "synthetic-browser-lead-only", status: "NEW" } }),
    });
  });
  const response = await page.goto("/schoolos", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await page.locator('input[name="contactName"]').fill("Synthetic School Owner");
  await page.locator('input[name="organizationName"]').fill("Synthetic SchoolOS Academy");
  await page.locator('input[name="mobile"]').fill("9876543210");
  await page.locator('input[name="email"]').fill("synthetic@example.test");
  await page.locator('select[name="institutionType"]').selectOption("Coaching Institute");
  await page.locator('select[name="studentCountBand"]').selectOption("500–2,000");
  await page.locator('input[name="requirements"][value="lms"]').check();
  await page.locator('input[name="requirements"][value="crm"]').check();
  await page.locator('input[name="contactConsent"]').check();
  await page.getByRole("button", { name: /request private demo/i }).click();
  await expect(page.getByRole("status")).toContainText("Demo enquiry received.");
  expect(seen).toBe(1);
  expect(body).toMatchObject({
    organizationName: "Synthetic SchoolOS Academy",
    contactName: "Synthetic School Owner",
    mobile: "9876543210",
    source: "WEBSITE",
    campaign: "SCHOOLOS_V5_PRIVATE_DEMO",
    utm: { intent: "B2B_PRODUCT_DEMO", product: "ADHYAY_SCHOOLOS",
      stage: "PRIVATE_DEMO_ONLY", contactConsent: "yes" },
  });
  expect(body.requirements).toEqual(["lms", "crm"]);
  expect(JSON.stringify(body)).not.toMatch(/(?:cardNumber|cvv|password|paymentMethod|studentName)/i);
  console.log("SCHOOLOS_LOCAL_BROWSER_CONSENTED_CRM_PAYLOAD=PASS");
  console.log("REAL_CUSTOMER_LEADS_CREATED=0");
});

test("Invalid Indian mobile never generates a CRM API POST", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/v1/public/saas-sales/leads", async route => {
    attempts++;
    await route.abort();
  });
  await page.goto("/schoolos");
  await page.locator('input[name="contactName"]').fill("Synthetic Owner");
  await page.locator('input[name="organizationName"]').fill("Synthetic Institute");
  await page.locator('input[name="mobile"]').fill("1234567890");
  await page.locator('input[name="email"]').fill("synthetic@example.test");
  await page.locator('input[name="contactConsent"]').check();
  await page.getByRole("button", { name: /request private demo/i }).click();
  await expect(page.getByRole("alert")).toContainText("valid 10-digit Indian mobile");
  expect(attempts).toBe(0);
});

test("@mobile Mobile private-demo form is usable and rejected API submissions remain transparent", async ({ page }) => {
  let intercepted = 0;
  await page.route("**/api/v1/public/saas-sales/leads", async route => {
    intercepted++;
    await route.fulfill({ status: 503, contentType: "application/json",
      body: JSON.stringify({ error: { message: "Demo enquiries are temporarily unavailable" } }) });
  });
  await page.goto("/schoolos", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /one connected operating system/i })).toBeVisible();
  await page.locator('input[name="contactName"]').fill("Synthetic Mobile Owner");
  await page.locator('input[name="organizationName"]').fill("Synthetic Mobile Academy");
  await page.locator('input[name="mobile"]').fill("9123456789");
  await page.locator('input[name="email"]').fill("synthetic@example.test");
  await page.locator('input[name="contactConsent"]').check();
  await page.getByRole("button", { name: /request private demo/i }).click();
  await expect(page.getByRole("alert")).toContainText("temporarily unavailable");
  await expect(page.getByRole("status")).toHaveCount(0);
  expect(intercepted).toBe(1);
});
