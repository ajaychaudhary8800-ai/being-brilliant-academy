import {
  MeetingActionStatus,
  MeetingMinutesStatus,
  MeetingParticipantRole,
  MeetingPriority,
  MeetingStatus,
  Role,
} from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { assertErpBranchAccess, erpBranchScope } from "../lib/erp-branch-access.js";
import { AppError } from "../lib/http.js";
import { deleteObject, getObject, putObject } from "../lib/storage.js";
import { sendMeetingNotification, staffKind } from "../lib/meeting-scheduling.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { requireCommercialFeature } from "../middleware/commercial-entitlement.js";

const router = Router();
const id = z.string().trim().min(1).max(191);
const managementRoles = new Set<Role>([Role.SUPER_ADMIN, Role.BRANCH_ADMIN]);

router.use(requireAuth, requireCommercialFeature("meetings"));

const org = (req: AuthRequest) => req.auth!.organizationId;
const actor = (req: AuthRequest) => req.auth!.userId;

async function loadMeeting(req: AuthRequest, meetingId: string) {
  const meeting = await prisma.meeting.findFirst({
    where: { organizationId: org(req), id: meetingId },
    include: {
      participants: { where: { removedAt: null } },
      agendaItems: true,
      minutes: true,
      decisions: true,
      actionItems: true,
    },
  });
  if (!meeting) throw new AppError(404, "MEETING_NOT_FOUND", "Meeting not found");
  return meeting;
}

async function assertView(req: AuthRequest, meeting: Awaited<ReturnType<typeof loadMeeting>>) {
  if (req.auth!.role === Role.SUPER_ADMIN) return;
  if (meeting.participants.some(p => p.userId === actor(req))) return;
  if (req.auth!.role === Role.BRANCH_ADMIN && meeting.branchId) {
    assertErpBranchAccess(await erpBranchScope(req), meeting.branchId);
    return;
  }
  throw new AppError(403, "MEETING_FORBIDDEN", "Meeting access denied");
}

async function assertManage(req: AuthRequest, meeting: Awaited<ReturnType<typeof loadMeeting>>) {
  if (req.auth!.role === Role.SUPER_ADMIN) return;
  if (req.auth!.role === Role.BRANCH_ADMIN && meeting.branchId) {
    assertErpBranchAccess(await erpBranchScope(req), meeting.branchId);
    return;
  }
  const member = meeting.participants.find(p => p.userId === actor(req));
  if (member && (member.meetingRole === MeetingParticipantRole.HOST || member.meetingRole === MeetingParticipantRole.CO_HOST)) return;
  throw new AppError(403, "MEETING_MANAGE_FORBIDDEN", "Meeting management access denied");
}

async function audit(req: AuthRequest, meetingId: string, action: string, entityType: string, entityId?: string, metadata?: unknown) {
  await prisma.meetingAuditLog.create({ data: {
    organizationId: org(req), meetingId, actorUserId: actor(req), action, entityType, entityId,
    metadata: metadata as object | undefined, ipAddress: req.ip, userAgent: req.header("user-agent"),
  }});
}

const attachmentInput = z.object({
  name: z.string().trim().min(1).max(180),
  mimeType: z.enum(["application/pdf","image/png","image/jpeg","text/plain","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/vnd.openxmlformats-officedocument.presentationml.presentation"]),
  base64: z.string().min(1),
  agendaItemId: id.nullable().optional(),
  visibility: z.enum(["PARTICIPANTS","MANAGEMENT"]).default("PARTICIPANTS"),
});

router.get("/meetings/:id/attachments", async (req: AuthRequest, res) => {
  const meeting = await loadMeeting(req, String(req.params.id));
  await assertView(req, meeting);
  const manager = req.auth!.role === Role.SUPER_ADMIN || req.auth!.role === Role.BRANCH_ADMIN
    || meeting.participants.some(p => p.userId === actor(req) && (p.meetingRole === MeetingParticipantRole.HOST || p.meetingRole === MeetingParticipantRole.CO_HOST));
  const rows = await prisma.meetingAttachment.findMany({
    where: { organizationId: org(req), meetingId: meeting.id, ...(manager ? {} : { visibility: "PARTICIPANTS" }) },
    orderBy: { createdAt: "desc" },
  });
  res.json({ data: rows.map(({ storageKey: _storageKey, ...row }) => row) });
});

