import {
  MeetingActionPriority,
  MeetingActionStatus,
  MeetingAgendaStatus,
  MeetingAttendanceStatus,
  MeetingAudienceType,
  MeetingCalendarProvider,
  MeetingInvitationStatus,
  MeetingMinutesStatus,
  MeetingParticipantRole,
  MeetingParticipantType,
  MeetingRecordingStatus,
  MeetingResponseStatus,
  MeetingStatus,
  MeetingSyncStatus,
  MeetingType,
  MeetingVisibility,
  Role,
} from "@prisma/client";
import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config.js";
import { AppError } from "../lib/http.js";
import {
  createLiveKitToken,
  getLiveKitRecordingObject,
  livekitClientUrl,
  livekitEgress,
  livekitRecordingConfigured,
  livekitRecordingStorage,
  livekitRoomService,
} from "../lib/livekit.js";
import { prisma } from "../lib/prisma.js";
import { assertFeatureEntitled } from "../lib/saas-commercial.js";
import {
  allowedDocumentTypes,
  assertDocumentFileExtension,
  decodeVerifiedUpload,
  type AllowedDocumentType,
} from "../lib/secure-upload.js";
import { storedDocumentBuffer, storedDocumentHeaders } from "../lib/secure-download.js";
import { allow, requireAuth, type AuthRequest } from "../middleware/auth.js";
import { requireCommercialFeature } from "../middleware/commercial-entitlement.js";

const router = Router();
router.use(
  requireAuth,
  allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN, Role.ACCOUNTANT, Role.TEACHER, Role.EMPLOYEE),
  requireCommercialFeature("meetings"),
);

const id = z.string().cuid();
const staffRoles = [Role.SUPER_ADMIN, Role.BRANCH_ADMIN, Role.ACCOUNTANT, Role.TEACHER, Role.EMPLOYEE] as const;
const staffRoleSet = new Set<Role>(staffRoles);
const managerRoleSet = new Set<Role>([Role.SUPER_ADMIN, Role.BRANCH_ADMIN]);
const meetingManagerRoles = new Set<MeetingParticipantRole>([MeetingParticipantRole.HOST, MeetingParticipantRole.CO_HOST]);

type ActorScope = {
  userId: string;
  role: Role;
  organizationId: string;
  branchIds: string[] | null;
  departmentIds: string[];
};

const organizationId = (req: AuthRequest) => req.auth!.organizationId;

async function actorScope(req: AuthRequest): Promise<ActorScope> {
  const auth = req.auth!;
  if (auth.role === Role.SUPER_ADMIN) {
    return { userId: auth.userId, role: auth.role, organizationId: auth.organizationId, branchIds: null, departmentIds: [] };
  }
  if (auth.role === Role.BRANCH_ADMIN || auth.role === Role.ACCOUNTANT) {
    const assignments = await prisma.branchUser.findMany({
      where: { organizationId: auth.organizationId, userId: auth.userId, branch: { organizationId: auth.organizationId, isActive: true } },
      select: { branchId: true },
    });
    return { userId: auth.userId, role: auth.role, organizationId: auth.organizationId, branchIds: [...new Set(assignments.map(x => x.branchId))], departmentIds: [] };
  }
  if (auth.role === Role.EMPLOYEE) {
    const employee = await prisma.employee.findFirst({
      where: { organizationId: auth.organizationId, userId: auth.userId, status: "ACTIVE" },
      select: { branchId: true, departmentId: true },
    });
    return {
      userId: auth.userId,
      role: auth.role,
      organizationId: auth.organizationId,
      branchIds: employee ? [employee.branchId] : [],
      departmentIds: employee ? [employee.departmentId] : [],
    };
  }
  if (auth.role === Role.TEACHER) {
    const teacher = await prisma.teacherProfile.findFirst({
      where: { organizationId: auth.organizationId, userId: auth.userId },
      select: { branchId: true },
    });
    return { userId: auth.userId, role: auth.role, organizationId: auth.organizationId, branchIds: teacher ? [teacher.branchId] : [], departmentIds: [] };
  }
  throw new AppError(403, "MEETING_ACCESS_DENIED", "Staff meeting access is required");
}

function visibleMeetingWhere(scope: ActorScope) {
  if (scope.role === Role.SUPER_ADMIN) return {};
  const or: any[] = [
    { hostUserId: scope.userId },
    { participants: { some: { userId: scope.userId, removedAt: null } } },
    { visibility: MeetingVisibility.ORGANIZATION },
  ];
  if (scope.branchIds?.length) or.push({ visibility: MeetingVisibility.BRANCH, branchId: { in: scope.branchIds } });
  if (scope.departmentIds.length) or.push({ visibility: MeetingVisibility.DEPARTMENT, departmentId: { in: scope.departmentIds } });
  return { OR: or };
}

async function assertScopeTarget(scope: ActorScope, branchId?: string | null, departmentId?: string | null) {
  if (branchId) {
    const branch = await prisma.branch.findFirst({ where: { organizationId: scope.organizationId, id: branchId, isActive: true }, select: { id: true } });
    if (!branch) throw new AppError(422, "MEETING_BRANCH_INVALID", "Meeting branch is unavailable");
    if (scope.branchIds && !scope.branchIds.includes(branchId)) throw new AppError(403, "MEETING_BRANCH_FORBIDDEN", "You cannot create or manage meetings for this branch");
  } else if (scope.role !== Role.SUPER_ADMIN) {
    throw new AppError(422, "MEETING_BRANCH_REQUIRED", "Non-organization administrators must select a branch");
  }
  if (departmentId) {
    const department = await prisma.department.findFirst({ where: { organizationId: scope.organizationId, id: departmentId, isArchived: false }, select: { id: true } });
    if (!department) throw new AppError(422, "MEETING_DEPARTMENT_INVALID", "Meeting department is unavailable");
    if (scope.role === Role.EMPLOYEE && scope.departmentIds.length && !scope.departmentIds.includes(departmentId)) {
      throw new AppError(403, "MEETING_DEPARTMENT_FORBIDDEN", "You cannot create or manage meetings for this department");
    }
  }
}

function assertVisibilityScope(scope: ActorScope, visibility: MeetingVisibility, branchId?: string | null, departmentId?: string | null) {
  if (visibility === MeetingVisibility.ORGANIZATION && scope.role !== Role.SUPER_ADMIN) {
    throw new AppError(403, "MEETING_ORGANIZATION_VISIBILITY_DENIED", "Organization-wide meeting visibility requires organization administrator access");
  }
  if (visibility === MeetingVisibility.BRANCH && !branchId) {
    throw new AppError(422, "MEETING_VISIBILITY_BRANCH_REQUIRED", "Branch-visible meetings require a branch");
  }
  if (visibility === MeetingVisibility.DEPARTMENT && !departmentId) {
    throw new AppError(422, "MEETING_VISIBILITY_DEPARTMENT_REQUIRED", "Department-visible meetings require a department");
  }
}


async function meetingForActor(req: AuthRequest, meetingId: string) {
  const scope = await actorScope(req);
  const meeting = await prisma.meeting.findFirst({
    where: { id: meetingId, ...visibleMeetingWhere(scope) },
    include: {
      participants: true,
      audiences: true,
      agendaItems: { orderBy: { sequence: "asc" } },
      minutes: true,
      decisions: { orderBy: { createdAt: "asc" } },
      actionItems: { orderBy: [{ status: "asc" }, { dueAt: "asc" }] },
      recordings: { orderBy: { createdAt: "desc" } },
      attachments: { select: { id: true, agendaItemId: true, name: true, mimeType: true, size: true, visibility: true, uploadedById: true, createdAt: true } },
    },
  });
  if (!meeting) throw new AppError(404, "MEETING_NOT_FOUND", "Meeting not found");
  return { meeting, scope };
}

function canManageMeeting(scope: ActorScope, meeting: { branchId: string | null; hostUserId: string; participants: Array<{ userId: string; meetingRole: MeetingParticipantRole; removedAt: Date | null }> }) {
  if (scope.role === Role.SUPER_ADMIN) return true;
  if (scope.role === Role.BRANCH_ADMIN && meeting.branchId && scope.branchIds?.includes(meeting.branchId)) return true;
  if (meeting.hostUserId === scope.userId) return true;
  return meeting.participants.some(p => p.userId === scope.userId && !p.removedAt && meetingManagerRoles.has(p.meetingRole));
}

function requireMeetingManager(scope: ActorScope, meeting: Parameters<typeof canManageMeeting>[1]) {
  if (!canManageMeeting(scope, meeting)) throw new AppError(403, "MEETING_MANAGE_DENIED", "Host, co-host or scoped administrator access is required");
}

function audit(req: AuthRequest, meetingId: string, action: string, entityType = "Meeting", entityId?: string, metadata?: unknown) {
  return prisma.meetingAuditLog.create({
    data: {
      organizationId: organizationId(req),
      meetingId,
      actorUserId: req.auth!.userId,
      action,
      entityType,
      entityId,
      metadata: metadata as any,
      ipAddress: req.ip,
      userAgent: req.get("user-agent")?.slice(0, 500),
    },
  });
}

