import {
  EmployeeStatus,
  MeetingAudienceType,
  MeetingInvitationStatus,
  MeetingParticipantKind,
  MeetingParticipantRole,
  Role,
} from "@prisma/client";
import { AppError } from "./http.js";
import { prisma } from "./prisma.js";

const staffRoles = [Role.SUPER_ADMIN, Role.BRANCH_ADMIN, Role.ACCOUNTANT, Role.TEACHER, Role.EMPLOYEE] as const;

export type MeetingAudienceSeed = {
  type: MeetingAudienceType;
  branchId?: string | null;
  departmentId?: string | null;
  teamId?: string | null;
  role?: string | null;
  valueId?: string | null;
};

export type MeetingParticipantSeed = {
  userId: string;
  meetingRole: MeetingParticipantRole;
  participantKind: MeetingParticipantKind;
};

export async function staffKind(organizationId: string, userId: string) {
  const user = await prisma.user.findFirst({
    where: { organizationId, id: userId, isActive: true },
    select: { role: true },
  });
  if (!user || !staffRoles.includes(user.role as (typeof staffRoles)[number])) {
    throw new AppError(422, "MEETING_PARTICIPANT_INVALID", "Meeting participants must be active staff users");
  }
  if (user.role === Role.TEACHER) return MeetingParticipantKind.TEACHER;
  if (user.role === Role.EMPLOYEE) return MeetingParticipantKind.EMPLOYEE;
  return MeetingParticipantKind.MANAGEMENT;
}

async function usersInBranch(organizationId: string, branchId: string) {
  const users = await prisma.user.findMany({
    where: {
      organizationId,
      isActive: true,
      role: { in: [...staffRoles] },
      OR: [
        { teacherProfile: { branchId } },
        { employee: { branchId, status: EmployeeStatus.ACTIVE } },
        { branchAssignments: { some: { branchId } } },
      ],
    },
    select: { id: true },
  });
  return users.map(x => x.id);
}

async function usersInDepartment(organizationId: string, departmentId: string, branchId?: string | null) {
  const department = await prisma.department.findFirst({
    where: { organizationId, id: departmentId, isArchived: false },
    select: { id: true },
  });
  if (!department) throw new AppError(422, "MEETING_DEPARTMENT_INVALID", "Meeting department is not available");
  const employees = await prisma.employee.findMany({
    where: { organizationId, departmentId, status: EmployeeStatus.ACTIVE, ...(branchId ? { branchId } : {}) },
    select: { userId: true },
  });
  return employees.map(x => x.userId);
}

async function usersInTeam(organizationId: string, teamId: string, allowedBranchIds?: string[] | null, meetingBranchId?: string | null) {
  const team = await prisma.meetingTeam.findFirst({
    where: { organizationId, id: teamId, isActive: true },
    include: { members: { select: { userId: true } } },
  });
  if (!team) throw new AppError(422, "MEETING_TEAM_INVALID", "Meeting team is not available");
  if (allowedBranchIds && team.branchId && !allowedBranchIds.includes(team.branchId)) {
    throw new AppError(403, "MEETING_TEAM_BRANCH_FORBIDDEN", "Meeting team is outside your branch scope");
  }
  if (meetingBranchId && team.branchId && team.branchId !== meetingBranchId) {
    throw new AppError(422, "MEETING_TEAM_BRANCH_MISMATCH", "Meeting team belongs to a different branch");
  }
  return team.members.map(x => x.userId);
}

async function usersByRole(organizationId: string, roleName: string, branchId?: string | null) {
  if (!(roleName in Role)) throw new AppError(422, "MEETING_ROLE_INVALID", "Meeting audience role is invalid");
  const role = Role[roleName as keyof typeof Role];
  if (!staffRoles.includes(role as (typeof staffRoles)[number])) throw new AppError(422, "MEETING_ROLE_INVALID", "Students and parents cannot be staff-meeting audiences");
  if (!branchId) {
    const users = await prisma.user.findMany({ where: { organizationId, isActive: true, role }, select: { id: true } });
    return users.map(x => x.id);
  }
  const inBranch = new Set(await usersInBranch(organizationId, branchId));
  const users = await prisma.user.findMany({ where: { organizationId, isActive: true, role }, select: { id: true } });
  return users.map(x => x.id).filter(id => inBranch.has(id));
}