router.post("/meetings/:id/attachments", async (req: AuthRequest, res) => {
  const meeting = await loadMeeting(req, String(req.params.id));
  await assertManage(req, meeting);
  const data = attachmentInput.parse(req.body);
  if (data.agendaItemId && !meeting.agendaItems.some(a => a.id === data.agendaItemId)) throw new AppError(422, "MEETING_AGENDA_INVALID", "Attachment agenda item does not belong to this meeting");
  const body = Buffer.from(data.base64.replace(/^data:[^;]+;base64,/, ""), "base64");
  if (!body.length || body.length > 10 * 1024 * 1024) throw new AppError(422, "MEETING_ATTACHMENT_SIZE", "Meeting attachments must be between 1 byte and 10 MB");
  const extension = data.name.includes(".") ? data.name.slice(data.name.lastIndexOf(".")).replace(/[^a-zA-Z0-9.]/g, "") : "";
  const key = `meetings/${org(req)}/${meeting.id}/attachments/${Date.now()}-${cryptoSafeName(data.name)}`;
  await putObject(key, body, data.mimeType);
  try {
    const row = await prisma.meetingAttachment.create({ data: {
      organizationId: org(req), meetingId: meeting.id, agendaItemId: data.agendaItemId, name: data.name,
      mimeType: data.mimeType, sizeBytes: body.length, storageKey: key, visibility: data.visibility, uploadedById: actor(req),
    }});
    await audit(req, meeting.id, "UPLOAD_ATTACHMENT", "MeetingAttachment", row.id, { name: row.name, sizeBytes: row.sizeBytes });
    const { storageKey: _storageKey, ...safe } = row;
    res.status(201).json({ data: safe });
  } catch (error) {
    await deleteObject(key).catch(() => undefined);
    throw error;
  }
});

router.get("/meetings/:id/attachments/:attachmentId/download", async (req: AuthRequest, res) => {
  const meeting = await loadMeeting(req, String(req.params.id));
  await assertView(req, meeting);
  const attachment = await prisma.meetingAttachment.findFirst({ where: { organizationId: org(req), id: String(req.params.attachmentId), meetingId: meeting.id } });
  if (!attachment) throw new AppError(404, "MEETING_ATTACHMENT_NOT_FOUND", "Meeting attachment not found");
  if (attachment.visibility === "MANAGEMENT") await assertManage(req, meeting);
  const object = await getObject(attachment.storageKey);
  res.setHeader("Content-Type", attachment.mimeType);
  res.setHeader("Content-Disposition", `attachment; filename="${attachment.name.replace(/["\\]/g, "_")}"`);
  for await (const chunk of object as AsyncIterable<Uint8Array | string>) res.write(chunk);
  res.end();
});

router.delete("/meetings/:id/attachments/:attachmentId", async (req: AuthRequest, res) => {
  const meeting = await loadMeeting(req, String(req.params.id));
  await assertManage(req, meeting);
  const attachment = await prisma.meetingAttachment.findFirst({ where: { organizationId: org(req), id: String(req.params.attachmentId), meetingId: meeting.id } });
  if (!attachment) throw new AppError(404, "MEETING_ATTACHMENT_NOT_FOUND", "Meeting attachment not found");
  await prisma.meetingAttachment.delete({ where: { id: attachment.id } });
  await deleteObject(attachment.storageKey).catch(() => undefined);
  await audit(req, meeting.id, "DELETE_ATTACHMENT", "MeetingAttachment", attachment.id, { name: attachment.name });
  res.status(204).send();
});

function cryptoSafeName(name: string) {
  const clean = name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
  return clean || "attachment";
}