function staffParticipantType(user: { role: Role; employee: { id: string } | null; teacherProfile: { id: string } | null }) {
  if (user.teacherProfile || user.role === Role.TEACHER) return MeetingParticipantType.TEACHER;
  if (user.employee || user.role === Role.EMPLOYEE) return MeetingParticipantType.EMPLOYEE;
  if (user.role === Role.SUPER_ADMIN || user.role === Role.BRANCH_ADMIN || user.role === Role.ACCOUNTANT) return MeetingParticipantType.MANAGEMENT;
  throw new AppError(422, "MEETING_PARTICIPANT_INVALID", "Students and parents cannot be staff-meeting participants");
}

async function eligibleUsers(req: AuthRequest, userIds: string[]) {
  const uniqueIds = [...new Set(userIds)];
  if (!uniqueIds.length) return [];
  const users = await prisma.user.findMany({
    where: { organizationId: organizationId(req), id: { in: uniqueIds }, isActive: true },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      employee: { select: { id: true, branchId: true, departmentId: true } },
      teacherProfile: { select: { id: true, branchId: true } },
      branchAssignments: { select: { branchId: true } },
    },
  });
  if (users.length !== uniqueIds.length) throw new AppError(422, "MEETING_PARTICIPANT_INVALID", "One or more participants are inactive or outside this organization");
  for (const user of users) if (!staffRoleSet.has(user.role)) staffParticipantType(user);
  return users;
}

async function assertParticipantScope(scope: ActorScope, users: Awaited<ReturnType<typeof eligibleUsers>>) {
  if (scope.role === Role.SUPER_ADMIN) return;
  const allowed = new Set(scope.branchIds ?? []);
  for (const user of users) {
    const branches = new Set([
      ...user.branchAssignments.map(x => x.branchId),
      ...(user.employee ? [user.employee.branchId] : []),
      ...(user.teacherProfile ? [user.teacherProfile.branchId] : []),
    ]);
    if (!branches.size || ![...branches].some(branch => allowed.has(branch))) {
      throw new AppError(403, "MEETING_PARTICIPANT_SCOPE", "A participant is outside your permitted branch scope");
    }
  }
}

const audienceInput = z.object({
  type: z.nativeEnum(MeetingAudienceType),
  branchId: id.nullable().optional(),
  departmentId: id.nullable().optional(),
  teamKey: z.string().trim().min(1).max(100).nullable().optional(),
  role: z.nativeEnum(Role).nullable().optional(),
});

async function audienceUsers(req: AuthRequest, scope: ActorScope, audiences: z.infer<typeof audienceInput>[]) {
  const ids = new Set<string>();
  for (const audience of audiences) {
    if (audience.type === MeetingAudienceType.ORGANIZATION) {
      if (scope.role !== Role.SUPER_ADMIN) throw new AppError(403, "MEETING_ORG_AUDIENCE_FORBIDDEN", "Organization-wide meetings require organization administrator access");
      const users = await prisma.user.findMany({ where: { organizationId: scope.organizationId, isActive: true, role: { in: [...staffRoles] } }, select: { id: true } });
      users.forEach(user => ids.add(user.id));
    } else if (audience.type === MeetingAudienceType.BRANCH) {
      if (!audience.branchId) throw new AppError(422, "MEETING_AUDIENCE_BRANCH_REQUIRED", "Branch audience requires branchId");
      await assertScopeTarget(scope, audience.branchId, null);
      const users = await prisma.user.findMany({
        where: {
          organizationId: scope.organizationId,
          isActive: true,
          role: { in: [...staffRoles] },
          OR: [
            { branchAssignments: { some: { branchId: audience.branchId } } },
            { employee: { branchId: audience.branchId } },
            { teacherProfile: { branchId: audience.branchId } },
          ],
        },
        select: { id: true },
      });
      users.forEach(user => ids.add(user.id));
    } else if (audience.type === MeetingAudienceType.DEPARTMENT) {
      if (!audience.departmentId) throw new AppError(422, "MEETING_AUDIENCE_DEPARTMENT_REQUIRED", "Department audience requires departmentId");
      await assertScopeTarget(scope, audience.branchId ?? null, audience.departmentId);
      const employees = await prisma.employee.findMany({
        where: { organizationId: scope.organizationId, departmentId: audience.departmentId, status: "ACTIVE", ...(audience.branchId ? { branchId: audience.branchId } : {}) },
        select: { userId: true },
      });
      employees.forEach(employee => ids.add(employee.userId));
    } else if (audience.type === MeetingAudienceType.ROLE) {
      if (!audience.role || !staffRoleSet.has(audience.role)) throw new AppError(422, "MEETING_AUDIENCE_ROLE_INVALID", "Role audience must be a staff role");
      const users = await prisma.user.findMany({ where: { organizationId: scope.organizationId, role: audience.role, isActive: true }, select: { id: true } });
      users.forEach(user => ids.add(user.id));
    }
  }
  return [...ids];
}

async function queueNotification(req: AuthRequest, userId: string, title: string, body: string, meetingId: string, scheduledAt?: Date) {
  const notification = await prisma.notification.create({
    data: {
      organizationId: organizationId(req),
      userId,
      title,
      body,
      category: "MEETINGS",
      sourceModule: "MEETINGS",
      sourceEntityId: meetingId,
      actionUrl: "/admin/meetings/" + meetingId,
      priority: "NORMAL",
      channels: ["IN_APP", "EMAIL"],
      scheduledAt,
    },
  });
  await prisma.notificationDelivery.create({
    data: { organizationId: organizationId(req), notificationId: notification.id, channel: "EMAIL", status: "QUEUED" },
  });
  return notification;
}

async function scheduleMeetingNotifications(req: AuthRequest, meeting: { id: string; title: string; startsAt: Date }, participantIds: string[]) {
  const now = Date.now();
  for (const userId of participantIds) {
    await queueNotification(req, userId, "Meeting invitation: " + meeting.title, "You have been invited to a staff/management meeting.", meeting.id);
    for (const minutes of [1440, 60, 10]) {
      const at = new Date(meeting.startsAt.getTime() - minutes * 60_000);
      if (at.getTime() > now) {
        await queueNotification(req, userId, "Meeting reminder: " + meeting.title, "Meeting starts in " + (minutes >= 60 ? Math.round(minutes / 60) + " hour(s)" : minutes + " minutes") + ".", meeting.id, at);
      }
    }
  }
}

async function syncInternalCalendar(req: AuthRequest, meeting: { id: string; branchId: string | null; title: string; description: string | null; startsAt: Date; endsAt: Date }, participantIds: string[]) {
  const event = await prisma.calendarEvent.create({
    data: {
      organizationId: organizationId(req),
      branchId: meeting.branchId,
      title: meeting.title,
      description: meeting.description,
      type: "MEETING",
      startsAt: meeting.startsAt,
      endsAt: meeting.endsAt,
      location: "Online",
      reminders: [1440, 60, 10],
      status: "SCHEDULED",
    },
  });
  if (participantIds.length) {
    await prisma.meetingCalendarLink.createMany({
      data: participantIds.map(userId => ({
        organizationId: organizationId(req),
        meetingId: meeting.id,
        userId,
        provider: MeetingCalendarProvider.INTERNAL,
        externalEventId: event.id,
        syncStatus: MeetingSyncStatus.SYNCED,
        lastSyncedAt: new Date(),
      })),
      skipDuplicates: true,
    });
  }
  return event.id;
}

const meetingShape = z.object({
  title: z.string().trim().min(3).max(180),
  description: z.string().trim().max(10000).nullable().optional(),
  type: z.nativeEnum(MeetingType).default(MeetingType.GENERAL),
  branchId: id.nullable().optional(),
  departmentId: id.nullable().optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  timezone: z.string().trim().min(3).max(100),
  status: z.nativeEnum(MeetingStatus).default(MeetingStatus.SCHEDULED),
  visibility: z.nativeEnum(MeetingVisibility).default(MeetingVisibility.INVITE_ONLY),
  hostUserId: id.optional(),
  participantUserIds: z.array(id).max(1000).default([]),
  coHostUserIds: z.array(id).max(50).default([]),
  presenterUserIds: z.array(id).max(100).default([]),
  audiences: z.array(audienceInput).max(50).default([]),
  agenda: z.array(z.object({
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().max(5000).nullable().optional(),
    presenterUserId: id.nullable().optional(),
    plannedMinutes: z.number().int().positive().max(1440).nullable().optional(),
  })).max(100).default([]),
  recurrenceRule: z.string().trim().min(5).max(500).nullable().optional(),
  recurrenceEnd: z.coerce.date().nullable().optional(),
  allowRecording: z.boolean().default(false),
  recordingRequired: z.boolean().default(false),
  allowChat: z.boolean().default(true),
  allowWhiteboard: z.boolean().default(true),
  allowAnnotation: z.boolean().default(true),
  allowScreenShare: z.boolean().default(true),
  allowParticipantMic: z.boolean().default(true),
  allowParticipantCamera: z.boolean().default(true),
  joinBeforeMinutes: z.number().int().min(0).max(240).default(15),
  lockAfterStart: z.boolean().default(false),
});
const meetingInput = meetingShape.superRefine((value, ctx) => {
  if (value.endsAt <= value.startsAt) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "Meeting end time must be after start time" });
  try { new Intl.DateTimeFormat("en", { timeZone: value.timezone }).format(new Date()); } catch { ctx.addIssue({ code: "custom", path: ["timezone"], message: "Invalid IANA timezone" }); }
  if (value.recordingRequired && !value.allowRecording) ctx.addIssue({ code: "custom", path: ["recordingRequired"], message: "Required recording needs allowRecording enabled" });
});

