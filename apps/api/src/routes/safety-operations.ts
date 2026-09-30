import {
  EmergencyMode,
  PickupAuthorizationStatus,
  Prisma,
  Role,
  SafetyAccountabilityStatus,
  SafetyAcknowledgementResponse,
  SafetyBroadcastAudience,
  SafetyDrillStatus,
  SafetyIncidentStatus,
  SafetySubjectType,
  SafetyTaskStatus,
  SchoolEventSeverity,
  StudentStatus,
} from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import {
  assertErpBranchAccess,
  assertErpBranchTarget,
  erpBranchScope,
} from "../lib/erp-branch-access.js";
import { AppError } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { allow, requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);
const cuid = z.string().cuid();
const admins = [Role.SUPER_ADMIN, Role.BRANCH_ADMIN] as const;
const json = (value: unknown) => value as Prisma.InputJsonValue;

async function adminBranch(req: AuthRequest, branchId: string) {
  const scope = await erpBranchScope(req);
  await assertErpBranchTarget(scope, branchId);
  return scope;
}

async function scopedIncident(req: AuthRequest, incidentId: string) {
  const scope = await erpBranchScope(req);
  const incident = await prisma.safetyIncident.findFirst({
    where: { id: incidentId, organizationId: req.auth!.organizationId },
  });
  if (!incident) throw new AppError(404, "SAFETY_INCIDENT_NOT_FOUND", "Safety incident not found");
  assertErpBranchAccess(scope, incident.branchId);
  return incident;
}

async function parentBranchAccess(req: AuthRequest, branchId: string) {
  if (req.auth!.role !== Role.PARENT) throw new AppError(403, "PARENT_REQUIRED", "Parent account required");
  const link = await prisma.parentStudent.findFirst({
    where: {
      organizationId: req.auth!.organizationId,
      parentId: req.auth!.userId,
      student: { branchId, status: StudentStatus.ACTIVE, user: { isActive: true } },
    },
    select: { studentId: true },
  });
  if (!link) throw new AppError(403, "CHILD_ACCESS_DENIED", "No active linked child belongs to this branch");
}

async function recipientIds(organizationId: string, branchId: string, audience: SafetyBroadcastAudience) {
  const ids = new Set<string>();
  if (audience === SafetyBroadcastAudience.ALL || audience === SafetyBroadcastAudience.PARENTS) {
    const rows = await prisma.parentStudent.findMany({
      where: {
        organizationId,
        student: { branchId, status: StudentStatus.ACTIVE, user: { isActive: true } },
        parent: { isActive: true },
      },
      select: { parentId: true },
    });
    rows.forEach(row => ids.add(row.parentId));
  }
  if (audience === SafetyBroadcastAudience.ALL || audience === SafetyBroadcastAudience.STUDENTS) {
    const rows = await prisma.studentProfile.findMany({
      where: { organizationId, branchId, status: StudentStatus.ACTIVE, user: { isActive: true } },
      select: { userId: true },
    });
    rows.forEach(row => ids.add(row.userId));
  }
  if (audience === SafetyBroadcastAudience.ALL || audience === SafetyBroadcastAudience.STAFF) {
    const [teachers, employees, branchAdmins] = await Promise.all([
      prisma.teacherProfile.findMany({ where: { organizationId, branchId, user: { isActive: true } }, select: { userId: true } }),
      prisma.employee.findMany({ where: { organizationId, branchId, user: { isActive: true } }, select: { userId: true } }),
      prisma.branchUser.findMany({ where: { organizationId, branchId, user: { isActive: true } }, select: { userId: true } }),
    ]);
    [...teachers, ...employees, ...branchAdmins].forEach(row => ids.add(row.userId));
  }
  return [...ids];
}

function preferredChannels(requested: string[], preference: {
  email: boolean;
  sms: boolean;
  whatsapp: boolean;
  push: boolean;
} | null) {
  const channels = new Set<string>(["IN_APP"]);
  for (const channel of requested) {
    if (channel === "EMAIL" && preference?.email !== false) channels.add(channel);
    else if (channel === "SMS" && preference?.sms) channels.add(channel);
    else if (channel === "WHATSAPP" && preference?.whatsapp) channels.add(channel);
    else if (channel === "PUSH" && preference?.push) channels.add(channel);
  }
  return [...channels];
}