router.get("/meetings/:id/audit", async (req: AuthRequest, res) => {
  const meeting = await loadMeeting(req, String(req.params.id));
  await assertManage(req, meeting);
  const rows = await prisma.meetingAuditLog.findMany({
    where: { organizationId: org(req), meetingId: meeting.id },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const actorIds = [...new Set(rows.map(row => row.actorUserId))];
  const users = actorIds.length ? await prisma.user.findMany({
    where: { organizationId: org(req), id: { in: actorIds } },
    select: { id: true, name: true, email: true },
  }) : [];
  const userMap = new Map(users.map(user => [user.id, user]));
  res.json({ data: rows.map(row => ({ ...row, actor: userMap.get(row.actorUserId) ?? null })) });
});

router.get("/meetings/:id/attendance", async (req: AuthRequest, res) => {
  const meeting = await loadMeeting(req, String(req.params.id));
  await assertView(req, meeting);
  const sessions = await prisma.meetingAttendanceSession.findMany({
    where: { organizationId: org(req), meetingId: meeting.id },
    orderBy: { joinedAt: "asc" },
  });
  const users = await prisma.user.findMany({
    where: { organizationId: org(req), id: { in: meeting.participants.map(p => p.userId) } },
    select: { id: true, name: true, email: true },
  });
  const userMap = new Map(users.map(u => [u.id, u]));
  const scheduledSeconds = Math.max(1, Math.round((meeting.endsAt.getTime() - meeting.startsAt.getTime()) / 1000));
  const rows = meeting.participants.map(participant => {
    const own = sessions.filter(s => s.participantId === participant.id);
    const totalDurationSeconds = own.reduce((sum, s) => sum + (s.durationSeconds || (s.leftAt ? Math.max(0, Math.round((s.leftAt.getTime() - s.joinedAt.getTime()) / 1000)) : 0)), 0);
    const ratio = totalDurationSeconds / scheduledSeconds;
    const status = totalDurationSeconds === 0 ? "ABSENT" : ratio >= 0.75 ? "PRESENT" : "PARTIAL";
    return {
      participantId: participant.id,
      userId: participant.userId,
      user: userMap.get(participant.userId) ?? null,
      meetingRole: participant.meetingRole,
      firstJoinedAt: own[0]?.joinedAt ?? null,
      lastLeftAt: own.filter(x => x.leftAt).at(-1)?.leftAt ?? null,
      joinCount: own.length,
      totalDurationSeconds,
      attendancePercentage: Math.min(100, Math.round(ratio * 10000) / 100),
      status,
    };
  });
  const firstJoin = sessions[0]?.joinedAt ?? null;
  const lastLeave = sessions.filter(s => s.leftAt).at(-1)?.leftAt ?? null;
  res.json({ data: {
    meetingId: meeting.id,
    scheduledDurationSeconds: scheduledSeconds,
    actualDurationSeconds: firstJoin && lastLeave ? Math.max(0, Math.round((lastLeave.getTime() - firstJoin.getTime()) / 1000)) : null,
    participants: rows,
  }});
});

router.get("/meetings/:id/minutes", async (req: AuthRequest, res) => {
  const meeting = await loadMeeting(req, String(req.params.id));
  await assertView(req, meeting);
  res.json({ data: meeting.minutes });
});

router.put("/meetings/:id/minutes", async (req: AuthRequest, res) => {
  const meeting = await loadMeeting(req, String(req.params.id));
  await assertManage(req, meeting);
  if (meeting.minutes?.status === MeetingMinutesStatus.PUBLISHED) throw new AppError(409, "MEETING_MINUTES_PUBLISHED", "Published minutes are immutable");
  const data = z.object({
    summary: z.string().trim().max(20000).nullable().optional(),
    notes: z.string().trim().max(50000).nullable().optional(),
  }).parse(req.body);
  const now = new Date();
  const row = await prisma.meetingMinutes.upsert({
    where: { meetingId: meeting.id },
    create: { organizationId: org(req), meetingId: meeting.id, summary: data.summary, notes: data.notes, preparedById: actor(req), preparedAt: now },
    update: { ...data, preparedById: actor(req), preparedAt: now, status: MeetingMinutesStatus.DRAFT, approvedById: null, approvedAt: null },
  });
  if (meeting.status === MeetingStatus.ENDED) await prisma.meeting.update({ where: { id: meeting.id }, data: { status: MeetingStatus.MINUTES_PENDING } });
  await audit(req, meeting.id, "SAVE_MINUTES", "MeetingMinutes", row.id);
  res.json({ data: row });
});

router.post("/meetings/:id/minutes/submit", async (req: AuthRequest, res) => {
  const meeting = await loadMeeting(req, String(req.params.id));
  await assertManage(req, meeting);
  if (!meeting.minutes) throw new AppError(409, "MEETING_MINUTES_REQUIRED", "Prepare meeting minutes before submission");
  if (meeting.minutes.status === MeetingMinutesStatus.PUBLISHED) throw new AppError(409, "MEETING_MINUTES_PUBLISHED", "Published minutes are immutable");
  const row = await prisma.meetingMinutes.update({ where: { id: meeting.minutes.id }, data: { status: MeetingMinutesStatus.UNDER_REVIEW, preparedAt: new Date() } });
  await audit(req, meeting.id, "SUBMIT_MINUTES", "MeetingMinutes", row.id);
  res.json({ data: row });
});

router.post("/meetings/:id/minutes/approve", async (req: AuthRequest, res) => {
  const meeting = await loadMeeting(req, String(req.params.id));
  if (!managementRoles.has(req.auth!.role)) throw new AppError(403, "MEETING_MINUTES_APPROVAL_FORBIDDEN", "Management approval is required");
  await assertView(req, meeting);
  if (!meeting.minutes || meeting.minutes.status !== MeetingMinutesStatus.UNDER_REVIEW) throw new AppError(409, "MEETING_MINUTES_NOT_REVIEWABLE", "Minutes must be under review before approval");
  const row = await prisma.meetingMinutes.update({ where: { id: meeting.minutes.id }, data: { status: MeetingMinutesStatus.APPROVED, approvedById: actor(req), approvedAt: new Date() } });
  await audit(req, meeting.id, "APPROVE_MINUTES", "MeetingMinutes", row.id);
  res.json({ data: row });
});

router.post("/meetings/:id/minutes/publish", async (req: AuthRequest, res) => {
  const meeting = await loadMeeting(req, String(req.params.id));
  if (!managementRoles.has(req.auth!.role)) throw new AppError(403, "MEETING_MINUTES_PUBLISH_FORBIDDEN", "Management permission is required");
  await assertView(req, meeting);
  if (!meeting.minutes || meeting.minutes.status !== MeetingMinutesStatus.APPROVED) throw new AppError(409, "MEETING_MINUTES_NOT_APPROVED", "Approve meeting minutes before publication");
  const now = new Date();
  const row = await prisma.$transaction(async tx => {
    const minutes = await tx.meetingMinutes.update({ where: { id: meeting.minutes!.id }, data: { status: MeetingMinutesStatus.PUBLISHED, publishedAt: now } });
    await tx.meeting.update({ where: { id: meeting.id }, data: { status: MeetingStatus.MINUTES_PUBLISHED } });
    return minutes;
  });
  await Promise.all(meeting.participants.map(p => sendMeetingNotification({
    organizationId: org(req), userId: p.userId, meetingId: meeting.id,
    title: `Meeting minutes published: ${meeting.title}`,
    body: "The approved minutes, decisions and action items are now available.",
  })));
  await audit(req, meeting.id, "PUBLISH_MINUTES", "MeetingMinutes", row.id);
  res.json({ data: row });
});

router.post("/meetings/:id/decisions", async (req: AuthRequest, res) => {
  const meeting = await loadMeeting(req, String(req.params.id));
  await assertManage(req, meeting);
  const data = z.object({
    agendaItemId: id.nullable().optional(),
    decision: z.string().trim().min(2).max(10000),
    rationale: z.string().trim().max(10000).nullable().optional(),
  }).parse(req.body);
  if (data.agendaItemId && !meeting.agendaItems.some(a => a.id === data.agendaItemId)) throw new AppError(422, "MEETING_AGENDA_INVALID", "Decision agenda item does not belong to this meeting");
  const row = await prisma.meetingDecision.create({ data: {
    organizationId: org(req), meetingId: meeting.id, agendaItemId: data.agendaItemId,
    decision: data.decision, rationale: data.rationale, recordedById: actor(req),
  }});
  await audit(req, meeting.id, "CREATE_DECISION", "MeetingDecision", row.id);
  res.status(201).json({ data: row });
});

router.post("/meetings/:id/actions", async (req: AuthRequest, res) => {
  const meeting = await loadMeeting(req, String(req.params.id));
  await assertManage(req, meeting);
  const data = z.object({
    decisionId: id.nullable().optional(),
    title: z.string().trim().min(2).max(300),
    description: z.string().trim().max(10000).nullable().optional(),
    assigneeUserId: id,
    dueAt: z.coerce.date().nullable().optional(),
    priority: z.nativeEnum(MeetingPriority).default(MeetingPriority.NORMAL),
  }).parse(req.body);
  if (!meeting.participants.some(p => p.userId === data.assigneeUserId)) throw new AppError(422, "MEETING_ACTION_ASSIGNEE_INVALID", "Action assignee must be a meeting participant");
  if (data.decisionId && !meeting.decisions.some(d => d.id === data.decisionId)) throw new AppError(422, "MEETING_DECISION_INVALID", "Action decision does not belong to this meeting");
  await staffKind(org(req), data.assigneeUserId);
  const row = await prisma.meetingActionItem.create({ data: {
    organizationId: org(req), meetingId: meeting.id, decisionId: data.decisionId, title: data.title,
    description: data.description, assigneeUserId: data.assigneeUserId, assignedById: actor(req),
    dueAt: data.dueAt, priority: data.priority,
  }});
  await sendMeetingNotification({
    organizationId: org(req), userId: row.assigneeUserId, meetingId: meeting.id,
    title: `Meeting action assigned: ${row.title}`,
    body: row.dueAt ? `Due ${row.dueAt.toISOString()}` : "No due date has been set.",
    priority: row.priority === MeetingPriority.URGENT ? "URGENT" : row.priority === MeetingPriority.HIGH ? "HIGH" : "NORMAL",
  });
  await audit(req, meeting.id, "ASSIGN_ACTION", "MeetingActionItem", row.id, { assigneeUserId: row.assigneeUserId });
  res.status(201).json({ data: row });
});

router.get("/meeting-actions/my", async (req: AuthRequest, res) => {
  const rows = await prisma.meetingActionItem.findMany({
    where: { organizationId: org(req), assigneeUserId: actor(req) },
    include: { meeting: { select: { id: true, title: true, startsAt: true, branchId: true, departmentId: true } } },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }],
  });
  const now = new Date();
  res.json({ data: rows.map(row => ({ ...row, overdue: Boolean(row.dueAt && row.dueAt < now && row.status !== MeetingActionStatus.COMPLETED && row.status !== MeetingActionStatus.CANCELLED) })) });
});

