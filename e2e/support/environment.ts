import { expect, type Page } from "@playwright/test";

export type Portal = "admin" | "teacher" | "student" | "parent" | "employee";
export type QaRole = "superAdmin" | "branchAdmin" | "accountant" | "teacher" | "student" | "parent" | "employee";

export type QaAccount = {
  role: QaRole;
  portal: Portal;
  email: string;
  password: string;
  expectedPath: RegExp;
};

const credentialMap: Record<QaRole, { email: string; password: string; portal: Portal; expectedPath: RegExp }> = {
  superAdmin: { email: "QA_SUPER_ADMIN_EMAIL", password: "QA_SUPER_ADMIN_PASSWORD", portal: "admin", expectedPath: /\/admin(?:\/|$)/ },
  branchAdmin: { email: "QA_BRANCH_ADMIN_EMAIL", password: "QA_BRANCH_ADMIN_PASSWORD", portal: "admin", expectedPath: /\/admin(?:\/|$)/ },
  accountant: { email: "QA_ACCOUNTANT_EMAIL", password: "QA_ACCOUNTANT_PASSWORD", portal: "admin", expectedPath: /\/admin\/finance(?:\/|$)/ },
  teacher: { email: "QA_TEACHER_EMAIL", password: "QA_TEACHER_PASSWORD", portal: "teacher", expectedPath: /\/teacher(?:\/|$)/ },
  student: { email: "QA_STUDENT_EMAIL", password: "QA_STUDENT_PASSWORD", portal: "student", expectedPath: /\/student(?:\/|$)/ },
  parent: { email: "QA_PARENT_EMAIL", password: "QA_PARENT_PASSWORD", portal: "parent", expectedPath: /\/parent(?:\/|$)/ },
  employee: { email: "QA_EMPLOYEE_EMAIL", password: "QA_EMPLOYEE_PASSWORD", portal: "employee", expectedPath: /\/employee(?:\/|$)/ },
};

export const organization = process.env.QA_ORGANIZATION_SLUG ?? "automated-qa-academy";

export function account(role: QaRole): QaAccount {
  const definition = credentialMap[role];
  const email = process.env[definition.email];
  const password = process.env[definition.password];
  if (!email || !password) throw new Error(`Missing ${definition.email} or ${definition.password}`);
  return { role, portal: definition.portal, email, password, expectedPath: definition.expectedPath };
}

export function assertSafeTarget(baseURL: string, mutations = false) {
  const url = new URL(baseURL);
  const productionHosts = new Set(["beingbrilliantedu.com", "www.beingbrilliantedu.com"]);
  if (mutations && productionHosts.has(url.hostname)) {
    throw new Error(`Destructive QA is blocked on production host ${url.hostname}`);
  }
  if (mutations && process.env.QA_ALLOW_MUTATIONS !== "true") {
    throw new Error("Set QA_ALLOW_MUTATIONS=true only for the isolated staging QA organization");
  }
}

export async function login(page: Page, role: QaRole) {
  const qa = account(role);
  await page.goto(`/login/${qa.portal}`);
  await page.getByLabel("Workspace", { exact: true }).fill(organization);
  await page.getByLabel("Email address").fill(qa.email);
  await page.getByLabel("Password").fill(qa.password);
  await page.getByRole("button", { name: new RegExp(`Sign in to`, "i") }).click();
  await expect(page).toHaveURL(qa.expectedPath);
  await expect(page.getByText("Loading your secure workspace…")).toBeHidden();
}

export async function expectHealthyPage(page: Page, heading?: RegExp) {
  await expect(page.locator("body")).not.toContainText(/unexpected error|resource not found|internal server error/i);
  if (heading) await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
}