router.get("/connected-campus/safety/zones", allow(...admins), async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const branchId = req.query.branchId ? cuid.parse(req.query.branchId) : undefined;
  if (branchId) await assertErpBranchTarget(scope, branchId);
  const data = await prisma.campusZone.findMany({
    where: { organizationId: req.auth!.organizationId, branchId: { in: branchId ? [branchId] : scope } },
    orderBy: [{ branchId: "asc" }, { name: "asc" }],
  });
  res.json({ data });
});

router.post("/connected-campus/safety/zones", allow(...admins), async (req: AuthRequest, res) => {
  const body = z.object({
    branchId: cuid,
    code: z.string().trim().min(2).max(80).regex(/^[A-Za-z0-9._-]+$/),
    name: z.string().trim().min(2).max(180),
    type: z.string().trim().min(2).max(100),
    building: z.string().trim().max(180).nullable().optional(),
    floor: z.string().trim().max(80).nullable().optional(),
    capacity: z.number().int().positive().max(100000).nullable().optional(),
    geometry: z.record(z.string(), z.unknown()).optional(),
    isActive: z.boolean().default(true),
  }).parse(req.body);
  await adminBranch(req, body.branchId);
  try {
    const data = await prisma.campusZone.create({
      data: {
        organizationId: req.auth!.organizationId,
        ...body,
        code: body.code.toUpperCase(),
        building: body.building ?? null,
        floor: body.floor ?? null,
        capacity: body.capacity ?? null,
        geometry: body.geometry ? json(body.geometry) : undefined,
      },
    });
    res.status(201).json({ data });
  } catch (error: any) {
    if (error?.code === "P2002") throw new AppError(409, "CAMPUS_ZONE_EXISTS", "Campus zone code already exists in this branch");
    throw error;
  }
});

router.post("/connected-campus/safety/broadcasts", allow(...admins), async (req: AuthRequest, res) => {
  const body = z.object({
    branchId: cuid,
    incidentId: cuid.nullable().optional(),
    audience: z.nativeEnum(SafetyBroadcastAudience),
    title: z.string().trim().min(3).max(180),
    message: z.string().trim().min(3).max(5000),
    channels: z.array(z.enum(["IN_APP","EMAIL","SMS","WHATSAPP","PUSH"])).min(1).max(5).default(["IN_APP"]),
    requiresAcknowledgement: z.boolean().default(true),
    expiresAt: z.coerce.date().nullable().optional(),
  }).parse(req.body);
  await adminBranch(req, body.branchId);
  if (body.incidentId) {
    const incident = await prisma.safetyIncident.findFirst({
      where: { id: body.incidentId, organizationId: req.auth!.organizationId, branchId: body.branchId },
      select: { id: true },
    });
    if (!incident) throw new AppError(422, "SAFETY_BROADCAST_INCIDENT_INVALID", "Safety incident does not belong to this branch");
  }
  const recipients = await recipientIds(req.auth!.organizationId, body.branchId, body.audience);
  const preferences = recipients.length ? await prisma.notificationPreference.findMany({
    where: { organizationId: req.auth!.organizationId, userId: { in: recipients } },
    select: { userId: true, email: true, sms: true, whatsapp: true, push: true },
  }) : [];
  const preferenceMap = new Map(preferences.map(item => [item.userId, item]));

  const result = await prisma.$transaction(async tx => {
    const broadcast = await tx.safetyBroadcast.create({
      data: {
        organizationId: req.auth!.organizationId,
        branchId: body.branchId,
        incidentId: body.incidentId ?? null,
        audience: body.audience,
        title: body.title,
        message: body.message,
        channels: [...new Set(body.channels)],
        requiresAcknowledgement: body.requiresAcknowledgement,
        createdById: req.auth!.userId,
        expiresAt: body.expiresAt ?? null,
      },
    });
    let deliveries = 0;
    for (const userId of recipients) {
      const channels = preferredChannels(body.channels, preferenceMap.get(userId) ?? null);
      const notification = await tx.notification.create({
        data: {
          organizationId: req.auth!.organizationId,
          userId,
          title: body.title,
          body: body.message,
          category: "SAFETY",
          sourceModule: "SAFETY_BROADCAST",
          sourceEntityId: broadcast.id,
          actionUrl: "/portal",
          priority: "URGENT",
          channels,
          expiresAt: body.expiresAt ?? null,
        },
      });
      const external = channels.filter(channel => channel !== "IN_APP");
      if (external.length) {
        await tx.notificationDelivery.createMany({
          data: external.map(channel => ({
            organizationId: req.auth!.organizationId,
            notificationId: notification.id,
            channel,
            status: "QUEUED",
          })),
        });
        deliveries += external.length;
      }
    }
    return { broadcast, recipientCount: recipients.length, externalDeliveries: deliveries };
  });
  await prisma.auditLog.create({
    data: {
      organizationId: req.auth!.organizationId,
      actorId: req.auth!.userId,
      action: "SAFETY_BROADCAST_SENT",
      entity: "SafetyBroadcast",
      entityId: result.broadcast.id,
      metadata: { branchId: body.branchId, audience: body.audience, recipients: result.recipientCount, channels: body.channels },
    },
  });
  res.status(201).json({ data: result });
});

