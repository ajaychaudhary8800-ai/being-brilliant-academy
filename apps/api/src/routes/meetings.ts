import crypto from "node:crypto";
import { MeetingParticipantKind, MeetingParticipantRole, MeetingStatus, MeetingType, MeetingVisibility, Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { assertErpBranchAccess, assertErpBranchTarget, erpBranchScope } from "../lib/erp-branch-access.js";
import { AppError } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { requireCommercialFeature } from "../middleware/commercial-entitlement.js";

const router = Router();
const id = z.string().cuid();
const managementRoles = new Set<Role>([Role.SUPER_ADMIN, Role.BRANCH_ADMIN]);
const staffRoles = new Set<Role>([Role.SUPER_ADMIN, Role.BRANCH_ADMIN, Role.ACCOUNTANT, Role.TEACHER, Role.EMPLOYEE]);

router.use(requireAuth, requireCommercialFeature("meetings"));

const org = (req: AuthRequest) => req.auth!.organizationId;
const actor = (req: AuthRequest) => req.auth!.userId;

async function audit(req: AuthRequest, meetingId: string, action: string, entityType = "Meeting", entityId?: string, metadata?: unknown) {
  await prisma.meetingAuditLog.create({ data: {
    organizationId: org(req), meetingId, actorUserId: actor(req), action, entityType, entityId,
    metadata: metadata as object | undefined, ipAddress: req.ip, userAgent: req.header("user-agent"),
  }});
}

async function kindFor(userId: string, organizationId: string) {
  const user = await prisma.user.findFirst({ where: { id: userId, organizationId, isActive: true }, select: { role: true } });
  if (!user || !staffRoles.has(user.role)) throw new AppError(422, "MEETING_PARTICIPANT_INVALID", "Participant must be an active staff user");
  if (user.role === Role.TEACHER) return MeetingParticipantKind.TEACHER;
  if (user.role === Role.EMPLOYEE) return MeetingParticipantKind.EMPLOYEE;
  return MeetingParticipantKind.MANAGEMENT;
}

async function branchIdsFor(userId: string, organizationId: string) {
  const [teacher, employee, assigned] = await Promise.all([
    prisma.teacherProfile.findFirst({ where: { organizationId, userId }, select: { branchId: true } }),
    prisma.employee.findFirst({ where: { organizationId, userId }, select: { branchId: true } }),
    prisma.branchUser.findMany({ where: { organizationId, userId }, select: { branchId: true } }),
  ]);
  return [...new Set([teacher?.branchId, employee?.branchId, ...assigned.map(x => x.branchId)].filter((x): x is string => Boolean(x)))];
}

async function assertParticipantTarget(req: AuthRequest, userId: string, branchId?: string | null) {
  await kindFor(userId, org(req));
  if (req.auth!.role !== Role.BRANCH_ADMIN) return;
  const scope = await erpBranchScope(req);
  const targetBranches = await branchIdsFor(userId, org(req));
  if (branchId) {
    assertErpBranchAccess(scope, branchId);
    if (!targetBranches.includes(branchId)) throw new AppError(403, "MEETING_PARTICIPANT_BRANCH_FORBIDDEN", "Participant is outside this branch");
  } else if (!targetBranches.some(x => scope.includes(x))) {
    throw new AppError(403, "MEETING_PARTICIPANT_BRANCH_FORBIDDEN", "Participant is outside your branch scope");
  }
}

async function getMeeting(req: AuthRequest, meetingId: string) {
  const meeting = await prisma.meeting.findFirst({
    where: { id: meetingId, organizationId: org(req) },
    include: { participants: { where: { removedAt: null } }, agendaItems: { orderBy: { sequence: "asc" } } },
  });
  if (!meeting) throw new AppError(404, "MEETING_NOT_FOUND", "Meeting not found");
  return meeting;
}

async function canView(req: AuthRequest, meeting: Awaited<ReturnType<typeof getMeeting>>) {
  if (req.auth!.role === Role.SUPER_ADMIN) return;
  if (meeting.participants.some(p => p.userId === actor(req))) return;
  if (req.auth!.role === Role.BRANCH_ADMIN && meeting.branchId) {
    assertErpBranchAccess(await erpBranchScope(req), meeting.branchId);
    return;
  }
  throw new AppError(403, "MEETING_FORBIDDEN", "Meeting access denied");
}

async function canManage(req: AuthRequest, meeting: Awaited<ReturnType<typeof getMeeting>>) {
  if (req.auth!.role === Role.SUPER_ADMIN) return;
  if (req.auth!.role === Role.BRANCH_ADMIN && meeting.branchId) {
    assertErpBranchAccess(await erpBranchScope(req), meeting.branchId);
    return;
  }
  const membership = meeting.participants.find(p => p.userId === actor(req));
  if (membership && [MeetingParticipantRole.HOST, MeetingParticipantRole.CO_HOST].includes(membership.meetingRole)) return;
  throw new AppError(403, "MEETING_MANAGE_FORBIDDEN", "Meeting management access denied");
}

const participantInput = z.object({
  userId: id,
  meetingRole: z.nativeEnum(MeetingParticipantRole).default(MeetingParticipantRole.PARTICIPANT),
});

const meetingInput = z.object({
  title: z.string().trim().min(3).max(220),
  description: z.string().max(10000).nullable().optional(),
  type: z.nativeEnum(MeetingType).default(MeetingType.GENERAL),
  branchId: id.nullable().optional(),
  departmentId: id.nullable().optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  timezone: z.string().trim().min(2).max(80),
  visibility: z.nativeEnum(MeetingVisibility).default(MeetingVisibility.INVITE_ONLY),
  hostUserId: id,
  allowRecording: z.boolean().default(false),
  recordingRequired: z.boolean().default(false),
  allowChat: z.boolean().default(true),
  allowWhiteboard: z.boolean().default(true),
  allowAnnotation: z.boolean().default(true),
  allowScreenShare: z.boolean().default(true),
  allowParticipantMic: z.boolean().default(true),
  allowParticipantCamera: z.boolean().default(true),
  joinBeforeMinutes: z.number().int().min(0).max(120).default(10),
  lockAfterStart: z.boolean().default(false),
  participants: z.array(participantInput).max(500).default([]),
}).superRefine((value, ctx) => {
  if (value.endsAt <= value.startsAt) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endsAt"], message: "End time must follow start time" });
  if (value.recordingRequired && !value.allowRecording) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["recordingRequired"], message: "Required recording needs recording enabled" });
});