router.get("/meetings/options", async (req: AuthRequest, res) => {
  const scope = await actorScope(req);
  const branchWhere = scope.branchIds ? { id: { in: scope.branchIds } } : {};
  const branches = await prisma.branch.findMany({
    where: { organizationId: scope.organizationId, isActive: true, ...branchWhere },
    select: { id: true, branchName: true, branchCode: true },
    orderBy: { branchName: "asc" },
  });
  const departments = await prisma.department.findMany({
    where: {
      organizationId: scope.organizationId,
      isArchived: false,
      ...(scope.role === Role.EMPLOYEE && scope.departmentIds.length ? { id: { in: scope.departmentIds } } : {}),
    },
    select: { id: true, name: true, code: true },
    orderBy: { name: "asc" },
  });
  const candidateUsers = await prisma.user.findMany({
    where: { organizationId: scope.organizationId, isActive: true, role: { in: [...staffRoles] } },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      employee: { select: { branchId: true, departmentId: true } },
      teacherProfile: { select: { branchId: true } },
      branchAssignments: { select: { branchId: true } },
    },
    orderBy: { name: "asc" },
  });
  const allowedBranches = scope.branchIds ? new Set(scope.branchIds) : null;
  const users = candidateUsers.filter(user => {
    if (!allowedBranches) return true;
    const ids = [
      ...user.branchAssignments.map(item => item.branchId),
      ...(user.employee ? [user.employee.branchId] : []),
      ...(user.teacherProfile ? [user.teacherProfile.branchId] : []),
    ];
    return ids.some(branchId => allowedBranches.has(branchId));
  }).map(user => ({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    branchIds: [...new Set([
      ...user.branchAssignments.map(item => item.branchId),
      ...(user.employee ? [user.employee.branchId] : []),
      ...(user.teacherProfile ? [user.teacherProfile.branchId] : []),
    ])],
    departmentId: user.employee?.departmentId ?? null,
  }));
  res.json({
    data: {
      branches,
      departments,
      users,
      canCreate: [Role.SUPER_ADMIN, Role.BRANCH_ADMIN, Role.TEACHER, Role.EMPLOYEE].includes(scope.role),
      canOrganizationWide: scope.role === Role.SUPER_ADMIN,
    },
  });
});

router.get("/meetings/dashboard", async (req: AuthRequest, res) => {
  const scope = await actorScope(req);
  const where = visibleMeetingWhere(scope);
  const now = new Date();
  const [today, upcoming, live, pendingMinutes, myActions, overdueActions] = await Promise.all([
    prisma.meeting.count({ where: { ...where, startsAt: { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()), lt: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) }, status: { not: MeetingStatus.CANCELLED } } }),
    prisma.meeting.count({ where: { ...where, startsAt: { gt: now }, status: { in: [MeetingStatus.SCHEDULED, MeetingStatus.OPEN_FOR_JOIN] } } }),
    prisma.meeting.count({ where: { ...where, status: MeetingStatus.LIVE } }),
    prisma.meeting.count({ where: { ...where, status: { in: [MeetingStatus.ENDED, MeetingStatus.MINUTES_PENDING] } } }),
    prisma.meetingActionItem.count({ where: { assigneeUserId: scope.userId, status: { in: [MeetingActionStatus.OPEN, MeetingActionStatus.IN_PROGRESS, MeetingActionStatus.BLOCKED] } } }),
    prisma.meetingActionItem.count({ where: { assigneeUserId: scope.userId, dueAt: { lt: now }, status: { in: [MeetingActionStatus.OPEN, MeetingActionStatus.IN_PROGRESS, MeetingActionStatus.BLOCKED] } } }),
  ]);
  res.json({ data: { today, upcoming, live, pendingMinutes, myActions, overdueActions } });
});

