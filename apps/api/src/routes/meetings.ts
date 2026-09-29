import crypto from "node:crypto";
import {
  MeetingAudienceType,
  MeetingParticipantRole,
  MeetingResponseStatus,
  MeetingStatus,
  MeetingType,
  MeetingVisibility,
  Role,
} from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { assertErpBranchAccess, assertErpBranchTarget, erpBranchScope } from "../lib/erp-branch-access.js";
import { AppError } from "../lib/http.js";
import { generateMeetingOccurrences } from "../lib/meeting-recurrence.js";
import {
  invalidateFutureMeetingNotifications,
  participantBranchIds,
  resolveMeetingParticipants,
  scheduleMeetingNotifications,
  staffKind,
  type MeetingAudienceSeed,
} from "../lib/meeting-scheduling.js";
import { prisma } from "../lib/prisma.js";
import { assertFeatureEntitled } from "../lib/saas-commercial.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { requireCommercialFeature } from "../middleware/commercial-entitlement.js";

const router = Router();
const id = z.string().trim().min(1).max(191);
const managementRoles = new Set<Role>([Role.SUPER_ADMIN, Role.BRANCH_ADMIN]);
const mutableMeetingStatuses = new Set<MeetingStatus>([MeetingStatus.DRAFT, MeetingStatus.SCHEDULED, MeetingStatus.OPEN_FOR_JOIN, MeetingStatus.LIVE]);
const respondableMeetingStatuses = new Set<MeetingStatus>([MeetingStatus.SCHEDULED, MeetingStatus.OPEN_FOR_JOIN, MeetingStatus.LIVE]);
const cancellableMeetingStatuses = new Set<MeetingStatus>([MeetingStatus.DRAFT, MeetingStatus.SCHEDULED]);

router.use(requireAuth, requireCommercialFeature("meetings"));

const org = (req: AuthRequest) => req.auth!.organizationId;
const actor = (req: AuthRequest) => req.auth!.userId;

async function audit(req: AuthRequest, meetingId: string, action: string, entityType = "Meeting", entityId?: string, metadata?: unknown) {
  await prisma.meetingAuditLog.create({ data: {
    organizationId: org(req), meetingId, actorUserId: actor(req), action, entityType, entityId,
    metadata: metadata as object | undefined, ipAddress: req.ip, userAgent: req.header("user-agent"),
  }});
}

async function allowedBranches(req: AuthRequest) {
  return req.auth!.role === Role.BRANCH_ADMIN ? erpBranchScope(req) : null;
}

async function validateScope(req: AuthRequest, branchId?: string | null, departmentId?: string | null) {
  if (req.auth!.role === Role.BRANCH_ADMIN && !branchId) {
    throw new AppError(403, "MEETING_BRANCH_REQUIRED", "Branch administrators can schedule meetings only within an assigned branch");
  }
  if (branchId) await assertErpBranchTarget(await erpBranchScope(req), branchId);
  if (departmentId) {
    const department = await prisma.department.findFirst({ where: { organizationId: org(req), id: departmentId, isArchived: false }, select: { id: true } });
    if (!department) throw new AppError(422, "MEETING_DEPARTMENT_INVALID", "Meeting department is not available");
  }
}