router.get("/connected-campus/safety/broadcasts/:broadcastId/acknowledgements", allow(...admins), async (req: AuthRequest, res) => {
  const broadcast = await prisma.safetyBroadcast.findFirst({
    where: { id: cuid.parse(req.params.broadcastId), organizationId: req.auth!.organizationId },
  });
  if (!broadcast) throw new AppError(404, "SAFETY_BROADCAST_NOT_FOUND", "Safety broadcast not found");
  await adminBranch(req, broadcast.branchId);
  const data = await prisma.safetyBroadcastAcknowledgement.findMany({
    where: { organizationId: req.auth!.organizationId, broadcastId: broadcast.id },
    orderBy: { acknowledgedAt: "desc" },
  });
  res.json({ data });
});

router.get("/connected-campus/parent/emergency-alerts", allow(Role.PARENT), async (req: AuthRequest, res) => {
  const links = await prisma.parentStudent.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      parentId: req.auth!.userId,
      student: { status: StudentStatus.ACTIVE, user: { isActive: true } },
    },
    select: { student: { select: { id: true, branchId: true } } },
  });
  const branches = [...new Set(links.map(link => link.student.branchId))];
  if (!branches.length) return res.json({ data: { incidents: [], broadcasts: [] } });
  const [incidents, broadcasts, incidentAcks, broadcastAcks] = await Promise.all([
    prisma.safetyIncident.findMany({
      where: {
        organizationId: req.auth!.organizationId,
        branchId: { in: branches },
        status: { in: [SafetyIncidentStatus.OPEN, SafetyIncidentStatus.ACKNOWLEDGED, SafetyIncidentStatus.ACTIVE_RESPONSE] },
      },
      orderBy: { occurredAt: "desc" },
      take: 100,
    }),
    prisma.safetyBroadcast.findMany({
      where: {
        organizationId: req.auth!.organizationId,
        branchId: { in: branches },
        audience: { in: [SafetyBroadcastAudience.ALL, SafetyBroadcastAudience.PARENTS] },
        OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
      },
      orderBy: { sentAt: "desc" },
      take: 100,
    }),
    prisma.safetyIncidentAcknowledgement.findMany({
      where: { organizationId: req.auth!.organizationId, userId: req.auth!.userId },
    }),
    prisma.safetyBroadcastAcknowledgement.findMany({
      where: { organizationId: req.auth!.organizationId, userId: req.auth!.userId },
    }),
  ]);
  const incidentAck = new Map(incidentAcks.map(item => [item.incidentId, item]));
  const broadcastAck = new Map(broadcastAcks.map(item => [item.broadcastId, item]));
  res.json({
    data: {
      incidents: incidents.map(item => ({ ...item, acknowledgement: incidentAck.get(item.id) ?? null })),
      broadcasts: broadcasts.map(item => ({ ...item, acknowledgement: broadcastAck.get(item.id) ?? null })),
    },
  });
});