export async function resolveMeetingParticipants(input: {
  organizationId: string;
  hostUserId: string;
  meetingBranchId?: string | null;
  explicit: Array<{ userId: string; meetingRole: MeetingParticipantRole }>;
  audiences: MeetingAudienceSeed[];
  allowedBranchIds?: string[] | null;
}) {
  const ids = new Map<string, MeetingParticipantRole>();
  for (const participant of input.explicit) ids.set(participant.userId, participant.meetingRole);

  for (const audience of input.audiences) {
    let users: string[] = [];
    if (audience.type === MeetingAudienceType.ORGANIZATION) {
      if (input.allowedBranchIds) throw new AppError(403, "MEETING_AUDIENCE_FORBIDDEN", "Branch administrators cannot target the whole organization");
      const rows = await prisma.user.findMany({ where: { organizationId: input.organizationId, isActive: true, role: { in: [...staffRoles] } }, select: { id: true } });
      users = rows.map(x => x.id);
    } else if (audience.type === MeetingAudienceType.BRANCH) {
      const branchId = audience.branchId ?? input.meetingBranchId;
      if (!branchId) throw new AppError(422, "MEETING_AUDIENCE_BRANCH_REQUIRED", "Branch audience requires a branch");
      if (input.allowedBranchIds && !input.allowedBranchIds.includes(branchId)) throw new AppError(403, "MEETING_AUDIENCE_FORBIDDEN", "Branch audience is outside your scope");
      if (input.meetingBranchId && branchId !== input.meetingBranchId) throw new AppError(422, "MEETING_AUDIENCE_BRANCH_MISMATCH", "Audience branch must match the meeting branch");
      users = await usersInBranch(input.organizationId, branchId);
    } else if (audience.type === MeetingAudienceType.DEPARTMENT) {
      if (!audience.departmentId) throw new AppError(422, "MEETING_AUDIENCE_DEPARTMENT_REQUIRED", "Department audience requires a department");
      users = await usersInDepartment(input.organizationId, audience.departmentId, input.meetingBranchId);
    } else if (audience.type === MeetingAudienceType.TEAM) {
      if (!audience.teamId) throw new AppError(422, "MEETING_AUDIENCE_TEAM_REQUIRED", "Team audience requires a team");
      users = await usersInTeam(input.organizationId, audience.teamId, input.allowedBranchIds, input.meetingBranchId);
    } else if (audience.type === MeetingAudienceType.ROLE) {
      if (!audience.role) throw new AppError(422, "MEETING_AUDIENCE_ROLE_REQUIRED", "Role audience requires a role");
      users = await usersByRole(input.organizationId, audience.role, input.meetingBranchId);
    } else if (audience.type === MeetingAudienceType.INDIVIDUAL) {
      if (!audience.valueId) throw new AppError(422, "MEETING_AUDIENCE_USER_REQUIRED", "Individual audience requires a user");
      users = [audience.valueId];
    }
    for (const userId of users) if (!ids.has(userId)) ids.set(userId, MeetingParticipantRole.PARTICIPANT);
  }

  ids.set(input.hostUserId, MeetingParticipantRole.HOST);
  const participants: MeetingParticipantSeed[] = [];
  for (const [userId, meetingRole] of ids) {
    const participantKind = await staffKind(input.organizationId, userId);
    if (input.allowedBranchIds) {
      const targetBranches = await participantBranchIds(input.organizationId, userId);
      const required = input.meetingBranchId;
      if (required ? !targetBranches.includes(required) : !targetBranches.some(id => input.allowedBranchIds!.includes(id))) {
        throw new AppError(403, "MEETING_PARTICIPANT_BRANCH_FORBIDDEN", "Participant is outside your branch scope");
      }
    }
    participants.push({ userId, meetingRole, participantKind });
  }
  return participants;
}

export async function participantBranchIds(organizationId: string, userId: string) {
  const [teacher, employee, assigned] = await Promise.all([
    prisma.teacherProfile.findFirst({ where: { organizationId, userId }, select: { branchId: true } }),
    prisma.employee.findFirst({ where: { organizationId, userId }, select: { branchId: true } }),
    prisma.branchUser.findMany({ where: { organizationId, userId }, select: { branchId: true } }),
  ]);
  return [...new Set([teacher?.branchId, employee?.branchId, ...assigned.map(x => x.branchId)].filter((x): x is string => Boolean(x)))];
}

async function notificationChannels(organizationId: string, userId: string) {
  const preference = await prisma.notificationPreference.findFirst({ where: { organizationId, userId } });
  const channels = ["IN_APP"];
  if (preference?.email !== false) channels.push("EMAIL");
  if (preference?.push) channels.push("PUSH");
  if (preference?.sms) channels.push("SMS");
  if (preference?.whatsapp) channels.push("WHATSAPP");
  return channels;
}