async function getMeeting(req: AuthRequest, meetingId: string) {
  const meeting = await prisma.meeting.findFirst({
    where: { id: meetingId, organizationId: org(req) },
    include: {
      participants: { where: { removedAt: null } },
      audiences: true,
      agendaItems: { orderBy: { sequence: "asc" } },
      minutes: true,
      decisions: true,
      actionItems: true,
      recordings: true,
    },
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

function assertMeetingMutable(meeting: Awaited<ReturnType<typeof getMeeting>>) {
  if (!mutableMeetingStatuses.has(meeting.status)) throw new AppError(409, "MEETING_IMMUTABLE", "Meeting is no longer editable");
}

async function canManage(req: AuthRequest, meeting: Awaited<ReturnType<typeof getMeeting>>) {
  if (req.auth!.role === Role.SUPER_ADMIN) return;
  if (req.auth!.role === Role.BRANCH_ADMIN && meeting.branchId) {
    assertErpBranchAccess(await erpBranchScope(req), meeting.branchId);
    return;
  }
  const membership = meeting.participants.find(p => p.userId === actor(req));
  if (membership && (membership.meetingRole === MeetingParticipantRole.HOST || membership.meetingRole === MeetingParticipantRole.CO_HOST)) return;
  throw new AppError(403, "MEETING_MANAGE_FORBIDDEN", "Meeting management access denied");
}

const participantInput = z.object({
  userId: id,
  meetingRole: z.nativeEnum(MeetingParticipantRole).default(MeetingParticipantRole.PARTICIPANT),
});

const audienceInput = z.object({
  type: z.nativeEnum(MeetingAudienceType),
  branchId: id.nullable().optional(),
  departmentId: id.nullable().optional(),
  teamId: id.nullable().optional(),
  role: z.string().trim().max(60).nullable().optional(),
  valueId: id.nullable().optional(),
});

const agendaInput = z.object({
  title: z.string().trim().min(2).max(220),
  description: z.string().trim().max(5000).nullable().optional(),
  sequence: z.number().int().min(1).max(500),
  presenterUserId: id.nullable().optional(),
  plannedMinutes: z.number().int().min(1).max(1440).nullable().optional(),
});

const meetingBaseInput = z.object({
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
  audiences: z.array(audienceInput).max(100).default([]),
  agenda: z.array(agendaInput).max(100).default([]),
});

function validateTimes(value: { startsAt: Date; endsAt: Date; allowRecording: boolean; recordingRequired: boolean }, ctx: z.RefinementCtx) {
  if (value.endsAt <= value.startsAt) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endsAt"], message: "End time must follow start time" });
  if (value.recordingRequired && !value.allowRecording) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["recordingRequired"], message: "Required recording needs recording enabled" });
}

const meetingInput = meetingBaseInput.superRefine(validateTimes);
const seriesInput = meetingBaseInput.extend({
  recurrenceRule: z.string().trim().min(8).max(300),
  recurrenceEnd: z.coerce.date().nullable().optional(),
  maxOccurrences: z.number().int().min(1).max(100).default(52),
}).superRefine((value, ctx) => {
  validateTimes(value, ctx);
  if (value.recurrenceEnd && value.recurrenceEnd < value.startsAt) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["recurrenceEnd"], message: "Recurrence end cannot precede the first meeting" });
});

type ScheduleData = z.infer<typeof meetingBaseInput>;

async function resolvedParticipants(req: AuthRequest, data: ScheduleData) {
  return resolveMeetingParticipants({
    organizationId: org(req),
    hostUserId: data.hostUserId,
    meetingBranchId: data.branchId,
    explicit: data.participants,
    audiences: data.audiences as MeetingAudienceSeed[],
    allowedBranchIds: await allowedBranches(req),
  });
}

function scheduleDurationMinutes(data: { startsAt: Date; endsAt: Date }) {
  return Math.ceil((data.endsAt.getTime() - data.startsAt.getTime()) / 60_000);
}

async function enforceMeetingPlanLimits(req: AuthRequest, data: { startsAt: Date; endsAt: Date; allowRecording: boolean }, participantCount: number) {
  const policy = await assertFeatureEntitled(org(req), "meetings");
  if (data.allowRecording) await assertFeatureEntitled(org(req), "meetings_recording");
  if (!policy.enforcementEnabled) return;
  const limits = policy.plan?.limits ?? {};
  const maxParticipants = limits["meeting.maxParticipants"];
  const maxDuration = limits["meeting.maxDurationMinutes"];
  if (typeof maxParticipants === "number" && participantCount > maxParticipants) {
    throw new AppError(409, "MEETING_PARTICIPANT_LIMIT", `Your plan allows up to ${maxParticipants} meeting participants`);
  }
  const duration = scheduleDurationMinutes(data);
  if (typeof maxDuration === "number" && duration > maxDuration) {
    throw new AppError(409, "MEETING_DURATION_LIMIT", `Your plan allows meetings up to ${maxDuration} minutes`);
  }
}

