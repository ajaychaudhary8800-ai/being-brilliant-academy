import { expect, test } from "@playwright/test";
import { apiJson, loginApi } from "./support/api";
import { assertSafeTarget, expectHealthyPage, type QaRole } from "./support/environment";

async function authenticate(page: import("@playwright/test").Page, request: import("@playwright/test").APIRequestContext, role: QaRole) {
  const session = await loginApi(request, role);
  await page.goto("/");
  await page.evaluate(({ accessToken, refreshToken }) => {
    localStorage.setItem("bba.accessToken", accessToken);
    localStorage.setItem("bba.refreshToken", refreshToken);
  }, session);
  return session;
}

test.beforeEach(({ baseURL }) => assertSafeTarget(baseURL ?? "http://127.0.0.1:3000", true));

test("meetings management scheduler exposes enterprise controls", async ({ page, request }) => {
  await authenticate(page, request, "superAdmin");
  await page.goto("/admin/meetings");
  await expectHealthyPage(page, /Staff & Management Meetings/i);

  await page.getByRole("button", { name: /Schedule meeting/i }).click();
  await expect(page.getByRole("heading", { name: /Schedule staff meeting/i })).toBeVisible();
  await expect(page.getByText("Co-hosts (optional)")).toBeVisible();
  await expect(page.getByText("Room capabilities")).toBeVisible();
  await expect(page.getByText("Allow cloud recording")).toBeVisible();
  await expect(page.getByText("Block late joining after start")).toBeVisible();
  await expect(page.getByLabel("Join window")).toBeVisible();
});

test("meeting detail exposes management workflow controls", async ({ page, request }) => {
  const [superAdmin, teacher, employee] = await Promise.all([
    loginApi(request, "superAdmin"),
    loginApi(request, "teacher"),
    loginApi(request, "employee"),
  ]);
  const token = `ui-signoff-${Date.now()}`;
  const startsAt = new Date(Date.now() + 10 * 60_000);
  const endsAt = new Date(startsAt.getTime() + 30 * 60_000);

  const created = await apiJson<any>(request, superAdmin, "/api/v1/meetings", {
    method: "POST",
    data: {
      title: `QA UI Staff Meeting ${token}`,
      description: "Synthetic staging UI sign-off meeting.",
      type: "STAFF",
      branchId: null,
      departmentId: null,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      timezone: "Asia/Kolkata",
      visibility: "INVITE_ONLY",
      hostUserId: superAdmin.user.id,
      allowRecording: false,
      recordingRequired: false,
      allowChat: true,
      allowWhiteboard: true,
      allowAnnotation: true,
      allowScreenShare: true,
      allowParticipantMic: true,
      allowParticipantCamera: true,
      joinBeforeMinutes: 10,
      lockAfterStart: false,
      participants: [
        { userId: teacher.user.id, meetingRole: "PARTICIPANT" },
        { userId: employee.user.id, meetingRole: "PARTICIPANT" },
      ],
      audiences: [],
      agenda: [{ title: "UI sign-off agenda", sequence: 1, plannedMinutes: 10 }],
    },
  });

  try {
    await authenticate(page, request, "superAdmin");
    await page.goto(`/meetings/${created.data.id}`);
    await expectHealthyPage(page, new RegExp(token, "i"));
    await expect(page.getByRole("button", { name: "Cancel meeting" })).toBeVisible();

    for (const tab of ["Participants", "Agenda", "Attachments", "Attendance", "Minutes", "Decisions", "Actions", "Recordings", "Audit"]) {
      await expect(page.getByRole("button", { name: tab, exact: true })).toBeVisible();
    }

    await page.getByRole("button", { name: "Participants", exact: true }).click();
    await expect(page.getByRole("button", { name: /Make co-host/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Remove/i }).first()).toBeVisible();

    await page.getByRole("button", { name: "Agenda", exact: true }).click();
    await expect(page.getByText("UI sign-off agenda")).toBeVisible();
    await expect(page.getByRole("button", { name: /Add agenda/i })).toBeVisible();

    await page.getByRole("button", { name: "Attachments", exact: true }).click();
    await expect(page.getByText(/Private files are accessible only to authorized meeting participants/i)).toBeVisible();
    await expect(page.getByText("Upload", { exact: true })).toBeVisible();
  } finally {
    await apiJson(request, superAdmin, `/api/v1/meetings/${created.data.id}/cancel`, { method: "POST", data: {} }).catch(() => undefined);
  }
});

test("employee portal exposes Meetings and opens My Meetings", async ({ page, request }) => {
  await authenticate(page, request, "employee");
  await page.goto("/employee");
  await expectHealthyPage(page, /Employee Portal/i);
  const meetings = page.getByRole("link", { name: "Meetings", exact: true });
  await expect(meetings).toBeVisible();
  await meetings.click();
  await expectHealthyPage(page, /My Meetings/i);
});

test("teacher can open My Meetings", async ({ page, request }) => {
  await authenticate(page, request, "teacher");
  await page.goto("/meetings");
  await expectHealthyPage(page, /My Meetings/i);
});

test("@mobile meetings management remains usable on a phone viewport", async ({ page, request }) => {
  await authenticate(page, request, "superAdmin");
  await page.goto("/admin/meetings");
  await expectHealthyPage(page, /Staff & Management Meetings/i);
  const schedule = page.getByRole("button", { name: /Schedule meeting/i });
  await expect(schedule).toBeVisible();
  await schedule.click();
  await expect(page.getByRole("heading", { name: /Schedule staff meeting/i })).toBeVisible();
  await expect(page.getByLabel("Meeting title")).toBeVisible();
  await expect(page.getByText("Room capabilities")).toBeVisible();
});