router.post("/connected-campus/parent/emergency-incidents/:incidentId/acknowledge", allow(Role.PARENT), async (req: AuthRequest, res) => {
  const incident = await prisma.safetyIncident.findFirst({
    where: { id: cuid.parse(req.params.incidentId), organizationId: req.auth!.organizationId },
  });
  if (!incident) throw new AppError(404, "SAFETY_INCIDENT_NOT_FOUND", "Safety incident not found");
  await parentBranchAccess(req, incident.branchId);
  const body = z.object({
    response: z.nativeEnum(SafetyAcknowledgementResponse).default(SafetyAcknowledgementResponse.ACKNOWLEDGED),
    message: z.string().trim().max(1000).optional(),
  }).parse(req.body);
  const data = await prisma.safetyIncidentAcknowledgement.upsert({
    where: { incidentId_userId: { incidentId: incident.id, userId: req.auth!.userId } },
    create: {
      organizationId: req.auth!.organizationId,
      incidentId: incident.id,
      userId: req.auth!.userId,
      response: body.response,
      message: body.message ?? null,
    },
    update: { response: body.response, message: body.message ?? null, acknowledgedAt: new Date() },
  });
  res.json({ data });
});

router.post("/connected-campus/parent/emergency-broadcasts/:broadcastId/acknowledge", allow(Role.PARENT), async (req: AuthRequest, res) => {
  const broadcast = await prisma.safetyBroadcast.findFirst({
    where: { id: cuid.parse(req.params.broadcastId), organizationId: req.auth!.organizationId },
  });
  if (!broadcast) throw new AppError(404, "SAFETY_BROADCAST_NOT_FOUND", "Safety broadcast not found");
  await parentBranchAccess(req, broadcast.branchId);
  const body = z.object({
    response: z.nativeEnum(SafetyAcknowledgementResponse).default(SafetyAcknowledgementResponse.ACKNOWLEDGED),
    message: z.string().trim().max(1000).optional(),
  }).parse(req.body);
  const data = await prisma.safetyBroadcastAcknowledgement.upsert({
    where: { broadcastId_userId: { broadcastId: broadcast.id, userId: req.auth!.userId } },
    create: {
      organizationId: req.auth!.organizationId,
      broadcastId: broadcast.id,
      userId: req.auth!.userId,
      response: body.response,
      message: body.message ?? null,
    },
    update: { response: body.response, message: body.message ?? null, acknowledgedAt: new Date() },
  });
  res.json({ data });
});

router.get("/connected-campus/safety/drills", allow(...admins), async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const data = await prisma.safetyDrill.findMany({
    where: { organizationId: req.auth!.organizationId, branchId: { in: scope } },
    orderBy: { scheduledAt: "desc" },
    take: 200,
  });
  res.json({ data });
});

router.post("/connected-campus/safety/drills", allow(...admins), async (req: AuthRequest, res) => {
  const body = z.object({
    branchId: cuid,
    name: z.string().trim().min(3).max(180),
    type: z.string().trim().min(2).max(100),
    scenario: z.string().trim().max(5000).optional(),
    scheduledAt: z.coerce.date(),
    notes: z.string().trim().max(5000).optional(),
  }).parse(req.body);
  await adminBranch(req, body.branchId);
  const data = await prisma.safetyDrill.create({
    data: {
      organizationId: req.auth!.organizationId,
      ...body,
      scenario: body.scenario ?? null,
      notes: body.notes ?? null,
      createdById: req.auth!.userId,
    },
  });
  res.status(201).json({ data });
});

router.patch("/connected-campus/safety/drills/:drillId", allow(...admins), async (req: AuthRequest, res) => {
  const drill = await prisma.safetyDrill.findFirst({
    where: { id: cuid.parse(req.params.drillId), organizationId: req.auth!.organizationId },
  });
  if (!drill) throw new AppError(404, "SAFETY_DRILL_NOT_FOUND", "Safety drill not found");
  await adminBranch(req, drill.branchId);
  const body = z.object({
    status: z.nativeEnum(SafetyDrillStatus),
    notes: z.string().trim().max(5000).optional(),
  }).parse(req.body);
  const now = new Date();
  const data = await prisma.safetyDrill.update({
    where: { id: drill.id },
    data: {
      status: body.status,
      notes: body.notes ?? drill.notes,
      ...(body.status === SafetyDrillStatus.ACTIVE ? { startedAt: drill.startedAt ?? now } : {}),
      ...(body.status === SafetyDrillStatus.COMPLETED ? { completedAt: now } : {}),
    },
  });
  res.json({ data });
});

router.get("/connected-campus/safety/incidents/:incidentId/tasks", allow(...admins), async (req: AuthRequest, res) => {
  const incident = await scopedIncident(req, cuid.parse(req.params.incidentId));
  const data = await prisma.safetyTask.findMany({
    where: { organizationId: req.auth!.organizationId, incidentId: incident.id },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "asc" }],
  });
  res.json({ data });
});