router.get("/meetings", async (req: AuthRequest, res) => {
  const q = z.object({ status: z.nativeEnum(MeetingStatus).optional(), branchId: id.optional() }).parse(req.query);
  let access: object = { participants: { some: { userId: actor(req), removedAt: null } } };
  if (req.auth!.role === Role.SUPER_ADMIN) access = {};
  if (req.auth!.role === Role.BRANCH_ADMIN) {
    const scope = await erpBranchScope(req);
    if (q.branchId) assertErpBranchAccess(scope, q.branchId);
    access = { OR: [{ branchId: { in: scope } }, { participants: { some: { userId: actor(req), removedAt: null } } }] };
  }
  const data = await prisma.meeting.findMany({
    where: { organizationId: org(req), ...access, ...(q.status ? { status: q.status } : {}), ...(q.branchId ? { branchId: q.branchId } : {}) },
    include: { participants: { where: { removedAt: null } }, agendaItems: { orderBy: { sequence: "asc" } } },
    orderBy: { startsAt: "asc" },
  });
  res.json({ data });
});

router.get("/meetings/:id", async (req: AuthRequest, res) => {
  const meeting = await getMeeting(req, String(req.params.id));
  await canView(req, meeting);
  res.json({ data: meeting });
});

router.post("/meetings", async (req: AuthRequest, res) => {
  if (!managementRoles.has(req.auth!.role)) throw new AppError(403, "MEETING_CREATE_FORBIDDEN", "Only management can schedule meetings");
  const data = meetingInput.parse(req.body);
  if (data.branchId) await assertErpBranchTarget(await erpBranchScope(req), data.branchId);
  await assertParticipantTarget(req, data.hostUserId, data.branchId);

  const participants = new Map(data.participants.map(p => [p.userId, p]));
  participants.set(data.hostUserId, { userId: data.hostUserId, meetingRole: MeetingParticipantRole.HOST });
  for (const p of participants.values()) await assertParticipantTarget(req, p.userId, data.branchId);

  const kinds = new Map<string, MeetingParticipantKind>();
  for (const p of participants.values()) kinds.set(p.userId, await kindFor(p.userId, org(req)));

  const roomName = `mtg_${crypto.randomUUID().replaceAll("-", "")}`;
  const meeting = await prisma.$transaction(async tx => {
    const created = await tx.meeting.create({ data: {
      organizationId: org(req), title: data.title, description: data.description, type: data.type,
      branchId: data.branchId, departmentId: data.departmentId, startsAt: data.startsAt, endsAt: data.endsAt,
      timezone: data.timezone, visibility: data.visibility, hostUserId: data.hostUserId, livekitRoomName: roomName,
      allowRecording: data.allowRecording, recordingRequired: data.recordingRequired, allowChat: data.allowChat,
      allowWhiteboard: data.allowWhiteboard, allowAnnotation: data.allowAnnotation, allowScreenShare: data.allowScreenShare,
      allowParticipantMic: data.allowParticipantMic, allowParticipantCamera: data.allowParticipantCamera,
      joinBeforeMinutes: data.joinBeforeMinutes, lockAfterStart: data.lockAfterStart,
      createdById: actor(req), status: MeetingStatus.SCHEDULED,
    }});
    await tx.meetingParticipant.createMany({ data: [...participants.values()].map(p => ({
      organizationId: org(req), meetingId: created.id, userId: p.userId, participantKind: kinds.get(p.userId)!,
      meetingRole: p.meetingRole, addedById: actor(req),
    }))});
    return created;
  });
  await audit(req, meeting.id, "CREATE", "Meeting", meeting.id, { participantCount: participants.size });
  res.status(201).json({ data: await getMeeting(req, meeting.id) });
});