router.get("/meeting-actions", async (req: AuthRequest, res) => {
  if (!managementRoles.has(req.auth!.role)) throw new AppError(403, "MEETING_ACTION_ADMIN_FORBIDDEN", "Management permission is required");
  const q = z.object({ status: z.nativeEnum(MeetingActionStatus).optional(), assigneeUserId: id.optional(), meetingId: id.optional() }).parse(req.query);
  const scope = req.auth!.role === Role.BRANCH_ADMIN ? await erpBranchScope(req) : null;
  const rows = await prisma.meetingActionItem.findMany({
    where: {
      organizationId: org(req), ...(q.status ? { status: q.status } : {}), ...(q.assigneeUserId ? { assigneeUserId: q.assigneeUserId } : {}),
      ...(q.meetingId ? { meetingId: q.meetingId } : {}), ...(scope ? { meeting: { branchId: { in: scope } } } : {}),
    },
    include: { meeting: { select: { id: true, title: true, startsAt: true, branchId: true, departmentId: true } } },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }],
  });
  const now = new Date();
  res.json({ data: rows.map(row => ({ ...row, overdue: Boolean(row.dueAt && row.dueAt < now && row.status !== MeetingActionStatus.COMPLETED && row.status !== MeetingActionStatus.CANCELLED) })) });
});