router.post("/connected-campus/safety/incidents/:incidentId/tasks", allow(...admins), async (req: AuthRequest, res) => {
  const incident = await scopedIncident(req, cuid.parse(req.params.incidentId));
  const body = z.object({
    title: z.string().trim().min(3).max(240),
    description: z.string().trim().max(5000).optional(),
    priority: z.nativeEnum(SchoolEventSeverity).default(SchoolEventSeverity.MEDIUM),
    assignedToId: cuid.nullable().optional(),
    dueAt: z.coerce.date().nullable().optional(),
  }).parse(req.body);
  if (body.assignedToId) {
    const user = await prisma.user.findFirst({ where: { id: body.assignedToId, organizationId: req.auth!.organizationId, isActive: true }, select: { id: true } });
    if (!user) throw new AppError(422, "SAFETY_TASK_ASSIGNEE_INVALID", "Task assignee is not an active organization user");
  }
  const data = await prisma.safetyTask.create({
    data: {
      organizationId: req.auth!.organizationId,
      incidentId: incident.id,
      title: body.title,
      description: body.description ?? null,
      priority: body.priority,
      assignedToId: body.assignedToId ?? null,
      dueAt: body.dueAt ?? null,
      createdById: req.auth!.userId,
    },
  });
  res.status(201).json({ data });
});

router.patch("/connected-campus/safety/tasks/:taskId", allow(...admins), async (req: AuthRequest, res) => {
  const task = await prisma.safetyTask.findFirst({
    where: { id: cuid.parse(req.params.taskId), organizationId: req.auth!.organizationId },
    include: { incident: { select: { branchId: true } } },
  });
  if (!task) throw new AppError(404, "SAFETY_TASK_NOT_FOUND", "Safety task not found");
  await adminBranch(req, task.incident.branchId);
  const body = z.object({
    status: z.nativeEnum(SafetyTaskStatus),
  }).parse(req.body);
  const data = await prisma.safetyTask.update({
    where: { id: task.id },
    data: {
      status: body.status,
      ...(body.status === SafetyTaskStatus.COMPLETED ? { completedAt: new Date(), completedById: req.auth!.userId } : {}),
    },
  });
  res.json({ data });
});

router.get("/connected-campus/safety/incidents/:incidentId/accountability", allow(...admins), async (req: AuthRequest, res) => {
  const incident = await scopedIncident(req, cuid.parse(req.params.incidentId));
  const data = await prisma.safetyAccountability.findMany({
    where: { organizationId: req.auth!.organizationId, incidentId: incident.id },
    orderBy: [{ subjectType: "asc" }, { status: "asc" }],
  });
  res.json({ data });
});

router.put("/connected-campus/safety/incidents/:incidentId/accountability", allow(...admins), async (req: AuthRequest, res) => {
  const incident = await scopedIncident(req, cuid.parse(req.params.incidentId));
  const body = z.object({
    subjectType: z.nativeEnum(SafetySubjectType),
    subjectId: cuid,
    status: z.nativeEnum(SafetyAccountabilityStatus),
    zoneId: cuid.nullable().optional(),
    lastSeenAt: z.coerce.date().nullable().optional(),
    notes: z.string().trim().max(5000).optional(),
  }).parse(req.body);
  if (body.zoneId) {
    const zone = await prisma.campusZone.findFirst({
      where: { id: body.zoneId, organizationId: req.auth!.organizationId, branchId: incident.branchId, isActive: true },
      select: { id: true },
    });
    if (!zone) throw new AppError(422, "SAFETY_ZONE_INVALID", "Accountability zone is not active in this incident branch");
  }
  if (body.subjectType === SafetySubjectType.STUDENT) {
    const subject = await prisma.studentProfile.findFirst({ where: { id: body.subjectId, organizationId: req.auth!.organizationId, branchId: incident.branchId }, select: { id: true } });
    if (!subject) throw new AppError(422, "SAFETY_SUBJECT_INVALID", "Student is not in this incident branch");
  } else if (body.subjectType === SafetySubjectType.EMPLOYEE) {
    const subject = await prisma.employee.findFirst({ where: { id: body.subjectId, organizationId: req.auth!.organizationId, branchId: incident.branchId }, select: { id: true } });
    if (!subject) throw new AppError(422, "SAFETY_SUBJECT_INVALID", "Employee is not in this incident branch");
  } else {
    const subject = await prisma.campusVisitor.findFirst({ where: { id: body.subjectId, organizationId: req.auth!.organizationId, branchId: incident.branchId }, select: { id: true } });
    if (!subject) throw new AppError(422, "SAFETY_SUBJECT_INVALID", "Visitor is not in this incident branch");
  }
  const data = await prisma.safetyAccountability.upsert({
    where: {
      incidentId_subjectType_subjectId: {
        incidentId: incident.id,
        subjectType: body.subjectType,
        subjectId: body.subjectId,
      },
    },
    create: {
      organizationId: req.auth!.organizationId,
      incidentId: incident.id,
      subjectType: body.subjectType,
      subjectId: body.subjectId,
      status: body.status,
      zoneId: body.zoneId ?? null,
      lastSeenAt: body.lastSeenAt ?? null,
      recordedById: req.auth!.userId,
      notes: body.notes ?? null,
    },
    update: {
      status: body.status,
      zoneId: body.zoneId ?? null,
      lastSeenAt: body.lastSeenAt ?? null,
      recordedById: req.auth!.userId,
      notes: body.notes ?? null,
    },
  });
  res.json({ data });
});