async function createOccurrence(input: {
  req: AuthRequest;
  data: ScheduleData;
  participants: Awaited<ReturnType<typeof resolvedParticipants>>;
  startsAt: Date;
  endsAt: Date;
  seriesId?: string;
  occurrenceIndex?: number;
}) {
  const { req, data, participants } = input;
  return prisma.$transaction(async tx => {
    const calendarEvent = await tx.calendarEvent.create({ data: {
      organizationId: org(req), branchId: data.branchId, title: data.title, description: data.description,
      type: "MEETING", startsAt: input.startsAt, endsAt: input.endsAt, location: "Online",
      reminders: [1440, 60, 10], status: "SCHEDULED",
    }});
    const meeting = await tx.meeting.create({ data: {
      organizationId: org(req), seriesId: input.seriesId, occurrenceIndex: input.occurrenceIndex, calendarEventId: calendarEvent.id,
      title: data.title, description: data.description, type: data.type, branchId: data.branchId, departmentId: data.departmentId,
      startsAt: input.startsAt, endsAt: input.endsAt, timezone: data.timezone, visibility: data.visibility,
      hostUserId: data.hostUserId, livekitRoomName: `mtg_${crypto.randomUUID().replaceAll("-", "")}`,
      allowRecording: data.allowRecording, recordingRequired: data.recordingRequired, allowChat: data.allowChat,
      allowWhiteboard: data.allowWhiteboard, allowAnnotation: data.allowAnnotation, allowScreenShare: data.allowScreenShare,
      allowParticipantMic: data.allowParticipantMic, allowParticipantCamera: data.allowParticipantCamera,
      joinBeforeMinutes: data.joinBeforeMinutes, lockAfterStart: data.lockAfterStart,
      createdById: actor(req), status: MeetingStatus.SCHEDULED,
    }});
    if (data.audiences.length) await tx.meetingAudience.createMany({ data: data.audiences.map(a => ({ ...a, organizationId: org(req), meetingId: meeting.id })) });
    if (data.agenda.length) await tx.meetingAgendaItem.createMany({ data: data.agenda.map(a => ({ ...a, organizationId: org(req), meetingId: meeting.id })) });
    await tx.meetingParticipant.createMany({ data: participants.map(p => ({
      organizationId: org(req), meetingId: meeting.id, userId: p.userId, participantKind: p.participantKind,
      meetingRole: p.meetingRole, addedById: actor(req),
    }))});
    if (participants.length) await tx.calendarEventRsvp.createMany({ data: participants.map(p => ({
      organizationId: org(req), eventId: calendarEvent.id, userId: p.userId, response: "PENDING",
    }))});
    return meeting;
  });
}