router.patch("/meeting-actions/:id", async (req: AuthRequest, res) => {
  const action = await prisma.meetingActionItem.findFirst({
    where: { organizationId: org(req), id: String(req.params.id) },
    include: { meeting: { include: { participants: { where: { removedAt: null } } } } },
  });
  if (!action) throw new AppError(404, "MEETING_ACTION_NOT_FOUND", "Meeting action not found");
  const meeting = await loadMeeting(req, action.meetingId);
  await assertManage(req, meeting);
  const data = z.object({
    title: z.string().trim().min(2).max(300).optional(),
    description: z.string().trim().max(10000).nullable().optional(),
    assigneeUserId: id.optional(),
    dueAt: z.coerce.date().nullable().optional(),
    priority: z.nativeEnum(MeetingPriority).optional(),
    status: z.enum([MeetingActionStatus.OPEN, MeetingActionStatus.IN_PROGRESS, MeetingActionStatus.BLOCKED, MeetingActionStatus.CANCELLED]).optional(),
  }).parse(req.body);
  if (data.assigneeUserId && !meeting.participants.some(p => p.userId === data.assigneeUserId)) throw new AppError(422, "MEETING_ACTION_ASSIGNEE_INVALID", "Action assignee must be a meeting participant");
  const row = await prisma.meetingActionItem.update({ where: { id: action.id }, data });
  if (data.assigneeUserId && data.assigneeUserId !== action.assigneeUserId) await sendMeetingNotification({
    organizationId: org(req), userId: data.assigneeUserId, meetingId: meeting.id,
    title: `Meeting action reassigned: ${row.title}`, body: "This action item has been assigned to you.",
  });
  await audit(req, meeting.id, "UPDATE_ACTION", "MeetingActionItem", row.id);
  res.json({ data: row });
});