router.post("/connected-campus/safety/incidents/:incidentId/reunify", allow(...admins), async (req: AuthRequest, res) => {
  const incident = await scopedIncident(req, cuid.parse(req.params.incidentId));
  const body = z.object({
    studentId: cuid,
    authorizationId: cuid.nullable().optional(),
    guardianName: z.string().trim().min(2).max(180),
    guardianPhone: z.string().trim().max(30).optional(),
    relationship: z.string().trim().max(80).optional(),
    notes: z.string().trim().max(5000).optional(),
  }).parse(req.body);
  const student = await prisma.studentProfile.findFirst({
    where: { id: body.studentId, organizationId: req.auth!.organizationId, branchId: incident.branchId, status: StudentStatus.ACTIVE },
    select: { id: true },
  });
  if (!student) throw new AppError(422, "REUNIFICATION_STUDENT_INVALID", "Student is not active in this incident branch");
  if (body.authorizationId) {
    const authorization = await prisma.pickupAuthorization.findFirst({
      where: {
        id: body.authorizationId,
        organizationId: req.auth!.organizationId,
        studentId: student.id,
        status: { in: [PickupAuthorizationStatus.ACTIVE, PickupAuthorizationStatus.USED] },
      },
      select: { id: true, guardianName: true, validUntil: true },
    });
    if (!authorization || authorization.validUntil < new Date()) {
      throw new AppError(422, "REUNIFICATION_AUTHORIZATION_INVALID", "Pickup authorization is not valid for reunification");
    }
  }
  try {
    const data = await prisma.$transaction(async tx => {
      const record = await tx.safetyReunificationRecord.create({
        data: {
          organizationId: req.auth!.organizationId,
          incidentId: incident.id,
          studentId: student.id,
          authorizationId: body.authorizationId ?? null,
          guardianName: body.guardianName,
          guardianPhone: body.guardianPhone ?? null,
          relationship: body.relationship ?? null,
          verifiedById: req.auth!.userId,
          notes: body.notes ?? null,
        },
      });
      await tx.safetyAccountability.upsert({
        where: {
          incidentId_subjectType_subjectId: {
            incidentId: incident.id,
            subjectType: SafetySubjectType.STUDENT,
            subjectId: student.id,
          },
        },
        create: {
          organizationId: req.auth!.organizationId,
          incidentId: incident.id,
          subjectType: SafetySubjectType.STUDENT,
          subjectId: student.id,
          status: SafetyAccountabilityStatus.REUNIFIED,
          recordedById: req.auth!.userId,
          lastSeenAt: record.releasedAt,
        },
        update: {
          status: SafetyAccountabilityStatus.REUNIFIED,
          recordedById: req.auth!.userId,
          lastSeenAt: record.releasedAt,
        },
      });
      return record;
    });
    res.status(201).json({ data });
  } catch (error: any) {
    if (error?.code === "P2002") throw new AppError(409, "STUDENT_ALREADY_REUNIFIED", "Student has already been reunified for this incident");
    throw error;
  }
});

export default router;