router.get("/meetings/options", async (req: AuthRequest, res) => {
  if (!managementRoles.has(req.auth!.role)) throw new AppError(403, "MEETING_OPTIONS_FORBIDDEN", "Meeting scheduling options require management access");
  const scope = await allowedBranches(req);
  const branchWhere = scope ? { id: { in: scope } } : {};
  const [branches, departments, users, teams] = await Promise.all([
    prisma.branch.findMany({
      where: { organizationId: org(req), isActive: true, ...branchWhere },
      select: { id: true, branchName: true, branchCode: true },
      orderBy: { branchName: "asc" },
    }),
    prisma.department.findMany({
      where: { organizationId: org(req), isArchived: false },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: {
        organizationId: org(req),
        isActive: true,
        role: { in: [Role.SUPER_ADMIN, Role.BRANCH_ADMIN, Role.ACCOUNTANT, Role.TEACHER, Role.EMPLOYEE] },
        ...(scope ? {
          OR: [
            { teacherProfile: { branchId: { in: scope } } },
            { employee: { branchId: { in: scope } } },
            { branchAssignments: { some: { branchId: { in: scope } } } },
          ],
        } : {}),
      },
      select: {
        id: true, name: true, email: true, role: true,
        teacherProfile: { select: { branchId: true } },
        employee: { select: { branchId: true, departmentId: true, employeeCode: true } },
        branchAssignments: { select: { branchId: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.meetingTeam.findMany({
      where: { organizationId: org(req), isActive: true, ...(scope ? { OR: [{ branchId: null }, { branchId: { in: scope } }] } : {}) },
      include: { members: true },
      orderBy: { name: "asc" },
    }),
  ]);
  res.json({ data: { branches, departments, users, teams } });
});

router.get("/meeting-teams", async (req: AuthRequest, res) => {
  if (!managementRoles.has(req.auth!.role)) throw new AppError(403, "MEETING_TEAM_FORBIDDEN", "Meeting team administration requires management access");
  const scope = await allowedBranches(req);
  const data = await prisma.meetingTeam.findMany({
    where: { organizationId: org(req), isActive: true, ...(scope ? { branchId: { in: scope } } : {}) },
    include: { members: true },
    orderBy: { name: "asc" },
  });
  res.json({ data });
});

router.post("/meeting-teams", async (req: AuthRequest, res) => {
  if (!managementRoles.has(req.auth!.role)) throw new AppError(403, "MEETING_TEAM_FORBIDDEN", "Meeting team administration requires management access");
  const data = z.object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(2000).nullable().optional(),
    branchId: id.nullable().optional(),
    departmentId: id.nullable().optional(),
    memberUserIds: z.array(id).max(500).default([]),
  }).parse(req.body);
  await validateScope(req, data.branchId, data.departmentId);
  const scope = await allowedBranches(req);
  for (const userId of data.memberUserIds) {
    await staffKind(org(req), userId);
    if (scope) {
      const branches = await participantBranchIds(org(req), userId);
      const required = data.branchId;
      if (required ? !branches.includes(required) : !branches.some(x => scope.includes(x))) throw new AppError(403, "MEETING_PARTICIPANT_BRANCH_FORBIDDEN", "Team member is outside your branch scope");
    }
  }
  const team = await prisma.$transaction(async tx => {
    const created = await tx.meetingTeam.create({ data: {
      organizationId: org(req), name: data.name, description: data.description, branchId: data.branchId,
      departmentId: data.departmentId, createdById: actor(req),
    }});
    if (data.memberUserIds.length) await tx.meetingTeamMember.createMany({ data: [...new Set(data.memberUserIds)].map(userId => ({
      organizationId: org(req), teamId: created.id, userId, addedById: actor(req),
    }))});
    return created;
  });
  res.status(201).json({ data: await prisma.meetingTeam.findUnique({ where: { id: team.id }, include: { members: true } }) });
});

router.post("/meeting-teams/:id/members", async (req: AuthRequest, res) => {
  if (!managementRoles.has(req.auth!.role)) throw new AppError(403, "MEETING_TEAM_FORBIDDEN", "Meeting team administration requires management access");
  const team = await prisma.meetingTeam.findFirst({ where: { organizationId: org(req), id: String(req.params.id), isActive: true }, include: { members: true } });
  if (!team) throw new AppError(404, "MEETING_TEAM_NOT_FOUND", "Meeting team not found");
  const scope = await allowedBranches(req);
  if (scope && team.branchId && !scope.includes(team.branchId)) throw new AppError(403, "MEETING_TEAM_BRANCH_FORBIDDEN", "Meeting team is outside your branch scope");
  const { userId } = z.object({ userId: id }).parse(req.body);
  await staffKind(org(req), userId);
  if (scope) {
    const branches = await participantBranchIds(org(req), userId);
    if (team.branchId ? !branches.includes(team.branchId) : !branches.some(x => scope.includes(x))) throw new AppError(403, "MEETING_PARTICIPANT_BRANCH_FORBIDDEN", "Team member is outside your branch scope");
  }
  const row = await prisma.meetingTeamMember.upsert({
    where: { teamId_userId: { teamId: team.id, userId } },
    create: { organizationId: org(req), teamId: team.id, userId, addedById: actor(req) },
    update: {},
  });
  res.status(201).json({ data: row });
});

router.delete("/meeting-teams/:id/members/:userId", async (req: AuthRequest, res) => {
  if (!managementRoles.has(req.auth!.role)) throw new AppError(403, "MEETING_TEAM_FORBIDDEN", "Meeting team administration requires management access");
  const team = await prisma.meetingTeam.findFirst({ where: { organizationId: org(req), id: String(req.params.id) }, select: { id: true, branchId: true } });
  if (!team) throw new AppError(404, "MEETING_TEAM_NOT_FOUND", "Meeting team not found");
  const scope = await allowedBranches(req);
  if (scope && team.branchId && !scope.includes(team.branchId)) throw new AppError(403, "MEETING_TEAM_BRANCH_FORBIDDEN", "Meeting team is outside your branch scope");
  await prisma.meetingTeamMember.deleteMany({ where: { organizationId: org(req), teamId: team.id, userId: String(req.params.userId) } });
  res.status(204).send();
});

router.get("/meeting-series/:id", async (req: AuthRequest, res) => {
  const series = await prisma.meetingSeries.findFirst({
    where: { organizationId: org(req), id: String(req.params.id) },
    include: { meetings: { orderBy: { occurrenceIndex: "asc" }, include: { participants: { where: { removedAt: null } } } } },
  });
  if (!series) throw new AppError(404, "MEETING_SERIES_NOT_FOUND", "Meeting series not found");
  if (req.auth!.role !== Role.SUPER_ADMIN) {
    const visible = series.meetings.some(m => m.participants.some(p => p.userId === actor(req)));
    if (!visible && req.auth!.role !== Role.BRANCH_ADMIN) throw new AppError(403, "MEETING_FORBIDDEN", "Meeting series access denied");
    if (!visible && req.auth!.role === Role.BRANCH_ADMIN) {
      const scope = await erpBranchScope(req);
      if (!series.meetings.some(m => m.branchId && scope.includes(m.branchId))) throw new AppError(403, "MEETING_FORBIDDEN", "Meeting series access denied");
    }
  }
  res.json({ data: series });
});

router.post("/meeting-series", async (req: AuthRequest, res) => {
  if (!managementRoles.has(req.auth!.role)) throw new AppError(403, "MEETING_CREATE_FORBIDDEN", "Only management can schedule recurring meetings");
  const data = seriesInput.parse(req.body);
  await validateScope(req, data.branchId, data.departmentId);
  const participants = await resolvedParticipants(req, data);
  await enforceMeetingPlanLimits(req, data, participants.length);
  const horizon = data.recurrenceEnd ?? new Date(data.startsAt.getTime() + 366 * 86400000);
  const occurrences = generateMeetingOccurrences({
    startsAt: data.startsAt, endsAt: data.endsAt, timezone: data.timezone,
    rule: data.recurrenceRule, horizon, maxOccurrences: data.maxOccurrences,
  });
  const template = JSON.parse(JSON.stringify({
    ...data, startsAt: data.startsAt.toISOString(), endsAt: data.endsAt.toISOString(),
    recurrenceEnd: data.recurrenceEnd?.toISOString() ?? null,
  }));
  const series = await prisma.meetingSeries.create({ data: {
    organizationId: org(req), title: data.title, timezone: data.timezone, recurrenceRule: data.recurrenceRule,
    recurrenceStart: data.startsAt, recurrenceEnd: data.recurrenceEnd ?? occurrences.at(-1)!.startsAt,
    template, generationHorizon: horizon, lastGeneratedAt: new Date(), createdById: actor(req),
  }});
  const created = [];
  try {
    for (const occurrence of occurrences) {
      created.push(await createOccurrence({
        req, data, participants, startsAt: occurrence.startsAt, endsAt: occurrence.endsAt,
        seriesId: series.id, occurrenceIndex: occurrence.occurrenceIndex,
      }));
    }
  } catch (error) {
    const partial = await prisma.meeting.findMany({ where: { organizationId: org(req), seriesId: series.id }, select: { calendarEventId: true } }).catch(() => []);
    await prisma.meeting.deleteMany({ where: { organizationId: org(req), seriesId: series.id } }).catch(() => {});
    const eventIds = partial.map(x => x.calendarEventId).filter((x): x is string => Boolean(x));
    if (eventIds.length) await prisma.calendarEvent.deleteMany({ where: { organizationId: org(req), id: { in: eventIds } } }).catch(() => {});
    await prisma.meetingSeries.delete({ where: { id: series.id } }).catch(() => {});
    throw error;
  }
  const first = created[0]!;
  const firstParticipants = await prisma.meetingParticipant.findMany({ where: { organizationId: org(req), meetingId: first.id }, select: { id: true, userId: true } });
  await scheduleMeetingNotifications({
    organizationId: org(req), meetingId: first.id, title: first.title, startsAt: first.startsAt, timezone: first.timezone,
    participants: firstParticipants, invitation: true, seriesInvitation: true,
  });
  await prisma.meetingParticipant.updateMany({
    where: { organizationId: org(req), meetingId: { in: created.map(x => x.id) } },
    data: { invitationStatus: "SENT", invitedAt: new Date() },
  });
  await audit(req, first.id, "CREATE_SERIES", "MeetingSeries", series.id, { occurrences: created.length, recurrenceRule: data.recurrenceRule });
  res.status(201).json({ data: { series, meetings: created } });
});

router.get("/meetings", async (req: AuthRequest, res) => {
  const q = z.object({
    status: z.nativeEnum(MeetingStatus).optional(), branchId: id.optional(), departmentId: id.optional(),
    seriesId: id.optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional(),
  }).parse(req.query);
  let access: object = { participants: { some: { userId: actor(req), removedAt: null } } };
  if (req.auth!.role === Role.SUPER_ADMIN) access = {};
  if (req.auth!.role === Role.BRANCH_ADMIN) {
    const scope = await erpBranchScope(req);
    if (q.branchId) assertErpBranchAccess(scope, q.branchId);
    access = { OR: [{ branchId: { in: scope } }, { participants: { some: { userId: actor(req), removedAt: null } } }] };
  }
  const data = await prisma.meeting.findMany({
    where: {
      organizationId: org(req), ...access,
      ...(q.status ? { status: q.status } : {}), ...(q.branchId ? { branchId: q.branchId } : {}),
      ...(q.departmentId ? { departmentId: q.departmentId } : {}), ...(q.seriesId ? { seriesId: q.seriesId } : {}),
      ...(q.from || q.to ? { startsAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
    },
    include: { participants: { where: { removedAt: null } }, audiences: true, agendaItems: { orderBy: { sequence: "asc" } } },
    orderBy: { startsAt: "asc" },
  });
  res.json({ data });
});

router.get("/meetings/:id", async (req: AuthRequest, res) => {
  const meeting = await getMeeting(req, String(req.params.id));
  await canView(req, meeting);
  const users = await prisma.user.findMany({
    where: { organizationId: org(req), id: { in: meeting.participants.map(p => p.userId) } },
    select: { id: true, name: true, email: true, role: true },
  });
  const userMap = new Map(users.map(user => [user.id, user]));
  res.json({ data: {
    ...meeting,
    participants: meeting.participants.map(participant => ({ ...participant, user: userMap.get(participant.userId) ?? null })),
  }});
});

router.post("/meetings", async (req: AuthRequest, res) => {
  if (!managementRoles.has(req.auth!.role)) throw new AppError(403, "MEETING_CREATE_FORBIDDEN", "Only management can schedule meetings");
  const data = meetingInput.parse(req.body);
  await validateScope(req, data.branchId, data.departmentId);
  const participants = await resolvedParticipants(req, data);
  await enforceMeetingPlanLimits(req, data, participants.length);
  const meeting = await createOccurrence({ req, data, participants, startsAt: data.startsAt, endsAt: data.endsAt });
  const rows = await prisma.meetingParticipant.findMany({ where: { organizationId: org(req), meetingId: meeting.id }, select: { id: true, userId: true } });
  await scheduleMeetingNotifications({
    organizationId: org(req), meetingId: meeting.id, title: meeting.title, startsAt: meeting.startsAt,
    timezone: meeting.timezone, participants: rows, invitation: true,
  });
  await audit(req, meeting.id, "CREATE", "Meeting", meeting.id, { participantCount: participants.length, audienceCount: data.audiences.length });
  res.status(201).json({ data: await getMeeting(req, meeting.id) });
});

router.patch("/meetings/:id", async (req: AuthRequest, res) => {
  const meeting = await getMeeting(req, String(req.params.id));
  await canManage(req, meeting);
  assertMeetingMutable(meeting);
  const data = meetingBaseInput.omit({ participants: true, audiences: true, agenda: true, hostUserId: true }).partial().parse(req.body);
  if (req.auth!.role === Role.BRANCH_ADMIN && data.branchId === null) throw new AppError(403, "MEETING_BRANCH_REQUIRED", "Branch administrators cannot convert a branch meeting to organization-wide scope");
  if (!managementRoles.has(req.auth!.role) && (data.branchId !== undefined || data.departmentId !== undefined)) throw new AppError(403, "MEETING_SCOPE_CHANGE_FORBIDDEN", "Only management can change meeting branch or department scope");
  const startsAt = data.startsAt ?? meeting.startsAt;
  const endsAt = data.endsAt ?? meeting.endsAt;
  if (endsAt <= startsAt) throw new AppError(422, "MEETING_TIME_INVALID", "End time must follow start time");
  if (managementRoles.has(req.auth!.role)) await validateScope(req, data.branchId === undefined ? meeting.branchId : data.branchId, data.departmentId === undefined ? meeting.departmentId : data.departmentId);
  const updated = await prisma.$transaction(async tx => {
    const row = await tx.meeting.update({ where: { id: meeting.id }, data });
    if (meeting.calendarEventId) await tx.calendarEvent.updateMany({
      where: { organizationId: org(req), id: meeting.calendarEventId },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.branchId !== undefined ? { branchId: data.branchId } : {}),
        ...(data.startsAt !== undefined ? { startsAt: data.startsAt } : {}),
        ...(data.endsAt !== undefined ? { endsAt: data.endsAt } : {}),
      },
    });
    return row;
  });
  if (data.startsAt || data.endsAt || data.timezone || data.title) {
    await invalidateFutureMeetingNotifications(org(req), meeting.id);
    const participants = await prisma.meetingParticipant.findMany({ where: { organizationId: org(req), meetingId: meeting.id, removedAt: null }, select: { id: true, userId: true } });
    await scheduleMeetingNotifications({
      organizationId: org(req), meetingId: meeting.id, title: updated.title, startsAt: updated.startsAt,
      timezone: updated.timezone, participants, invitation: false,
    });
  }
  await audit(req, meeting.id, "UPDATE", "Meeting", meeting.id);
  res.json({ data: updated });
});

router.post("/meetings/:id/cancel", async (req: AuthRequest, res) => {
  const meeting = await getMeeting(req, String(req.params.id));
  await canManage(req, meeting);
  if (!cancellableMeetingStatuses.has(meeting.status)) throw new AppError(409, "MEETING_CANCEL_REQUIRES_END", "Once the meeting room is open, end the meeting instead of cancelling it");
  await invalidateFutureMeetingNotifications(org(req), meeting.id);
  const data = await prisma.$transaction(async tx => {
    const row = await tx.meeting.update({ where: { id: meeting.id }, data: { status: MeetingStatus.CANCELLED, cancelledAt: new Date() } });
    if (meeting.calendarEventId) await tx.calendarEvent.updateMany({ where: { organizationId: org(req), id: meeting.calendarEventId }, data: { status: "CANCELLED" } });
    return row;
  });
  await audit(req, meeting.id, "CANCEL", "Meeting", meeting.id);
  res.json({ data });
});

router.post("/meetings/:id/respond", async (req: AuthRequest, res) => {
  const meeting = await getMeeting(req, String(req.params.id));
  const participant = meeting.participants.find(p => p.userId === actor(req));
  if (!participant) throw new AppError(403, "MEETING_INVITE_REQUIRED", "You are not invited to this meeting");
  if (!respondableMeetingStatuses.has(meeting.status)) throw new AppError(409, "MEETING_RESPONSE_CLOSED", "Responses are closed for this meeting");
  const response = z.nativeEnum(MeetingResponseStatus).refine(value => value !== MeetingResponseStatus.PENDING).parse(req.body.response);
  const now = new Date();
  const row = await prisma.$transaction(async tx => {
    const updated = await tx.meetingParticipant.update({ where: { id: participant.id }, data: {
      responseStatus: response,
      acceptedAt: response === MeetingResponseStatus.ACCEPTED ? now : null,
      declinedAt: response === MeetingResponseStatus.DECLINED ? now : null,
    }});
    if (meeting.calendarEventId) await tx.calendarEventRsvp.upsert({
      where: { eventId_userId: { eventId: meeting.calendarEventId, userId: actor(req) } },
      create: { organizationId: org(req), eventId: meeting.calendarEventId, userId: actor(req), response },
      update: { response, respondedAt: now },
    });
    return updated;
  });
  await audit(req, meeting.id, "RESPOND", "MeetingParticipant", participant.id, { response });
  res.json({ data: row });
});

router.post("/meetings/:id/participants", async (req: AuthRequest, res) => {
  const meeting = await getMeeting(req, String(req.params.id));
  await canManage(req, meeting);
  assertMeetingMutable(meeting);
  const data = participantInput.parse(req.body);
  const scope = await allowedBranches(req);
  const participants = await resolveMeetingParticipants({
    organizationId: org(req), hostUserId: meeting.hostUserId, meetingBranchId: meeting.branchId,
    explicit: [data], audiences: [], allowedBranchIds: scope,
  });
  const resolved = participants.find(p => p.userId === data.userId)!;
  const row = await prisma.meetingParticipant.upsert({
    where: { meetingId_userId: { meetingId: meeting.id, userId: data.userId } },
    create: { organizationId: org(req), meetingId: meeting.id, userId: data.userId, participantKind: resolved.participantKind, meetingRole: data.meetingRole, addedById: actor(req) },
    update: { participantKind: resolved.participantKind, meetingRole: data.meetingRole, removedAt: null },
  });
  await scheduleMeetingNotifications({
    organizationId: org(req), meetingId: meeting.id, title: meeting.title, startsAt: meeting.startsAt, timezone: meeting.timezone,
    participants: [{ id: row.id, userId: row.userId }], invitation: true,
  });
  await audit(req, meeting.id, "ADD_PARTICIPANT", "MeetingParticipant", row.id, { userId: row.userId });
  res.status(201).json({ data: row });
});

router.delete("/meetings/:id/participants/:participantId", async (req: AuthRequest, res) => {
  const meeting = await getMeeting(req, String(req.params.id));
  await canManage(req, meeting);
  assertMeetingMutable(meeting);
  const participant = meeting.participants.find(p => p.id === String(req.params.participantId));
  if (!participant) throw new AppError(404, "MEETING_PARTICIPANT_NOT_FOUND", "Participant not found");
  if (participant.meetingRole === MeetingParticipantRole.HOST) throw new AppError(409, "MEETING_HOST_REQUIRED", "Transfer host before removing the host");
  await prisma.meetingParticipant.update({ where: { id: participant.id }, data: { removedAt: new Date() } });
  await audit(req, meeting.id, "REMOVE_PARTICIPANT", "MeetingParticipant", participant.id, { userId: participant.userId });
  res.status(204).send();
});

router.post("/meetings/:id/agenda", async (req: AuthRequest, res) => {
  const meeting = await getMeeting(req, String(req.params.id));
  await canManage(req, meeting);
  assertMeetingMutable(meeting);
  const data = agendaInput.parse(req.body);
  if (data.presenterUserId && !meeting.participants.some(p => p.userId === data.presenterUserId)) throw new AppError(422, "MEETING_PRESENTER_NOT_PARTICIPANT", "Presenter must be a meeting participant");
  const row = await prisma.meetingAgendaItem.create({ data: { ...data, organizationId: org(req), meetingId: meeting.id } });
  await audit(req, meeting.id, "ADD_AGENDA", "MeetingAgendaItem", row.id);
  res.status(201).json({ data: row });
});

router.patch("/meetings/:id/agenda/:agendaId", async (req: AuthRequest, res) => {
  const meeting = await getMeeting(req, String(req.params.id));
  await canManage(req, meeting);
  assertMeetingMutable(meeting);
  const agenda = meeting.agendaItems.find(x => x.id === String(req.params.agendaId));
  if (!agenda) throw new AppError(404, "MEETING_AGENDA_NOT_FOUND", "Agenda item not found");
  const data = agendaInput.partial().parse(req.body);
  if (data.presenterUserId && !meeting.participants.some(p => p.userId === data.presenterUserId)) throw new AppError(422, "MEETING_PRESENTER_NOT_PARTICIPANT", "Presenter must be a meeting participant");
  const row = await prisma.meetingAgendaItem.update({ where: { id: agenda.id }, data });
  await audit(req, meeting.id, "UPDATE_AGENDA", "MeetingAgendaItem", row.id);
  res.json({ data: row });
});

export default router;