router.post("/meeting-actions/:id/complete", async (req: AuthRequest, res) => {
  const action = await prisma.meetingActionItem.findFirst({ where: { organizationId: org(req), id: String(req.params.id) } });
  if (!action) throw new AppError(404, "MEETING_ACTION_NOT_FOUND", "Meeting action not found");
  const meeting = await loadMeeting(req, action.meetingId);
  const canComplete = action.assigneeUserId === actor(req);
  if (!canComplete) await assertManage(req, meeting);
  const { completionNote } = z.object({ completionNote: z.string().trim().max(10000).nullable().optional() }).parse(req.body);
  const row = await prisma.meetingActionItem.update({ where: { id: action.id }, data: {
    status: MeetingActionStatus.COMPLETED, completedAt: new Date(), completionNote,
  }});
  if (action.assigneeUserId !== action.assignedById) await sendMeetingNotification({
    organizationId: org(req), userId: action.assignedById, meetingId: meeting.id,
    title: `Meeting action completed: ${row.title}`, body: completionNote || "The assigned action item has been completed.",
  }).catch(() => null);
  await audit(req, meeting.id, "COMPLETE_ACTION", "MeetingActionItem", row.id);
  res.json({ data: row });
});

router.post("/meeting-actions/:id/reopen", async (req: AuthRequest, res) => {
  const action = await prisma.meetingActionItem.findFirst({ where: { organizationId: org(req), id: String(req.params.id) } });
  if (!action) throw new AppError(404, "MEETING_ACTION_NOT_FOUND", "Meeting action not found");
  const meeting = await loadMeeting(req, action.meetingId);
  await assertManage(req, meeting);
  const row = await prisma.meetingActionItem.update({ where: { id: action.id }, data: { status: MeetingActionStatus.OPEN, completedAt: null, completionNote: null } });
  await sendMeetingNotification({
    organizationId: org(req), userId: row.assigneeUserId, meetingId: meeting.id,
    title: `Meeting action reopened: ${row.title}`, body: "This action item has been reopened.",
  });
  await audit(req, meeting.id, "REOPEN_ACTION", "MeetingActionItem", row.id);
  res.json({ data: row });
});

export default router;