router.get("/meetings", async (req: AuthRequest, res) => {
  const scope = await actorScope(req);
  const q = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.nativeEnum(MeetingStatus).optional(),
    type: z.nativeEnum(MeetingType).optional(),
    branchId: id.optional(),
    departmentId: id.optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    search: z.string().trim().max(120).optional(),
  }).parse(req.query);
  const where: any = {
    AND: [
      visibleMeetingWhere(scope),
      {
        ...(q.status ? { status: q.status } : {}),
        ...(q.type ? { type: q.type } : {}),
        ...(q.branchId ? { branchId: q.branchId } : {}),
        ...(q.departmentId ? { departmentId: q.departmentId } : {}),
        ...(q.from || q.to ? { startsAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
      },
      ...(q.search ? [{ OR: [{ title: { contains: q.search, mode: "insensitive" } }, { description: { contains: q.search, mode: "insensitive" } }] }] : []),
    ],
  };
  const [data, total] = await Promise.all([
    prisma.meeting.findMany({
      where,
      include: { _count: { select: { participants: true, actionItems: true, recordings: true } }, participants: { where: { userId: scope.userId }, select: { meetingRole: true, responseStatus: true } } },
      orderBy: { startsAt: "asc" },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
    prisma.meeting.count({ where }),
  ]);
  res.json({ data, meta: { total, page: q.page, limit: q.limit, totalPages: Math.max(1, Math.ceil(total / q.limit)) } });
});

router.post("/meetings", async (req: AuthRequest, res) => {
  const scope = await actorScope(req);
  if (![Role.SUPER_ADMIN, Role.BRANCH_ADMIN, Role.TEACHER, Role.EMPLOYEE].includes(scope.role)) {
    throw new AppError(403, "MEETING_CREATE_DENIED", "Your role cannot create staff meetings");
  }
  const data = meetingInput.parse(req.body);
  await assertScopeTarget(scope, data.branchId ?? null, data.departmentId ?? null);
  assertVisibilityScope(scope, data.visibility, data.branchId ?? null, data.departmentId ?? null);
  const hostUserId = data.hostUserId ?? scope.userId;
  const expanded = await audienceUsers(req, scope, data.audiences);
  const allUserIds = [...new Set([hostUserId, ...data.participantUserIds, ...data.coHostUserIds, ...data.presenterUserIds, ...expanded])];
  const users = await eligibleUsers(req, allUserIds);
  await assertParticipantScope(scope, users);
  const host = users.find(user => user.id === hostUserId);
  if (!host) throw new AppError(422, "MEETING_HOST_INVALID", "Host must be an active staff user");
  const now = new Date();
  const result = await prisma.$transaction(async tx => {
    const series = data.recurrenceRule ? await tx.meetingSeries.create({
      data: {
        organizationId: scope.organizationId,
        title: data.title,
        branchId: data.branchId ?? null,
        departmentId: data.departmentId ?? null,
        timezone: data.timezone,
        recurrenceRule: data.recurrenceRule,
        recurrenceStart: data.startsAt,
        recurrenceEnd: data.recurrenceEnd ?? null,
        createdById: scope.userId,
      },
    }) : null;
    const meeting = await tx.meeting.create({
      data: {
        organizationId: scope.organizationId,
        seriesId: series?.id,
        title: data.title,
        description: data.description ?? null,
        type: data.type,
        branchId: data.branchId ?? null,
        departmentId: data.departmentId ?? null,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        timezone: data.timezone,
        status: data.status,
        visibility: data.visibility,
        hostUserId,
        allowRecording: data.allowRecording,
        recordingRequired: data.recordingRequired,
        allowChat: data.allowChat,
        allowWhiteboard: data.allowWhiteboard,
        allowAnnotation: data.allowAnnotation,
        allowScreenShare: data.allowScreenShare,
        allowParticipantMic: data.allowParticipantMic,
        allowParticipantCamera: data.allowParticipantCamera,
        joinBeforeMinutes: data.joinBeforeMinutes,
        lockAfterStart: data.lockAfterStart,
        createdById: scope.userId,
      },
    });
    if (data.audiences.length) {
      await tx.meetingAudience.createMany({
        data: data.audiences.map(audience => ({
          organizationId: scope.organizationId,
          meetingId: meeting.id,
          type: audience.type,
          branchId: audience.branchId ?? null,
          departmentId: audience.departmentId ?? null,
          teamKey: audience.teamKey ?? null,
          role: audience.role ?? null,
        })),
      });
    }
    const participantRows = users.map(user => {
      const role = user.id === hostUserId
        ? MeetingParticipantRole.HOST
        : data.coHostUserIds.includes(user.id)
          ? MeetingParticipantRole.CO_HOST
          : data.presenterUserIds.includes(user.id)
            ? MeetingParticipantRole.PRESENTER
            : MeetingParticipantRole.PARTICIPANT;
      return {
        organizationId: scope.organizationId,
        meetingId: meeting.id,
        userId: user.id,
        participantType: staffParticipantType(user),
        meetingRole: role,
        invitationStatus: MeetingInvitationStatus.SENT,
        responseStatus: user.id === hostUserId ? MeetingResponseStatus.ACCEPTED : MeetingResponseStatus.PENDING,
        addedById: scope.userId,
        invitedAt: now,
        acceptedAt: user.id === hostUserId ? now : null,
      };
    });
    await tx.meetingParticipant.createMany({ data: participantRows });
    const participants = await tx.meetingParticipant.findMany({ where: { meetingId: meeting.id }, select: { id: true, userId: true } });
    if (participants.length) {
      await tx.meetingAttendance.createMany({
        data: participants.map(participant => ({ organizationId: scope.organizationId, meetingId: meeting.id, participantId: participant.id })),
      });
      await tx.meetingInvite.createMany({
        data: participants.filter(p => p.userId !== hostUserId).flatMap(participant => ["IN_APP", "EMAIL"].map(channel => ({
          organizationId: scope.organizationId,
          meetingId: meeting.id,
          participantId: participant.id,
          channel,
          status: MeetingInvitationStatus.SENT,
          sentAt: now,
        }))),
      });
    }
    if (data.agenda.length) {
      await tx.meetingAgendaItem.createMany({
        data: data.agenda.map((item, index) => ({
          organizationId: scope.organizationId,
          meetingId: meeting.id,
          title: item.title,
          description: item.description ?? null,
          sequence: index + 1,
          presenterUserId: item.presenterUserId ?? null,
          plannedMinutes: item.plannedMinutes ?? null,
        })),
      });
    }
    return meeting;
  });
  await scheduleMeetingNotifications(req, result, allUserIds.filter(userId => userId !== scope.userId));
  await syncInternalCalendar(req, result, allUserIds);
  await audit(req, result.id, "CREATE", "Meeting", result.id, { participantCount: allUserIds.length, recurring: Boolean(data.recurrenceRule) });
  res.status(201).json({ data: await prisma.meeting.findUnique({ where: { id: result.id }, include: { participants: true, audiences: true, agendaItems: { orderBy: { sequence: "asc" } } } }) });
});

router.get("/meetings/:id", async (req: AuthRequest, res) => {
  const { meeting } = await meetingForActor(req, String(req.params.id));
  const userIds = [...new Set([
    meeting.hostUserId,
    ...meeting.participants.map(participant => participant.userId),
    ...meeting.actionItems.map(action => action.assigneeUserId),
  ])];
  const users = await prisma.user.findMany({
    where: { organizationId: organizationId(req), id: { in: userIds } },
    select: { id: true, name: true, email: true, role: true },
  });
  const directory = new Map(users.map(user => [user.id, user]));
  res.json({
    data: {
      ...meeting,
      host: directory.get(meeting.hostUserId) ?? null,
      participants: meeting.participants.map(participant => ({ ...participant, user: directory.get(participant.userId) ?? null })),
      actionItems: meeting.actionItems.map(action => ({ ...action, assignee: directory.get(action.assigneeUserId) ?? null })),
    },
  });
});

router.patch("/meetings/:id", async (req: AuthRequest, res) => {
  const { meeting, scope } = await meetingForActor(req, String(req.params.id));
  requireMeetingManager(scope, meeting);
  if ([MeetingStatus.CANCELLED, MeetingStatus.CLOSED].includes(meeting.status)) throw new AppError(409, "MEETING_IMMUTABLE", "Cancelled or closed meetings cannot be edited");
  const patch = meetingShape.partial().omit({ participantUserIds: true, coHostUserIds: true, presenterUserIds: true, audiences: true, agenda: true, recurrenceRule: true, recurrenceEnd: true }).parse(req.body);
  const finalBranchId = patch.branchId === undefined ? meeting.branchId : patch.branchId;
  const finalDepartmentId = patch.departmentId === undefined ? meeting.departmentId : patch.departmentId;
  const finalVisibility = patch.visibility ?? meeting.visibility;
  await assertScopeTarget(scope, finalBranchId, finalDepartmentId);
  assertVisibilityScope(scope, finalVisibility, finalBranchId, finalDepartmentId);
  if (patch.endsAt && patch.startsAt && patch.endsAt <= patch.startsAt) throw new AppError(422, "MEETING_TIME_INVALID", "Meeting end time must be after start time");
  if (patch.endsAt && !patch.startsAt && patch.endsAt <= meeting.startsAt) throw new AppError(422, "MEETING_TIME_INVALID", "Meeting end time must be after start time");
  if (patch.startsAt && !patch.endsAt && meeting.endsAt <= patch.startsAt) throw new AppError(422, "MEETING_TIME_INVALID", "Meeting end time must be after start time");
  const updated = await prisma.meeting.update({ where: { id: meeting.id }, data: patch as any });
  const calendarIds = (await prisma.meetingCalendarLink.findMany({ where: { meetingId: meeting.id, provider: MeetingCalendarProvider.INTERNAL }, select: { externalEventId: true } })).map(x => x.externalEventId).filter((x): x is string => Boolean(x));
  if (calendarIds.length) await prisma.calendarEvent.updateMany({ where: { id: { in: calendarIds } }, data: { title: updated.title, description: updated.description, startsAt: updated.startsAt, endsAt: updated.endsAt, branchId: updated.branchId } });
  await audit(req, meeting.id, "UPDATE", "Meeting", meeting.id, { fields: Object.keys(patch) });
  res.json({ data: updated });
});

router.post("/meetings/:id/cancel", async (req: AuthRequest, res) => {
  const { meeting, scope } = await meetingForActor(req, String(req.params.id));
  requireMeetingManager(scope, meeting);
  if (meeting.status === MeetingStatus.CANCELLED) return res.json({ data: meeting });
  if (meeting.status === MeetingStatus.LIVE) throw new AppError(409, "MEETING_LIVE", "End a live meeting before cancelling it");
  const reason = z.object({ reason: z.string().trim().min(2).max(1000).optional() }).parse(req.body).reason;
  const updated = await prisma.meeting.update({ where: { id: meeting.id }, data: { status: MeetingStatus.CANCELLED, cancelledAt: new Date(), roomStatus: "CANCELLED" } });
  const links = await prisma.meetingCalendarLink.findMany({ where: { meetingId: meeting.id, provider: MeetingCalendarProvider.INTERNAL }, select: { externalEventId: true } });
  const calendarIds = links.map(x => x.externalEventId).filter((x): x is string => Boolean(x));
  if (calendarIds.length) await prisma.calendarEvent.updateMany({ where: { id: { in: calendarIds } }, data: { status: "CANCELLED" } });
  await prisma.notification.updateMany({ where: { sourceModule: "MEETINGS", sourceEntityId: meeting.id, scheduledAt: { gt: new Date() } }, data: { deletedAt: new Date() } });
  for (const participant of meeting.participants.filter(p => !p.removedAt)) await queueNotification(req, participant.userId, "Meeting cancelled: " + meeting.title, reason || "The meeting has been cancelled.", meeting.id);
  await audit(req, meeting.id, "CANCEL", "Meeting", meeting.id, { reason });
  res.json({ data: updated });
});

router.post("/meetings/:id/respond", async (req: AuthRequest, res) => {
  const { meeting, scope } = await meetingForActor(req, String(req.params.id));
  const response = z.object({ response: z.nativeEnum(MeetingResponseStatus) }).parse(req.body).response;
  if (response === MeetingResponseStatus.PENDING) throw new AppError(422, "MEETING_RESPONSE_INVALID", "Choose accepted, declined or tentative");
  const participant = meeting.participants.find(p => p.userId === scope.userId && !p.removedAt);
  if (!participant) throw new AppError(403, "MEETING_NOT_INVITED", "You are not an active participant");
  const now = new Date();
  const updated = await prisma.meetingParticipant.update({
    where: { id: participant.id },
    data: { responseStatus: response, acceptedAt: response === MeetingResponseStatus.ACCEPTED ? now : null, declinedAt: response === MeetingResponseStatus.DECLINED ? now : null },
  });
  await audit(req, meeting.id, "RESPOND", "MeetingParticipant", participant.id, { response });
  res.json({ data: updated });
});

router.post("/meetings/:id/participants", async (req: AuthRequest, res) => {
  const { meeting, scope } = await meetingForActor(req, String(req.params.id));
  requireMeetingManager(scope, meeting);
  const data = z.object({
    userIds: z.array(id).min(1).max(500),
    role: z.nativeEnum(MeetingParticipantRole).default(MeetingParticipantRole.PARTICIPANT),
  }).parse(req.body);
  if (data.role === MeetingParticipantRole.HOST) throw new AppError(422, "MEETING_HOST_CHANGE_SEPARATE", "Use the meeting update workflow to change the host");
  const users = await eligibleUsers(req, data.userIds);
  await assertParticipantScope(scope, users);
  const existing = new Set((await prisma.meetingParticipant.findMany({ where: { meetingId: meeting.id, userId: { in: data.userIds } }, select: { userId: true } })).map(x => x.userId));
  const fresh = users.filter(user => !existing.has(user.id));
  if (!fresh.length) return res.json({ data: [] });
  await prisma.meetingParticipant.createMany({
    data: fresh.map(user => ({
      organizationId: scope.organizationId,
      meetingId: meeting.id,
      userId: user.id,
      participantType: staffParticipantType(user),
      meetingRole: data.role,
      invitationStatus: MeetingInvitationStatus.SENT,
      addedById: scope.userId,
      invitedAt: new Date(),
    })),
  });
  const rows = await prisma.meetingParticipant.findMany({ where: { meetingId: meeting.id, userId: { in: fresh.map(x => x.id) } } });
  await prisma.meetingAttendance.createMany({ data: rows.map(row => ({ organizationId: scope.organizationId, meetingId: meeting.id, participantId: row.id })) });
  await scheduleMeetingNotifications(req, meeting, fresh.map(x => x.id));
  await audit(req, meeting.id, "ADD_PARTICIPANTS", "MeetingParticipant", undefined, { count: fresh.length, role: data.role });
  res.status(201).json({ data: rows });
});

router.delete("/meetings/:id/participants/:participantId", async (req: AuthRequest, res) => {
  const { meeting, scope } = await meetingForActor(req, String(req.params.id));
  requireMeetingManager(scope, meeting);
  const participant = meeting.participants.find(p => p.id === String(req.params.participantId));
  if (!participant) throw new AppError(404, "MEETING_PARTICIPANT_NOT_FOUND", "Participant not found");
  if (participant.meetingRole === MeetingParticipantRole.HOST) throw new AppError(409, "MEETING_HOST_REQUIRED", "The host cannot be removed");
  await prisma.meetingParticipant.update({ where: { id: participant.id }, data: { removedAt: new Date(), invitationStatus: MeetingInvitationStatus.CANCELLED } });
  if (meeting.livekitRoomName) await livekitRoomService("RemoveParticipant", { room: meeting.livekitRoomName, identity: participant.userId }, meeting.livekitRoomName).catch(() => null);
  await audit(req, meeting.id, "REMOVE_PARTICIPANT", "MeetingParticipant", participant.id);
  res.status(204).send();
});

router.post("/meetings/:id/agenda", async (req: AuthRequest, res) => {
  const { meeting, scope } = await meetingForActor(req, String(req.params.id));
  requireMeetingManager(scope, meeting);
  const data = z.object({ title: z.string().trim().min(1).max(300), description: z.string().max(5000).nullable().optional(), presenterUserId: id.nullable().optional(), plannedMinutes: z.number().int().positive().max(1440).nullable().optional() }).parse(req.body);
  const sequence = (await prisma.meetingAgendaItem.aggregate({ where: { meetingId: meeting.id }, _max: { sequence: true } }))._max.sequence ?? 0;
  const row = await prisma.meetingAgendaItem.create({ data: { organizationId: scope.organizationId, meetingId: meeting.id, ...data, sequence: sequence + 1 } });
  await audit(req, meeting.id, "ADD_AGENDA", "MeetingAgendaItem", row.id);
  res.status(201).json({ data: row });
});

router.patch("/meetings/:id/agenda/:agendaId", async (req: AuthRequest, res) => {
  const { meeting, scope } = await meetingForActor(req, String(req.params.id));
  requireMeetingManager(scope, meeting);
  const existing = await prisma.meetingAgendaItem.findFirst({ where: { id: String(req.params.agendaId), meetingId: meeting.id } });
  if (!existing) throw new AppError(404, "MEETING_AGENDA_NOT_FOUND", "Agenda item not found");
  const data = z.object({ title: z.string().trim().min(1).max(300), description: z.string().max(5000).nullable(), presenterUserId: id.nullable(), plannedMinutes: z.number().int().positive().max(1440).nullable(), sequence: z.number().int().positive(), status: z.nativeEnum(MeetingAgendaStatus) }).partial().parse(req.body);
  const row = await prisma.meetingAgendaItem.update({ where: { id: existing.id }, data });
  await audit(req, meeting.id, "UPDATE_AGENDA", "MeetingAgendaItem", row.id);
  res.json({ data: row });
});

router.delete("/meetings/:id/agenda/:agendaId", async (req: AuthRequest, res) => {
  const { meeting, scope } = await meetingForActor(req, String(req.params.id));
  requireMeetingManager(scope, meeting);
  const existing = await prisma.meetingAgendaItem.findFirst({ where: { id: String(req.params.agendaId), meetingId: meeting.id } });
  if (!existing) throw new AppError(404, "MEETING_AGENDA_NOT_FOUND", "Agenda item not found");
  await prisma.meetingAgendaItem.delete({ where: { id: existing.id } });
  await audit(req, meeting.id, "DELETE_AGENDA", "MeetingAgendaItem", existing.id);
  res.status(204).send();
});

router.post("/meetings/:id/attachments", async (req: AuthRequest, res) => {
  const { meeting, scope } = await meetingForActor(req, String(req.params.id));
  const participant = meeting.participants.find(p => p.userId === scope.userId && !p.removedAt);
  if (!participant && !canManageMeeting(scope, meeting)) throw new AppError(403, "MEETING_ATTACHMENT_DENIED", "Meeting participant access is required");
  const data = z.object({
    agendaItemId: id.nullable().optional(),
    name: z.string().trim().min(1).max(180),
    mimeType: z.enum(allowedDocumentTypes),
    base64: z.string().min(1),
    visibility: z.enum(["PARTICIPANTS", "HOSTS"]).default("PARTICIPANTS"),
  }).parse(req.body);
  assertDocumentFileExtension(data.name, data.mimeType as AllowedDocumentType);
  const buffer = decodeVerifiedUpload(data.base64, data.mimeType as AllowedDocumentType, 10 * 1024 * 1024) as any;
  if (data.agendaItemId && !meeting.agendaItems.some(item => item.id === data.agendaItemId)) throw new AppError(422, "MEETING_AGENDA_NOT_FOUND", "Attachment agenda item does not belong to this meeting");
  const row = await prisma.meetingAttachment.create({
    data: {
      organizationId: scope.organizationId,
      meetingId: meeting.id,
      agendaItemId: data.agendaItemId ?? null,
      name: data.name,
      mimeType: data.mimeType,
      size: buffer.length,
      data: buffer,
      visibility: data.visibility,
      uploadedById: scope.userId,
    },
    select: { id: true, agendaItemId: true, name: true, mimeType: true, size: true, visibility: true, uploadedById: true, createdAt: true },
  });
  await audit(req, meeting.id, "UPLOAD_ATTACHMENT", "MeetingAttachment", row.id, { name: row.name, size: row.size });
  res.status(201).json({ data: row });
});

router.get("/meetings/:id/attachments/:attachmentId/download", async (req: AuthRequest, res) => {
  const { meeting, scope } = await meetingForActor(req, String(req.params.id));
  const attachment = await prisma.meetingAttachment.findFirst({ where: { id: String(req.params.attachmentId), meetingId: meeting.id } });
  if (!attachment || !attachment.data) throw new AppError(404, "MEETING_ATTACHMENT_NOT_FOUND", "Attachment not found");
  if (attachment.visibility === "HOSTS" && !canManageMeeting(scope, meeting)) throw new AppError(403, "MEETING_ATTACHMENT_DENIED", "Host access is required");
  const buffer = storedDocumentBuffer(attachment.data);
  res.set(storedDocumentHeaders({ fileName: attachment.name, mimeType: attachment.mimeType, fileSize: buffer.length, fallbackName: "meeting-attachment" }, "attachment")).send(buffer);
});

router.post("/meetings/:id/start", async (req: AuthRequest, res) => {
  const { meeting, scope } = await meetingForActor(req, String(req.params.id));
  requireMeetingManager(scope, meeting);
  if ([MeetingStatus.CANCELLED, MeetingStatus.CLOSED].includes(meeting.status)) throw new AppError(409, "MEETING_NOT_STARTABLE", "This meeting cannot be started");
  const room = meeting.livekitRoomName ?? ("mtg-" + crypto.randomUUID());
  const updated = await prisma.meeting.update({ where: { id: meeting.id }, data: { livekitRoomName: room, status: MeetingStatus.LIVE, roomStatus: "LIVE", roomLocked: meeting.lockAfterStart } });
  await audit(req, meeting.id, "START", "Meeting", meeting.id, { room });
  res.json({ data: updated });
});

router.post("/meetings/:id/end", async (req: AuthRequest, res) => {
  const { meeting, scope } = await meetingForActor(req, String(req.params.id));
  requireMeetingManager(scope, meeting);
  if (meeting.status !== MeetingStatus.LIVE && meeting.status !== MeetingStatus.OPEN_FOR_JOIN) throw new AppError(409, "MEETING_NOT_LIVE", "Meeting is not live");
  if (meeting.livekitRoomName) await livekitRoomService("DeleteRoom", { room: meeting.livekitRoomName }, meeting.livekitRoomName).catch(() => null);
  const now = new Date();
  const updated = await prisma.meeting.update({ where: { id: meeting.id }, data: { status: MeetingStatus.MINUTES_PENDING, roomStatus: "ENDED", endedAt: now, roomLocked: true } });
  const openSessions = await prisma.meetingAttendanceSession.findMany({ where: { attendance: { meetingId: meeting.id }, leftAt: null }, select: { id: true, attendanceId: true, joinedAt: true } });
  for (const session of openSessions) {
    const seconds = Math.max(0, Math.floor((now.getTime() - session.joinedAt.getTime()) / 1000));
    await prisma.$transaction([
      prisma.meetingAttendanceSession.update({ where: { id: session.id }, data: { leftAt: now, durationSeconds: seconds } }),
      prisma.meetingAttendance.update({ where: { id: session.attendanceId }, data: { lastLeftAt: now, totalDurationSeconds: { increment: seconds } } }),
    ]);
  }
  const durationSeconds = Math.max(1, Math.floor((meeting.endsAt.getTime() - meeting.startsAt.getTime()) / 1000));
  const attendance = await prisma.meetingAttendance.findMany({ where: { meetingId: meeting.id } });
  for (const row of attendance) {
    const status = row.totalDurationSeconds >= durationSeconds * 0.8
      ? MeetingAttendanceStatus.PRESENT
      : row.totalDurationSeconds > 0
        ? MeetingAttendanceStatus.PARTIAL
        : MeetingAttendanceStatus.ABSENT;
    await prisma.meetingAttendance.update({ where: { id: row.id }, data: { status } });
  }
  await audit(req, meeting.id, "END", "Meeting", meeting.id);
  res.json({ data: updated });
});

router.post("/meetings/:id/join-token", async (req: AuthRequest, res) => {
  const { meeting, scope } = await meetingForActor(req, String(req.params.id));
  if ([MeetingStatus.CANCELLED, MeetingStatus.CLOSED, MeetingStatus.ENDED, MeetingStatus.MINUTES_PENDING, MeetingStatus.MINUTES_PUBLISHED].includes(meeting.status)) {
    throw new AppError(409, "MEETING_JOIN_CLOSED", "This meeting is no longer joinable");
  }
  const participant = meeting.participants.find(p => p.userId === scope.userId && !p.removedAt);
  if (!participant) throw new AppError(403, "MEETING_NOT_INVITED", "You are not an active meeting participant");
  const manager = meetingManagerRoles.has(participant.meetingRole) || managerRoleSet.has(scope.role);
  if (meeting.roomLocked && !manager) throw new AppError(423, "MEETING_LOCKED", "The meeting room is locked");
  const earliest = meeting.startsAt.getTime() - meeting.joinBeforeMinutes * 60_000;
  if (!manager && Date.now() < earliest) throw new AppError(409, "MEETING_TOO_EARLY", "The meeting is not open for joining yet");
  let room = meeting.livekitRoomName;
  if (!room) {
    if (!manager) throw new AppError(409, "MEETING_NOT_STARTED", "The host has not started the meeting");
    room = "mtg-" + crypto.randomUUID();
    await prisma.meeting.update({ where: { id: meeting.id }, data: { livekitRoomName: room, status: MeetingStatus.OPEN_FOR_JOIN, roomStatus: "OPEN" } });
  }
  const user = await prisma.user.findFirst({ where: { organizationId: scope.organizationId, id: scope.userId }, select: { name: true } });
  if (!user) throw new AppError(404, "USER_NOT_FOUND", "User not found");
  const presenter = participant.meetingRole === MeetingParticipantRole.PRESENTER || manager;
  const publish = participant.meetingRole !== MeetingParticipantRole.OBSERVER;
  const sources = [
    ...(meeting.allowParticipantCamera || manager ? ["camera"] : []),
    ...(meeting.allowParticipantMic || manager ? ["microphone"] : []),
    ...(meeting.allowScreenShare && presenter ? ["screen_share", "screen_share_audio"] : []),
  ];
  const token = createLiveKitToken({
    identity: scope.userId,
    name: user.name,
    room,
    role: participant.meetingRole,
    ttlSeconds: 4 * 60 * 60,
    grant: {
      room,
      roomJoin: true,
      roomAdmin: manager,
      canSubscribe: true,
      canPublish: publish,
      // Data channel remains available for raise-hand/reactions even when chat or whiteboard is disabled.
      canPublishData: publish,
      canUpdateOwnMetadata: true,
      ...(publish ? { canPublishSources: sources } : {}),
    },
  });
  res.status(201).json({
    data: {
      serverUrl: livekitClientUrl(),
      participantToken: token,
      meeting: { id: meeting.id, title: meeting.title, description: meeting.description, startsAt: meeting.startsAt, endsAt: meeting.endsAt, status: meeting.status },
      meetingRole: participant.meetingRole,
      manager,
      locked: meeting.roomLocked,
      settings: {
        allowChat: meeting.allowChat,
        allowWhiteboard: meeting.allowWhiteboard,
        allowRecording: meeting.allowRecording,
        allowAnnotation: meeting.allowAnnotation,
        allowScreenShare: meeting.allowScreenShare,
        allowParticipantMic: meeting.allowParticipantMic,
        allowParticipantCamera: meeting.allowParticipantCamera,
      },
      recordingConfigured: livekitRecordingConfigured(),
      recordingAvailable: meeting.recordings.some(recording => recording.status !== MeetingRecordingStatus.DELETED),
      whiteboardData: meeting.whiteboardData ?? [],
    },
  });
});

router.post("/meetings/:id/control", async (req: AuthRequest, res) => {
  const { meeting, scope } = await meetingForActor(req, String(req.params.id));
  requireMeetingManager(scope, meeting);
  const data = z.object({
    action: z.enum(["LOCK", "UNLOCK", "MUTE_TRACK", "REMOVE_PARTICIPANT", "ALLOW_SCREEN_SHARE", "REVOKE_SCREEN_SHARE"]),
    identity: z.string().min(1).max(160).optional(),
    trackSid: z.string().min(1).max(160).optional(),
  }).parse(req.body);
  if (data.action === "LOCK" || data.action === "UNLOCK") {
    const locked = data.action === "LOCK";
    await prisma.meeting.update({ where: { id: meeting.id }, data: { roomLocked: locked } });
    await audit(req, meeting.id, data.action);
    return res.json({ data: { locked } });
  }
  if (!meeting.livekitRoomName) throw new AppError(409, "MEETING_ROOM_MISSING", "Meeting room is not active");
  if (!data.identity) throw new AppError(422, "MEETING_PARTICIPANT_REQUIRED", "Participant identity is required");
  if (data.action === "MUTE_TRACK") {
    if (!data.trackSid) throw new AppError(422, "MEETING_TRACK_REQUIRED", "Track ID is required");
    const result = await livekitRoomService("MutePublishedTrack", { room: meeting.livekitRoomName, identity: data.identity, track_sid: data.trackSid, muted: true }, meeting.livekitRoomName);
    await audit(req, meeting.id, "MUTE_PARTICIPANT", "MeetingParticipant", undefined, { identity: data.identity });
    return res.json({ data: result });
  }
  if (data.action === "REMOVE_PARTICIPANT") {
    const participant = meeting.participants.find(p => p.userId === data.identity);
    if (participant?.meetingRole === MeetingParticipantRole.HOST) throw new AppError(409, "MEETING_HOST_REQUIRED", "Host cannot be removed from the live room");
    const result = await livekitRoomService("RemoveParticipant", { room: meeting.livekitRoomName, identity: data.identity }, meeting.livekitRoomName);
    if (participant) await prisma.meetingParticipant.update({ where: { id: participant.id }, data: { removedAt: new Date() } });
    await audit(req, meeting.id, "REMOVE_LIVE_PARTICIPANT", "MeetingParticipant", participant?.id, { identity: data.identity });
    return res.json({ data: result ?? { removed: true } });
  }
  const allowShare = data.action === "ALLOW_SCREEN_SHARE";
  const result = await livekitRoomService("UpdateParticipant", {
    room: meeting.livekitRoomName,
    identity: data.identity,
    permission: {
      can_subscribe: true,
      can_publish: true,
      can_publish_data: true,
      can_publish_sources: allowShare ? ["camera", "microphone", "screen_share", "screen_share_audio"] : ["camera", "microphone"],
    },
  }, meeting.livekitRoomName);
  await audit(req, meeting.id, data.action, "MeetingParticipant", undefined, { identity: data.identity });
  res.json({ data: result });
});

router.put("/meetings/:id/whiteboard", async (req: AuthRequest, res) => {
  const { meeting, scope } = await meetingForActor(req, String(req.params.id));
  const participant = meeting.participants.find(p => p.userId === scope.userId && !p.removedAt);
  const canWrite = canManageMeeting(scope, meeting) || participant?.meetingRole === MeetingParticipantRole.PRESENTER;
  if (!meeting.allowWhiteboard || !canWrite) throw new AppError(403, "MEETING_WHITEBOARD_DENIED", "Whiteboard write access is not enabled");
  const data = z.object({ strokes: z.array(z.record(z.string(), z.unknown())).max(10000) }).parse(req.body);
  const row = await prisma.meeting.update({ where: { id: meeting.id }, data: { whiteboardData: data.strokes as any } });
  await audit(req, meeting.id, "SAVE_WHITEBOARD", "Meeting", meeting.id, { strokes: data.strokes.length });
  res.json({ data: { saved: true, updatedAt: row.updatedAt } });
});

router.post("/meetings/:id/attendance/join", async (req: AuthRequest, res) => {
  const { meeting, scope } = await meetingForActor(req, String(req.params.id));
  const participant = meeting.participants.find(p => p.userId === scope.userId && !p.removedAt);
  if (!participant) throw new AppError(403, "MEETING_NOT_INVITED", "You are not an active participant");
  const attendance = await prisma.meetingAttendance.findUnique({ where: { participantId: participant.id } });
  if (!attendance) throw new AppError(409, "MEETING_ATTENDANCE_MISSING", "Attendance record is unavailable");
  const existing = await prisma.meetingAttendanceSession.findFirst({ where: { attendanceId: attendance.id, leftAt: null }, orderBy: { joinedAt: "desc" } });
  if (existing) return res.json({ data: existing });
  const now = new Date();
  const session = await prisma.$transaction(async tx => {
    const created = await tx.meetingAttendanceSession.create({ data: { organizationId: scope.organizationId, attendanceId: attendance.id, joinedAt: now } });
    await tx.meetingAttendance.update({ where: { id: attendance.id }, data: { firstJoinedAt: attendance.firstJoinedAt ?? now, joinCount: { increment: 1 }, status: MeetingAttendanceStatus.PARTIAL } });
    return created;
  });
  res.status(201).json({ data: session });
});

router.post("/meetings/:id/attendance/leave", async (req: AuthRequest, res) => {
  const { meeting, scope } = await meetingForActor(req, String(req.params.id));
  const participant = meeting.participants.find(p => p.userId === scope.userId && !p.removedAt);
  if (!participant) throw new AppError(403, "MEETING_NOT_INVITED", "You are not an active participant");
  const attendance = await prisma.meetingAttendance.findUnique({ where: { participantId: participant.id } });
  if (!attendance) return res.status(204).send();
  const session = await prisma.meetingAttendanceSession.findFirst({ where: { attendanceId: attendance.id, leftAt: null }, orderBy: { joinedAt: "desc" } });
  if (!session) return res.status(204).send();
  const now = new Date();
  const seconds = Math.max(0, Math.floor((now.getTime() - session.joinedAt.getTime()) / 1000));
  await prisma.$transaction([
    prisma.meetingAttendanceSession.update({ where: { id: session.id }, data: { leftAt: now, durationSeconds: seconds } }),
    prisma.meetingAttendance.update({ where: { id: attendance.id }, data: { lastLeftAt: now, totalDurationSeconds: { increment: seconds }, status: MeetingAttendanceStatus.PARTIAL } }),
  ]);
  res.json({ data: { leftAt: now, durationSeconds: seconds } });
});

router.get("/meetings/:id/attendance", async (req: AuthRequest, res) => {
  const { meeting, scope } = await meetingForActor(req, String(req.params.id));
  requireMeetingManager(scope, meeting);
  const rows = await prisma.meetingAttendance.findMany({
    where: { meetingId: meeting.id },
    include: { participant: true, sessions: { orderBy: { joinedAt: "asc" } } },
    orderBy: { firstJoinedAt: "asc" },
  });
  const users = await prisma.user.findMany({
    where: { organizationId: scope.organizationId, id: { in: rows.map(row => row.participant.userId) } },
    select: { id: true, name: true, email: true, role: true },
  });
  const directory = new Map(users.map(user => [user.id, user]));
  res.json({ data: rows.map(row => ({ ...row, user: directory.get(row.participant.userId) ?? null })) });
});

router.put("/meetings/:id/minutes", async (req: AuthRequest, res) => {
  const { meeting, scope } = await meetingForActor(req, String(req.params.id));
  requireMeetingManager(scope, meeting);
  const data = z.object({ summary: z.string().trim().min(1).max(100000), notes: z.unknown().optional() }).parse(req.body);
  const row = await prisma.meetingMinutes.upsert({
    where: { meetingId: meeting.id },
    create: { organizationId: scope.organizationId, meetingId: meeting.id, summary: data.summary, notes: data.notes as any, preparedById: scope.userId },
    update: { summary: data.summary, notes: data.notes as any, preparedById: scope.userId, status: MeetingMinutesStatus.DRAFT, approvedById: null, approvedAt: null, publishedAt: null },
  });
  await audit(req, meeting.id, "SAVE_MINUTES", "MeetingMinutes", row.id);
  res.json({ data: row });
});

router.post("/meetings/:id/minutes/submit", async (req: AuthRequest, res) => {
  const { meeting, scope } = await meetingForActor(req, String(req.params.id));
  requireMeetingManager(scope, meeting);
  if (!meeting.minutes) throw new AppError(409, "MEETING_MINUTES_MISSING", "Draft minutes before submitting them");
  const row = await prisma.meetingMinutes.update({ where: { id: meeting.minutes.id }, data: { status: MeetingMinutesStatus.UNDER_REVIEW } });
  await audit(req, meeting.id, "SUBMIT_MINUTES", "MeetingMinutes", row.id);
  res.json({ data: row });
});

router.post("/meetings/:id/minutes/approve", async (req: AuthRequest, res) => {
  const { meeting, scope } = await meetingForActor(req, String(req.params.id));
  if (!managerRoleSet.has(scope.role)) throw new AppError(403, "MEETING_MINUTES_APPROVAL_DENIED", "Scoped administrator approval is required");
  if (!meeting.minutes) throw new AppError(409, "MEETING_MINUTES_MISSING", "Minutes have not been prepared");
  const row = await prisma.meetingMinutes.update({ where: { id: meeting.minutes.id }, data: { status: MeetingMinutesStatus.APPROVED, approvedById: scope.userId, approvedAt: new Date() } });
  await audit(req, meeting.id, "APPROVE_MINUTES", "MeetingMinutes", row.id);
  res.json({ data: row });
});

router.post("/meetings/:id/minutes/publish", async (req: AuthRequest, res) => {
  const { meeting, scope } = await meetingForActor(req, String(req.params.id));
  requireMeetingManager(scope, meeting);
  if (!meeting.minutes || ![MeetingMinutesStatus.APPROVED, MeetingMinutesStatus.PUBLISHED].includes(meeting.minutes.status)) throw new AppError(409, "MEETING_MINUTES_NOT_APPROVED", "Approve minutes before publishing");
  const now = new Date();
  const row = await prisma.meetingMinutes.update({ where: { id: meeting.minutes.id }, data: { status: MeetingMinutesStatus.PUBLISHED, publishedAt: now } });
  await prisma.meeting.update({ where: { id: meeting.id }, data: { status: MeetingStatus.MINUTES_PUBLISHED } });
  for (const participant of meeting.participants.filter(p => !p.removedAt)) await queueNotification(req, participant.userId, "Meeting minutes published: " + meeting.title, "Approved meeting minutes are now available.", meeting.id);
  await audit(req, meeting.id, "PUBLISH_MINUTES", "MeetingMinutes", row.id);
  res.json({ data: row });
});

router.post("/meetings/:id/decisions", async (req: AuthRequest, res) => {
  const { meeting, scope } = await meetingForActor(req, String(req.params.id));
  requireMeetingManager(scope, meeting);
  const data = z.object({ agendaItemId: id.nullable().optional(), decision: z.string().trim().min(1).max(20000), rationale: z.string().trim().max(20000).nullable().optional() }).parse(req.body);
  if (data.agendaItemId && !meeting.agendaItems.some(item => item.id === data.agendaItemId)) throw new AppError(422, "MEETING_AGENDA_NOT_FOUND", "Agenda item does not belong to this meeting");
  const row = await prisma.meetingDecision.create({ data: { organizationId: scope.organizationId, meetingId: meeting.id, agendaItemId: data.agendaItemId ?? null, decision: data.decision, rationale: data.rationale ?? null, recordedById: scope.userId } });
  await audit(req, meeting.id, "ADD_DECISION", "MeetingDecision", row.id);
  res.status(201).json({ data: row });
});

router.post("/meetings/:id/actions", async (req: AuthRequest, res) => {
  const { meeting, scope } = await meetingForActor(req, String(req.params.id));
  requireMeetingManager(scope, meeting);
  const data = z.object({
    decisionId: id.nullable().optional(),
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().max(10000).nullable().optional(),
    assigneeUserId: id,
    dueAt: z.coerce.date().nullable().optional(),
    priority: z.nativeEnum(MeetingActionPriority).default(MeetingActionPriority.NORMAL),
  }).parse(req.body);
  if (!meeting.participants.some(p => p.userId === data.assigneeUserId && !p.removedAt)) throw new AppError(422, "MEETING_ACTION_ASSIGNEE_INVALID", "Action assignee must be an active meeting participant");
  if (data.decisionId && !meeting.decisions.some(d => d.id === data.decisionId)) throw new AppError(422, "MEETING_DECISION_INVALID", "Decision does not belong to this meeting");
  const row = await prisma.meetingActionItem.create({ data: { organizationId: scope.organizationId, meetingId: meeting.id, decisionId: data.decisionId ?? null, title: data.title, description: data.description ?? null, assigneeUserId: data.assigneeUserId, assignedById: scope.userId, dueAt: data.dueAt ?? null, priority: data.priority } });
  await queueNotification(req, data.assigneeUserId, "Meeting action assigned: " + data.title, "A meeting action item has been assigned to you.", meeting.id);
  await audit(req, meeting.id, "ASSIGN_ACTION", "MeetingActionItem", row.id, { assigneeUserId: data.assigneeUserId, dueAt: data.dueAt });
  res.status(201).json({ data: row });
});

router.get("/meeting-actions/my", async (req: AuthRequest, res) => {
  const scope = await actorScope(req);
  const q = z.object({ status: z.nativeEnum(MeetingActionStatus).optional(), overdue: z.coerce.boolean().optional() }).parse(req.query);
  const now = new Date();
  const data = await prisma.meetingActionItem.findMany({
    where: {
      assigneeUserId: scope.userId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.overdue ? { dueAt: { lt: now }, status: { in: [MeetingActionStatus.OPEN, MeetingActionStatus.IN_PROGRESS, MeetingActionStatus.BLOCKED] } } : {}),
    },
    include: { meeting: { select: { id: true, title: true, startsAt: true, branchId: true, departmentId: true } } },
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
  });
  res.json({ data: data.map(item => ({ ...item, overdue: Boolean(item.dueAt && item.dueAt < now && ![MeetingActionStatus.COMPLETED, MeetingActionStatus.CANCELLED].includes(item.status)) })) });
});

router.patch("/meeting-actions/:id", async (req: AuthRequest, res) => {
  const scope = await actorScope(req);
  const action = await prisma.meetingActionItem.findFirst({ where: { id: String(req.params.id) }, include: { meeting: { include: { participants: true } } } });
  if (!action) throw new AppError(404, "MEETING_ACTION_NOT_FOUND", "Action item not found");
  const manager = canManageMeeting(scope, action.meeting);
  const assignee = action.assigneeUserId === scope.userId;
  if (!manager && !assignee) throw new AppError(403, "MEETING_ACTION_DENIED", "Action item access denied");
  const data = z.object({ title: z.string().trim().min(1).max(300), description: z.string().max(10000).nullable(), assigneeUserId: id, dueAt: z.coerce.date().nullable(), priority: z.nativeEnum(MeetingActionPriority), status: z.nativeEnum(MeetingActionStatus), completionNote: z.string().max(10000).nullable() }).partial().parse(req.body);
  if (!manager) {
    const forbidden = ["title", "description", "assigneeUserId", "dueAt", "priority"].some(key => key in data);
    if (forbidden) throw new AppError(403, "MEETING_ACTION_EDIT_DENIED", "Assignees may only update action status and completion notes");
  }
  const updated = await prisma.meetingActionItem.update({ where: { id: action.id }, data: { ...data, ...(data.status === MeetingActionStatus.COMPLETED ? { completedAt: new Date() } : data.status ? { completedAt: null } : {}) } as any });
  await audit(req, action.meetingId, "UPDATE_ACTION", "MeetingActionItem", action.id, { fields: Object.keys(data) });
  res.json({ data: updated });
});

router.post("/meeting-actions/:id/complete", async (req: AuthRequest, res) => {
  const scope = await actorScope(req);
  const action = await prisma.meetingActionItem.findFirst({ where: { id: String(req.params.id) }, include: { meeting: { include: { participants: true } } } });
  if (!action) throw new AppError(404, "MEETING_ACTION_NOT_FOUND", "Action item not found");
  if (action.assigneeUserId !== scope.userId && !canManageMeeting(scope, action.meeting)) throw new AppError(403, "MEETING_ACTION_DENIED", "Only the assignee or meeting manager can complete this action");
  const completionNote = z.object({ completionNote: z.string().trim().max(10000).nullable().optional() }).parse(req.body).completionNote ?? null;
  const row = await prisma.meetingActionItem.update({ where: { id: action.id }, data: { status: MeetingActionStatus.COMPLETED, completedAt: new Date(), completionNote } });
  if (action.assignedById !== scope.userId) await queueNotification(req, action.assignedById, "Meeting action completed: " + action.title, "The assigned action item has been completed.", action.meetingId);
  await audit(req, action.meetingId, "COMPLETE_ACTION", "MeetingActionItem", action.id);
  res.json({ data: row });
});

router.post("/meeting-actions/:id/reopen", async (req: AuthRequest, res) => {
  const scope = await actorScope(req);
  const action = await prisma.meetingActionItem.findFirst({ where: { id: String(req.params.id) }, include: { meeting: { include: { participants: true } } } });
  if (!action) throw new AppError(404, "MEETING_ACTION_NOT_FOUND", "Action item not found");
  requireMeetingManager(scope, action.meeting);
  const row = await prisma.meetingActionItem.update({ where: { id: action.id }, data: { status: MeetingActionStatus.IN_PROGRESS, completedAt: null } });
  await queueNotification(req, action.assigneeUserId, "Meeting action reopened: " + action.title, "A completed action item has been reopened.", action.meetingId);
  await audit(req, action.meetingId, "REOPEN_ACTION", "MeetingActionItem", action.id);
  res.json({ data: row });
});

router.post("/meetings/:id/recordings/start", async (req: AuthRequest, res) => {
  const { meeting, scope } = await meetingForActor(req, String(req.params.id));
  requireMeetingManager(scope, meeting);
  await assertFeatureEntitled(scope.organizationId, "meetings_recording");
  if (!meeting.allowRecording) throw new AppError(403, "MEETING_RECORDING_DISABLED", "Recording is disabled for this meeting");
  if (!meeting.livekitRoomName || meeting.status !== MeetingStatus.LIVE) throw new AppError(409, "MEETING_NOT_LIVE", "Start the meeting before recording");
  if (!livekitRecordingConfigured()) throw new AppError(503, "MEETING_RECORDING_NOT_CONFIGURED", "Meeting recording storage is not configured");
  const active = await prisma.meetingRecording.findFirst({ where: { meetingId: meeting.id, status: { in: [MeetingRecordingStatus.STARTING, MeetingRecordingStatus.RECORDING, MeetingRecordingStatus.PROCESSING] } } });
  if (active) throw new AppError(409, "MEETING_RECORDING_ACTIVE", "A meeting recording is already active");
  const key = env.LIVEKIT_RECORDING_PREFIX + "/meetings/" + scope.organizationId + "/" + meeting.id + "/" + Date.now() + ".mp4";
  const storage = livekitRecordingStorage();
  const s3: Record<string, unknown> = { access_key: storage.accessKeyId, secret: storage.secretAccessKey, region: storage.region, bucket: storage.bucket };
  if (storage.endpoint) { s3.endpoint = storage.endpoint; s3.force_path_style = true; }
  const result: any = await livekitEgress("StartEgress", { room_name: meeting.livekitRoomName, template: { layout: "grid" }, outputs: [{ file: { file_type: "MP4", filepath: key } }], storage: { s3 } });
  const egressId = result.egress_id ?? result.egressId;
  const row = await prisma.meetingRecording.create({ data: { organizationId: scope.organizationId, meetingId: meeting.id, providerRecordingId: egressId, egressId, objectKey: key, status: MeetingRecordingStatus.RECORDING, startedAt: new Date(), initiatedById: scope.userId } });
  await audit(req, meeting.id, "START_RECORDING", "MeetingRecording", row.id, { egressId });
  res.status(201).json({ data: row });
});

router.post("/meetings/:id/recordings/stop", async (req: AuthRequest, res) => {
  const { meeting, scope } = await meetingForActor(req, String(req.params.id));
  requireMeetingManager(scope, meeting);
  const recording = await prisma.meetingRecording.findFirst({ where: { meetingId: meeting.id, status: { in: [MeetingRecordingStatus.STARTING, MeetingRecordingStatus.RECORDING] } }, orderBy: { createdAt: "desc" } });
  if (!recording?.egressId) throw new AppError(409, "MEETING_RECORDING_NOT_ACTIVE", "No active recording was found");
  const result: any = await livekitEgress("StopEgress", { egress_id: recording.egressId });
  const row = await prisma.meetingRecording.update({ where: { id: recording.id }, data: { status: MeetingRecordingStatus.PROCESSING, stoppedAt: new Date(), providerRecordingId: result.egress_id ?? recording.providerRecordingId } });
  await audit(req, meeting.id, "STOP_RECORDING", "MeetingRecording", row.id, { egressId: recording.egressId });
  res.json({ data: row });
});

router.get("/meetings/:id/recordings", async (req: AuthRequest, res) => {
  const { meeting } = await meetingForActor(req, String(req.params.id));
  const rows = await prisma.meetingRecording.findMany({ where: { meetingId: meeting.id, status: { not: MeetingRecordingStatus.DELETED } }, orderBy: { createdAt: "desc" } });
  res.json({ data: rows.map(({ sizeBytes, ...row }) => ({ ...row, sizeBytes: sizeBytes?.toString() ?? null })) });
});

router.get("/meetings/:id/recordings/:recordingId/download", async (req: AuthRequest, res) => {
  const { meeting } = await meetingForActor(req, String(req.params.id));
  const recording = await prisma.meetingRecording.findFirst({ where: { id: String(req.params.recordingId), meetingId: meeting.id, status: { not: MeetingRecordingStatus.DELETED } } });
  if (!recording?.objectKey) throw new AppError(404, "MEETING_RECORDING_NOT_FOUND", "Recording is unavailable");
  const object = await getLiveKitRecordingObject(recording.objectKey);
  if (!object || !(Symbol.asyncIterator in Object(object))) throw new AppError(404, "MEETING_RECORDING_NOT_READY", "Recording is still processing");
  if (recording.status !== MeetingRecordingStatus.AVAILABLE) await prisma.meetingRecording.update({ where: { id: recording.id }, data: { status: MeetingRecordingStatus.AVAILABLE } });
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Disposition", "attachment; filename=\"meeting-" + meeting.id + ".mp4\"");
  for await (const chunk of object as AsyncIterable<Uint8Array | string>) res.write(chunk);
  res.end();
});

router.get("/meetings/:id/audit", async (req: AuthRequest, res) => {
  const { meeting, scope } = await meetingForActor(req, String(req.params.id));
  requireMeetingManager(scope, meeting);
  const data = await prisma.meetingAuditLog.findMany({ where: { meetingId: meeting.id }, orderBy: { createdAt: "desc" }, take: 500 });
  res.json({ data });
});

export default router;