function readableStart(startsAt: Date, timezone: string) {
  try {
    return new Intl.DateTimeFormat("en-IN", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(startsAt);
  } catch {
    return startsAt.toISOString();
  }
}

export async function scheduleMeetingNotifications(input: {
  organizationId: string;
  meetingId: string;
  title: string;
  startsAt: Date;
  timezone: string;
  participants: Array<{ id: string; userId: string }>;
  invitation?: boolean;
  seriesInvitation?: boolean;
}) {
  const now = new Date();
  for (const participant of input.participants) {
    const channels = await notificationChannels(input.organizationId, participant.userId);
    const create = async (kind: string, title: string, body: string, scheduledAt?: Date) => {
      if (scheduledAt && scheduledAt <= now) return;
      const exists = await prisma.meetingInvite.findUnique({
        where: { meetingId_participantId_kind: { meetingId: input.meetingId, participantId: participant.id, kind } },
        select: { id: true },
      });
      if (exists) return;
      const notification = await prisma.notification.create({
        data: {
          organizationId: input.organizationId,
          userId: participant.userId,
          title,
          body,
          category: "MEETING",
          sourceModule: "MEETINGS",
          sourceEntityId: input.meetingId,
          actionUrl: `/admin/meetings/${input.meetingId}`,
          priority: kind.startsWith("REMINDER_10") ? "HIGH" : "NORMAL",
          channels,
          scheduledAt,
        },
      });
      const deliveries = channels.filter(channel => channel !== "IN_APP");
      if (deliveries.length) await prisma.notificationDelivery.createMany({
        data: deliveries.map(channel => ({ organizationId: input.organizationId, notificationId: notification.id, channel, status: "QUEUED" })),
      });
      await prisma.meetingInvite.create({
        data: {
          organizationId: input.organizationId,
          meetingId: input.meetingId,
          participantId: participant.id,
          notificationId: notification.id,
          kind,
          scheduledAt,
          sentAt: scheduledAt ? null : now,
          status: scheduledAt ? "SCHEDULED" : "QUEUED",
        },
      });
    };

    if (input.invitation) {
      await create(input.seriesInvitation ? "SERIES_INVITATION" : "INVITATION", input.seriesInvitation ? `Recurring meeting: ${input.title}` : `Meeting invitation: ${input.title}`, `${input.title} · ${readableStart(input.startsAt,input.timezone)} (${input.timezone})`);
    }
    await create("REMINDER_1440", `Meeting tomorrow: ${input.title}`, `Starts at ${readableStart(input.startsAt,input.timezone)} (${input.timezone})`, new Date(input.startsAt.getTime()-24*60*60*1000));
    await create("REMINDER_60", `Meeting in 1 hour: ${input.title}`, `Starts at ${readableStart(input.startsAt,input.timezone)} (${input.timezone})`, new Date(input.startsAt.getTime()-60*60*1000));
    await create("REMINDER_10", `Meeting in 10 minutes: ${input.title}`, `Starts at ${readableStart(input.startsAt,input.timezone)} (${input.timezone})`, new Date(input.startsAt.getTime()-10*60*1000));
  }
  if (input.invitation) {
    await prisma.meetingParticipant.updateMany({
      where: { organizationId: input.organizationId, meetingId: input.meetingId },
      data: { invitationStatus: MeetingInvitationStatus.SENT, invitedAt: now },
    });
  }
}


export async function scheduleDueMeetingReminders(now = new Date()) {
  const horizon = new Date(now.getTime() + 25 * 60 * 60 * 1000);
  const meetings = await prisma.meeting.findMany({
    where: {
      status: { in: ["SCHEDULED", "OPEN_FOR_JOIN"] },
      startsAt: { gt: now, lte: horizon },
    },
    include: { participants: { where: { removedAt: null }, select: { id: true, userId: true } } },
    take: 250,
    orderBy: { startsAt: "asc" },
  });
  let processed = 0;
  for (const meeting of meetings) {
    await scheduleMeetingNotifications({
      organizationId: meeting.organizationId,
      meetingId: meeting.id,
      title: meeting.title,
      startsAt: meeting.startsAt,
      timezone: meeting.timezone,
      participants: meeting.participants,
      invitation: false,
    });
    processed += 1;
  }
  return { processed };
}

export async function invalidateFutureMeetingNotifications(organizationId: string, meetingId: string, now = new Date()) {
  const reminders = await prisma.meetingInvite.findMany({
    where: { organizationId, meetingId, kind: { startsWith: "REMINDER_" }, scheduledAt: { gt: now } },
    select: { id: true, notificationId: true },
  });
  const notificationIds = reminders.map(x => x.notificationId).filter((x): x is string => Boolean(x));
  if (notificationIds.length) {
    await prisma.notification.updateMany({
      where: { organizationId, id: { in: notificationIds } },
      data: { deletedAt: now },
    });
  }
  await prisma.meetingInvite.deleteMany({
    where: { organizationId, id: { in: reminders.map(x => x.id) } },
  });
}