router.patch("/meetings/:id", async (req: AuthRequest, res) => {
  const meeting = await getMeeting(req, String(req.params.id));
  await canManage(req, meeting);
  if ([MeetingStatus.ENDED, MeetingStatus.CLOSED, MeetingStatus.CANCELLED].includes(meeting.status)) throw new AppError(409, "MEETING_IMMUTABLE", "Meeting is no longer editable");
  const data = meetingInput.omit({ participants: true, hostUserId: true }).partial().parse(req.body);
  const startsAt = data.startsAt ?? meeting.startsAt;
  const endsAt = data.endsAt ?? meeting.endsAt;
  if (endsAt <= startsAt) throw new AppError(422, "MEETING_TIME_INVALID", "End time must follow start time");
  if (data.branchId) await assertErpBranchTarget(await erpBranchScope(req), data.branchId);
  const updated = await prisma.meeting.update({ where: { id: meeting.id }, data });
  await audit(req, meeting.id, "UPDATE", "Meeting", meeting.id);
  res.json({ data: updated });
});

router.post("/meetings/:id/cancel", async (req: AuthRequest, res) => {
  const meeting = await getMeeting(req, String(req.params.id));
  await canManage(req, meeting);
  const data = await prisma.meeting.update({ where: { id: meeting.id }, data: { status: MeetingStatus.CANCELLED, cancelledAt: new Date() } });
  await audit(req, meeting.id, "CANCEL", "Meeting", meeting.id);
  res.json({ data });
});

router.post("/meetings/:id/participants", async (req: AuthRequest, res) => {
  const meeting = await getMeeting(req, String(req.params.id));
  await canManage(req, meeting);
  const data = participantInput.parse(req.body);
  await assertParticipantTarget(req, data.userId, meeting.branchId);
  const participantKind = await kindFor(data.userId, org(req));
  const row = await prisma.meetingParticipant.upsert({
    where: { meetingId_userId: { meetingId: meeting.id, userId: data.userId } },
    create: { organizationId: org(req), meetingId: meeting.id, userId: data.userId, participantKind, meetingRole: data.meetingRole, addedById: actor(req) },
    update: { participantKind, meetingRole: data.meetingRole, removedAt: null },
  });
  await audit(req, meeting.id, "ADD_PARTICIPANT", "MeetingParticipant", row.id, { userId: row.userId });
  res.status(201).json({ data: row });
});

router.delete("/meetings/:id/participants/:participantId", async (req: AuthRequest, res) => {
  const meeting = await getMeeting(req, String(req.params.id));
  await canManage(req, meeting);
  const participant = meeting.participants.find(p => p.id === String(req.params.participantId));
  if (!participant) throw new AppError(404, "MEETING_PARTICIPANT_NOT_FOUND", "Participant not found");
  if (participant.meetingRole === MeetingParticipantRole.HOST) throw new AppError(409, "MEETING_HOST_REQUIRED", "Transfer host before removing the host");
  await prisma.meetingParticipant.update({ where: { id: participant.id }, data: { removedAt: new Date() } });
  await audit(req, meeting.id, "REMOVE_PARTICIPANT", "MeetingParticipant", participant.id, { userId: participant.userId });
  res.status(204).send();
});

export default router;
