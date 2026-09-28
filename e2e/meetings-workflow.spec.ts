import { expect, test } from "@playwright/test";
import { apiJson, loginApi } from "./support/api";
import { assertSafeTarget } from "./support/environment";

test("@meeting-workflow enterprise staff meeting lifecycle", async ({ request, baseURL }) => {
  test.skip(process.env.QA_RUN_MUTATION_TESTS !== "true", "Mutation workflow suite is disabled");
  assertSafeTarget(baseURL ?? "http://127.0.0.1:3000", true);

  const [superAdmin, teacher, employee] = await Promise.all([
    loginApi(request, "superAdmin"),
    loginApi(request, "teacher"),
    loginApi(request, "employee"),
  ]);

  const token = `meeting-qa-${Date.now()}`;
  const startsAt = new Date(Date.now() + 5 * 60_000);
  const endsAt = new Date(startsAt.getTime() + 30 * 60_000);

  const created = await apiJson<any>(
    request,
    superAdmin,
    "/api/v1/meetings",
    {
      method: "POST",
      data: {
        title: `QA Staff Meeting ${token}`,
        description: "Synthetic staging QA meeting for enterprise collaboration validation.",
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
        agenda: [
          { title: "QA agenda", sequence: 1, plannedMinutes: 10 },
        ],
      },
    },
  );

  const meeting = created.data;
  expect(meeting.id).toBeTruthy();
  expect(meeting.livekitRoomName).toMatch(/^mtg_/);
  expect(meeting.participants).toHaveLength(3);

  const teacherMeetings = await apiJson<any>(request, teacher, "/api/v1/meetings");
  expect(teacherMeetings.data.some((item: any) => item.id === meeting.id)).toBe(true);

  const employeeMeetings = await apiJson<any>(request, employee, "/api/v1/meetings");
  expect(employeeMeetings.data.some((item: any) => item.id === meeting.id)).toBe(true);

  const teacherRsvp = await apiJson<any>(
    request,
    teacher,
    `/api/v1/meetings/${meeting.id}/respond`,
    { method: "POST", data: { response: "ACCEPTED" } },
  );
  expect(teacherRsvp.data.responseStatus).toBe("ACCEPTED");

  const employeeRsvp = await apiJson<any>(
    request,
    employee,
    `/api/v1/meetings/${meeting.id}/respond`,
    { method: "POST", data: { response: "ACCEPTED" } },
  );
  expect(employeeRsvp.data.responseStatus).toBe("ACCEPTED");

  const teacherSession = await apiJson<any>(
    request,
    teacher,
    `/api/v1/meetings/native/${meeting.livekitRoomName}/session`,
    { method: "POST", data: {} },
  );
  expect(teacherSession.data.serverUrl).toBeTruthy();
  expect(teacherSession.data.participantToken).toBeTruthy();
  expect(teacherSession.data.meetingRole).toBe("PARTICIPANT");

  const employeeSession = await apiJson<any>(
    request,
    employee,
    `/api/v1/meetings/native/${meeting.livekitRoomName}/session`,
    { method: "POST", data: {} },
  );
  expect(employeeSession.data.participantToken).toBeTruthy();

  await apiJson(
    request,
    teacher,
    `/api/v1/meetings/native/${meeting.livekitRoomName}/join`,
    { method: "POST", data: {} },
  );
  await apiJson(
    request,
    employee,
    `/api/v1/meetings/native/${meeting.livekitRoomName}/join`,
    { method: "POST", data: {} },
  );
  await apiJson(
    request,
    employee,
    `/api/v1/meetings/native/${meeting.livekitRoomName}/leave`,
    { method: "POST", data: {} },
  );

  const attachment = await apiJson<any>(
    request,
    superAdmin,
    `/api/v1/meetings/${meeting.id}/attachments`,
    {
      method: "POST",
      data: {
        name: `${token}.txt`,
        mimeType: "text/plain",
        base64: Buffer.from(`Synthetic meeting attachment ${token}`).toString("base64"),
        visibility: "PARTICIPANTS",
      },
    },
  );
  expect(attachment.data.id).toBeTruthy();

  const attachments = await apiJson<any>(
    request,
    teacher,
    `/api/v1/meetings/${meeting.id}/attachments`,
  );
  expect(attachments.data.some((item: any) => item.id === attachment.data.id)).toBe(true);

  const decision = await apiJson<any>(
    request,
    superAdmin,
    `/api/v1/meetings/${meeting.id}/decisions`,
    {
      method: "POST",
      data: {
        decision: `QA decision ${token}`,
        rationale: "Synthetic workflow validation.",
      },
    },
  );
  expect(decision.data.id).toBeTruthy();

  const action = await apiJson<any>(
    request,
    superAdmin,
    `/api/v1/meetings/${meeting.id}/actions`,
    {
      method: "POST",
      data: {
        decisionId: decision.data.id,
        title: `QA action ${token}`,
        assigneeUserId: teacher.user.id,
        dueAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
        priority: "NORMAL",
      },
    },
  );
  expect(action.data.status).toBe("OPEN");

  const myActions = await apiJson<any>(request, teacher, "/api/v1/meeting-actions/my");
  expect(myActions.data.some((item: any) => item.id === action.data.id)).toBe(true);

  const completedAction = await apiJson<any>(
    request,
    teacher,
    `/api/v1/meeting-actions/${action.data.id}/complete`,
    { method: "POST", data: { completionNote: `Completed by staging QA ${token}` } },
  );
  expect(completedAction.data.status).toBe("COMPLETED");

  const ended = await apiJson<any>(
    request,
    superAdmin,
    `/api/v1/meetings/native/${meeting.livekitRoomName}/end`,
    { method: "POST", data: {} },
  );
  expect(ended.data.status).toBe("ENDED");

  const attendance = await apiJson<any>(
    request,
    superAdmin,
    `/api/v1/meetings/${meeting.id}/attendance`,
  );
  const teacherAttendance = attendance.data.participants.find((item: any) => item.userId === teacher.user.id);
  const employeeAttendance = attendance.data.participants.find((item: any) => item.userId === employee.user.id);
  expect(teacherAttendance?.joinCount).toBeGreaterThan(0);
  expect(employeeAttendance?.joinCount).toBeGreaterThan(0);

  const minutes = await apiJson<any>(
    request,
    superAdmin,
    `/api/v1/meetings/${meeting.id}/minutes`,
    {
      method: "PUT",
      data: {
        summary: `QA summary ${token}`,
        notes: `QA meeting minutes ${token}`,
      },
    },
  );
  expect(minutes.data.status).toBe("DRAFT");

  const submitted = await apiJson<any>(
    request,
    superAdmin,
    `/api/v1/meetings/${meeting.id}/minutes/submit`,
    { method: "POST", data: {} },
  );
  expect(submitted.data.status).toBe("UNDER_REVIEW");

  const approved = await apiJson<any>(
    request,
    superAdmin,
    `/api/v1/meetings/${meeting.id}/minutes/approve`,
    { method: "POST", data: {} },
  );
  expect(approved.data.status).toBe("APPROVED");

  const published = await apiJson<any>(
    request,
    superAdmin,
    `/api/v1/meetings/${meeting.id}/minutes/publish`,
    { method: "POST", data: {} },
  );
  expect(published.data.status).toBe("PUBLISHED");

  const finalMeeting = await apiJson<any>(request, teacher, `/api/v1/meetings/${meeting.id}`);
  expect(finalMeeting.data.status).toBe("MINUTES_PUBLISHED");
  expect(finalMeeting.data.minutes?.status).toBe("PUBLISHED");

  await apiJson(
    request,
    superAdmin,
    `/api/v1/meetings/${meeting.id}/attachments/${attachment.data.id}`,
    { method: "DELETE" },
  );
});
