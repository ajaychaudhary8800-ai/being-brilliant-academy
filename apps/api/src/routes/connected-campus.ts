import {
  CampusVisitorStatus,
  CampusVisitorType,
  PickupAuthorizationStatus,
  PickupGateDecision,
  Prisma,
  Role,
  SchoolEventCategory,
  SchoolEventSeverity,
  SchoolEventStatus,
  TransportRideCancellationScope,
  TransportStatus,
  TripStatus,
} from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import {
  generatePickupCredentials,
  generateVisitorBadgeCode,
  hashPickupQrToken,
  verifyPickupOtp,
  verifyPickupQrToken,
} from "../lib/connected-campus-credentials.js";
import {
  assertErpBranchAccess,
  assertErpBranchTarget,
  erpBranchScope,
} from "../lib/erp-branch-access.js";
import { AppError } from "../lib/http.js";
import { institutionCalendarDate, parseDateOnly } from "../lib/institution-time.js";
import { prisma } from "../lib/prisma.js";
import { allow, requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);
const cuid = z.string().cuid();
const adminRoles = [Role.SUPER_ADMIN, Role.BRANCH_ADMIN] as const;

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function isAdmin(req: AuthRequest) {
  return req.auth!.role === Role.SUPER_ADMIN || req.auth!.role === Role.BRANCH_ADMIN;
}

async function assertAdminBranch(req: AuthRequest, branchId: string) {
  if (!isAdmin(req)) throw new AppError(403, "CONNECTED_CAMPUS_ADMIN_REQUIRED", "Connected Campus branch administration requires an administrator");
  const scope = await erpBranchScope(req);
  await assertErpBranchTarget(scope, branchId);
  return scope;
}

async function linkedChild(req: AuthRequest, studentId: string) {
  if (req.auth!.role !== Role.PARENT) {
    throw new AppError(403, "PARENT_REQUIRED", "This action is available to parent accounts");
  }
  const link = await prisma.parentStudent.findFirst({
    where: {
      organizationId: req.auth!.organizationId,
      parentId: req.auth!.userId,
      studentId,
      student: { status: "ACTIVE", user: { isActive: true } },
    },
    include: {
      student: {
        select: {
          id: true,
          userId: true,
          branchId: true,
          batchId: true,
          admissionNo: true,
          className: true,
          parentMobile: true,
          user: { select: { name: true } },
        },
      },
    },
  });
  if (!link) throw new AppError(403, "CHILD_ACCESS_DENIED", "This active student is not linked to your parent account");
  return link;
}

async function currentOrganizationDate(organizationId: string, instant = new Date()) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true },
  });
  if (!organization) throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Organization not found");
  return parseDateOnly(institutionCalendarDate(instant, organization.timezone));
}

async function assertVisitorHost(req: AuthRequest, visitor: { hostUserId: string | null; branchId: string }) {
  if (isAdmin(req)) {
    const scope = await erpBranchScope(req);
    assertErpBranchAccess(scope, visitor.branchId);
    return;
  }
  if (![Role.TEACHER, Role.EMPLOYEE].includes(req.auth!.role)) {
    throw new AppError(403, "VISITOR_HOST_FORBIDDEN", "Only the assigned host or an administrator may approve visitors");
  }
  if (visitor.hostUserId !== req.auth!.userId) {
    throw new AppError(403, "VISITOR_HOST_FORBIDDEN", "This visitor is assigned to another host");
  }
}

async function validateHost(organizationId: string, branchId: string, hostUserId: string) {
  const host = await prisma.user.findFirst({
    where: { id: hostUserId, organizationId, isActive: true },
    include: {
      teacherProfile: { select: { branchId: true } },
      employee: { select: { branchId: true } },
      branchAssignments: { select: { branchId: true } },
    },
  });
  if (!host) throw new AppError(422, "VISITOR_HOST_INVALID", "Visitor host account not found");
  if (host.role === Role.SUPER_ADMIN) return host;
  const allowed = host.teacherProfile?.branchId === branchId
    || host.employee?.branchId === branchId
    || host.branchAssignments.some(item => item.branchId === branchId);
  if (!allowed) throw new AppError(422, "VISITOR_HOST_BRANCH_MISMATCH", "Visitor host is not assigned to this branch");
  return host;
}

const visitorCreate = z.object({
  branchId: cuid,
  type: z.nativeEnum(CampusVisitorType).default(CampusVisitorType.VISITOR),
  fullName: z.string().trim().min(2).max(180),
  phone: z.string().trim().min(7).max(30),
  email: z.string().trim().email().max(240).nullable().optional(),
  company: z.string().trim().max(240).nullable().optional(),
  hostUserId: cuid.nullable().optional(),
  purpose: z.string().trim().min(3).max(5000),
  vehicleNumber: z.string().trim().max(50).nullable().optional(),
  idProofType: z.string().trim().max(80).nullable().optional(),
  idProofLast4: z.string().trim().min(2).max(8).nullable().optional(),
  validFrom: z.coerce.date().optional(),
  validUntil: z.coerce.date().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).superRefine((value, ctx) => {
  if ((value.validFrom && !value.validUntil) || (!value.validFrom && value.validUntil)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["validUntil"], message: "Visitor validity requires both start and end" });
  }
  if (value.validFrom && value.validUntil && value.validUntil <= value.validFrom) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["validUntil"], message: "Visitor validity end must be after start" });
  }
  if (value.validFrom && value.validUntil && value.validUntil.getTime() - value.validFrom.getTime() > 30 * 24 * 60 * 60 * 1000) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["validUntil"], message: "Visitor pre-registration cannot exceed 30 days" });
  }
});

router.get("/connected-campus/visitors", allow(...adminRoles), async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const q = z.object({
    branchId: cuid.optional(),
    status: z.nativeEnum(CampusVisitorStatus).optional(),
    type: z.nativeEnum(CampusVisitorType).optional(),
    hostUserId: cuid.optional(),
    search: z.string().trim().max(100).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  }).parse(req.query);
  if (q.branchId) await assertErpBranchTarget(scope, q.branchId);
  const data = await prisma.campusVisitor.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      branchId: { in: q.branchId ? [q.branchId] : scope },
      ...(q.status ? { status: q.status } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.hostUserId ? { hostUserId: q.hostUserId } : {}),
      ...(q.search ? {
        OR: [
          { fullName: { contains: q.search, mode: "insensitive" } },
          { phone: { contains: q.search, mode: "insensitive" } },
          { company: { contains: q.search, mode: "insensitive" } },
          { badgeCode: { contains: q.search, mode: "insensitive" } },
        ],
      } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: q.limit,
  });
  res.json({ data });
});

router.get("/connected-campus/host-visitors", allow(Role.TEACHER, Role.EMPLOYEE, Role.SUPER_ADMIN, Role.BRANCH_ADMIN), async (req: AuthRequest, res) => {
  if (isAdmin(req)) {
    const scope = await erpBranchScope(req);
    const data = await prisma.campusVisitor.findMany({
      where: { organizationId: req.auth!.organizationId, branchId: { in: scope }, status: { in: [CampusVisitorStatus.PENDING_APPROVAL, CampusVisitorStatus.APPROVED] } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return res.json({ data });
  }
  const data = await prisma.campusVisitor.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      hostUserId: req.auth!.userId,
      status: { in: [CampusVisitorStatus.PENDING_APPROVAL, CampusVisitorStatus.APPROVED] },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json({ data });
});

router.post("/connected-campus/visitors", allow(...adminRoles), async (req: AuthRequest, res) => {
  const body = visitorCreate.parse(req.body);
  await assertAdminBranch(req, body.branchId);
  if (body.hostUserId) await validateHost(req.auth!.organizationId, body.branchId, body.hostUserId);
  const now = new Date();
  const status = body.hostUserId ? CampusVisitorStatus.PENDING_APPROVAL : CampusVisitorStatus.PRE_REGISTERED;
  const data = await prisma.campusVisitor.create({
    data: {
      organizationId: req.auth!.organizationId,
      branchId: body.branchId,
      type: body.type,
      fullName: body.fullName,
      phone: body.phone,
      email: body.email ?? null,
      company: body.company ?? null,
      hostUserId: body.hostUserId ?? null,
      purpose: body.purpose,
      vehicleNumber: body.vehicleNumber ?? null,
      idProofType: body.idProofType ?? null,
      idProofLast4: body.idProofLast4 ?? null,
      status,
      validFrom: body.validFrom ?? now,
      validUntil: body.validUntil ?? new Date(now.getTime() + 24 * 60 * 60 * 1000),
      preRegisteredById: req.auth!.userId,
      metadata: body.metadata ? json(body.metadata) : undefined,
    },
  });
  await prisma.auditLog.create({
    data: {
      organizationId: req.auth!.organizationId,
      actorId: req.auth!.userId,
      action: "CAMPUS_VISITOR_PRE_REGISTERED",
      entity: "CampusVisitor",
      entityId: data.id,
      metadata: { branchId: data.branchId, type: data.type, hostUserId: data.hostUserId },
    },
  });
  res.status(201).json({ data });
});

router.post("/connected-campus/visitors/:visitorId/decision", allow(Role.TEACHER, Role.EMPLOYEE, Role.SUPER_ADMIN, Role.BRANCH_ADMIN), async (req: AuthRequest, res) => {
  const visitor = await prisma.campusVisitor.findFirst({
    where: { id: cuid.parse(req.params.visitorId), organizationId: req.auth!.organizationId },
  });
  if (!visitor) throw new AppError(404, "VISITOR_NOT_FOUND", "Visitor pre-registration not found");
  await assertVisitorHost(req, visitor);
  if (![CampusVisitorStatus.PENDING_APPROVAL, CampusVisitorStatus.PRE_REGISTERED].includes(visitor.status)) {
    throw new AppError(409, "VISITOR_DECISION_LOCKED", "Visitor has already been processed");
  }
  const body = z.object({
    decision: z.enum(["APPROVE", "DENY"]),
    reason: z.string().trim().min(3).max(5000).optional(),
  }).parse(req.body);
  if (body.decision === "DENY" && !body.reason) throw new AppError(422, "VISITOR_DENIAL_REASON_REQUIRED", "Denied visitors require a reason");
  const now = new Date();
  const badgeCode = body.decision === "APPROVE" ? generateVisitorBadgeCode() : null;
  const data = await prisma.campusVisitor.update({
    where: { id: visitor.id },
    data: body.decision === "APPROVE"
      ? {
          status: CampusVisitorStatus.APPROVED,
          approvedById: req.auth!.userId,
          approvedAt: now,
          badgeCode,
          deniedById: null,
          deniedAt: null,
          denialReason: null,
        }
      : {
          status: CampusVisitorStatus.DENIED,
          deniedById: req.auth!.userId,
          deniedAt: now,
          denialReason: body.reason,
        },
  });
  await prisma.auditLog.create({
    data: {
      organizationId: req.auth!.organizationId,
      actorId: req.auth!.userId,
      action: body.decision === "APPROVE" ? "CAMPUS_VISITOR_APPROVED" : "CAMPUS_VISITOR_DENIED",
      entity: "CampusVisitor",
      entityId: visitor.id,
      metadata: { branchId: visitor.branchId },
    },
  });
  res.json({ data });
});

router.post("/connected-campus/visitors/:visitorId/check-in", allow(...adminRoles), async (req: AuthRequest, res) => {
  const visitor = await prisma.campusVisitor.findFirst({
    where: { id: cuid.parse(req.params.visitorId), organizationId: req.auth!.organizationId },
  });
  if (!visitor) throw new AppError(404, "VISITOR_NOT_FOUND", "Visitor not found");
  await assertAdminBranch(req, visitor.branchId);
  if (![CampusVisitorStatus.APPROVED, CampusVisitorStatus.PRE_REGISTERED].includes(visitor.status)) {
    throw new AppError(409, "VISITOR_CHECKIN_NOT_ALLOWED", "Visitor is not approved for check-in");
  }
  const now = new Date();
  if ((visitor.validFrom && now < visitor.validFrom) || (visitor.validUntil && now > visitor.validUntil)) {
    await prisma.campusVisitor.update({ where: { id: visitor.id }, data: { status: CampusVisitorStatus.EXPIRED } });
    throw new AppError(409, "VISITOR_AUTHORIZATION_EXPIRED", "Visitor authorization is outside its validity window");
  }
  const badgeCode = visitor.badgeCode ?? generateVisitorBadgeCode();
  const data = await prisma.$transaction(async tx => {
    const updated = await tx.campusVisitor.update({
      where: { id: visitor.id },
      data: { status: CampusVisitorStatus.CHECKED_IN, checkedInAt: now, badgeCode },
    });
    await tx.schoolEvent.create({
      data: {
        organizationId: req.auth!.organizationId,
        branchId: visitor.branchId,
        category: SchoolEventCategory.VISITOR,
        type: "VISITOR_CHECK_IN",
        severity: SchoolEventSeverity.INFO,
        status: SchoolEventStatus.RECORDED,
        occurredAt: now,
        sourceType: "CAMPUS_VISITOR",
        sourceId: `${visitor.id}:check-in`,
        correlationKey: `visitor:${visitor.id}`,
        title: `${visitor.fullName} checked in`,
        metadata: json({ visitorId: visitor.id, visitorType: visitor.type, badgeCode }),
      },
    });
    return updated;
  });
  res.json({ data });
});

router.post("/connected-campus/visitors/:visitorId/check-out", allow(...adminRoles), async (req: AuthRequest, res) => {
  const visitor = await prisma.campusVisitor.findFirst({
    where: { id: cuid.parse(req.params.visitorId), organizationId: req.auth!.organizationId },
  });
  if (!visitor) throw new AppError(404, "VISITOR_NOT_FOUND", "Visitor not found");
  await assertAdminBranch(req, visitor.branchId);
  if (visitor.status !== CampusVisitorStatus.CHECKED_IN) throw new AppError(409, "VISITOR_NOT_CHECKED_IN", "Only checked-in visitors can check out");
  const now = new Date();
  const data = await prisma.$transaction(async tx => {
    const updated = await tx.campusVisitor.update({
      where: { id: visitor.id },
      data: { status: CampusVisitorStatus.CHECKED_OUT, checkedOutAt: now },
    });
    await tx.schoolEvent.create({
      data: {
        organizationId: req.auth!.organizationId,
        branchId: visitor.branchId,
        category: SchoolEventCategory.VISITOR,
        type: "VISITOR_CHECK_OUT",
        severity: SchoolEventSeverity.INFO,
        occurredAt: now,
        sourceType: "CAMPUS_VISITOR",
        sourceId: `${visitor.id}:check-out`,
        correlationKey: `visitor:${visitor.id}`,
        title: `${visitor.fullName} checked out`,
        metadata: json({ visitorId: visitor.id, visitorType: visitor.type }),
      },
    });
    return updated;
  });
  res.json({ data });
});

router.get("/connected-campus/parent/children", allow(Role.PARENT), async (req: AuthRequest, res) => {
  const links = await prisma.parentStudent.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      parentId: req.auth!.userId,
      student: { status: "ACTIVE", user: { isActive: true } },
    },
    include: {
      student: {
        include: {
          user: { select: { name: true, avatarUrl: true } },
          branch: { select: { id: true, name: true } },
          batch: { select: { id: true, name: true, code: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  res.json({ data: links });
});

const pickupInput = z.object({
  studentId: cuid,
  guardianName: z.string().trim().min(2).max(180),
  guardianPhone: z.string().trim().min(7).max(30),
  relationship: z.string().trim().min(2).max(80),
  validFrom: z.coerce.date().optional(),
  validUntil: z.coerce.date(),
  useLimit: z.number().int().min(1).max(10).default(1),
  notes: z.string().trim().max(5000).optional(),
});

router.get("/connected-campus/parent/pickups", allow(Role.PARENT), async (req: AuthRequest, res) => {
  const data = await prisma.pickupAuthorization.findMany({
    where: { organizationId: req.auth!.organizationId, parentId: req.auth!.userId },
    include: { student: { select: { id: true, admissionNo: true, className: true, user: { select: { name: true } } } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json({
    data: data.map(item => ({ ...item, qrTokenHash: undefined, otpHash: undefined })),
  });
});

router.post("/connected-campus/parent/pickups", allow(Role.PARENT), async (req: AuthRequest, res) => {
  const body = pickupInput.parse(req.body);
  const link = await linkedChild(req, body.studentId);
  const now = new Date();
  const validFrom = body.validFrom ?? now;
  if (body.validUntil <= validFrom) throw new AppError(422, "PICKUP_VALIDITY_INVALID", "Pickup authorization end must be after its start");
  if (body.validUntil.getTime() - validFrom.getTime() > 7 * 24 * 60 * 60 * 1000) {
    throw new AppError(422, "PICKUP_VALIDITY_TOO_LONG", "Pickup authorization cannot exceed seven days");
  }
  const credentials = generatePickupCredentials();
  const data = await prisma.pickupAuthorization.create({
    data: {
      organizationId: req.auth!.organizationId,
      parentId: req.auth!.userId,
      studentId: link.student.id,
      guardianName: body.guardianName,
      guardianPhone: body.guardianPhone,
      relationship: body.relationship,
      validFrom,
      validUntil: body.validUntil,
      qrTokenHash: credentials.qrTokenHash,
      otpHash: credentials.otpHash,
      useLimit: body.useLimit,
      createdById: req.auth!.userId,
      notes: body.notes ?? null,
    },
    select: {
      id: true, organizationId: true, parentId: true, studentId: true, guardianName: true, guardianPhone: true,
      relationship: true, validFrom: true, validUntil: true, status: true, useLimit: true, usedCount: true, notes: true, createdAt: true,
    },
  });
  await prisma.auditLog.create({
    data: {
      organizationId: req.auth!.organizationId,
      actorId: req.auth!.userId,
      action: "PICKUP_AUTHORIZATION_CREATED",
      entity: "PickupAuthorization",
      entityId: data.id,
      metadata: { studentId: data.studentId, validUntil: data.validUntil, useLimit: data.useLimit },
    },
  });
  res.status(201).json({
    data,
    credential: {
      qrToken: credentials.qrToken,
      otp: credentials.otp,
      displayOnce: true,
    },
  });
});

router.post("/connected-campus/parent/pickups/:authorizationId/revoke", allow(Role.PARENT), async (req: AuthRequest, res) => {
  const authorization = await prisma.pickupAuthorization.findFirst({
    where: {
      id: cuid.parse(req.params.authorizationId),
      organizationId: req.auth!.organizationId,
      parentId: req.auth!.userId,
    },
  });
  if (!authorization) throw new AppError(404, "PICKUP_AUTHORIZATION_NOT_FOUND", "Pickup authorization not found");
  if (authorization.status !== PickupAuthorizationStatus.ACTIVE) throw new AppError(409, "PICKUP_AUTHORIZATION_NOT_ACTIVE", "Pickup authorization is no longer active");
  const data = await prisma.pickupAuthorization.update({
    where: { id: authorization.id },
    data: { status: PickupAuthorizationStatus.REVOKED, revokedById: req.auth!.userId, revokedAt: new Date() },
  });
  res.json({ data: { ...data, qrTokenHash: undefined, otpHash: undefined } });
});

router.post("/connected-campus/gate/pickup/verify", allow(...adminRoles), async (req: AuthRequest, res) => {
  const body = z.object({
    authorizationId: cuid.optional(),
    qrToken: z.string().min(20).max(500).optional(),
    otp: z.string().regex(/^\d{6}$/).optional(),
    accessPointId: cuid.optional(),
  }).superRefine((value, ctx) => {
    if (!value.qrToken && !(value.authorizationId && value.otp)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["qrToken"], message: "Provide QR token or authorization ID with OTP" });
    }
  }).parse(req.body);

  let authorization = body.qrToken
    ? await prisma.pickupAuthorization.findFirst({
        where: { organizationId: req.auth!.organizationId, qrTokenHash: hashPickupQrToken(body.qrToken) },
        include: { student: { select: { branchId: true, user: { select: { name: true } } } } },
      })
    : await prisma.pickupAuthorization.findFirst({
        where: { id: body.authorizationId!, organizationId: req.auth!.organizationId },
        include: { student: { select: { branchId: true, user: { select: { name: true } } } } },
      });

  if (!authorization) throw new AppError(404, "PICKUP_AUTHORIZATION_NOT_FOUND", "Pickup authorization not found");
  await assertAdminBranch(req, authorization.student.branchId);

  if (body.accessPointId) {
    const accessPoint = await prisma.campusAccessPoint.findFirst({
      where: { id: body.accessPointId, organizationId: req.auth!.organizationId, branchId: authorization.student.branchId, isActive: true },
      select: { id: true },
    });
    if (!accessPoint) throw new AppError(422, "PICKUP_ACCESS_POINT_INVALID", "Pickup access point is not active in this branch");
  }

  const now = new Date();
  let decision = PickupGateDecision.APPROVED;
  let reasonCode = "PICKUP_AUTHORIZATION_VALID";
  if (authorization.status !== PickupAuthorizationStatus.ACTIVE) {
    decision = PickupGateDecision.DENIED;
    reasonCode = "PICKUP_AUTHORIZATION_INACTIVE";
  } else if (now < authorization.validFrom || now > authorization.validUntil) {
    decision = PickupGateDecision.DENIED;
    reasonCode = "PICKUP_AUTHORIZATION_EXPIRED";
  } else if (authorization.usedCount >= authorization.useLimit) {
    decision = PickupGateDecision.DENIED;
    reasonCode = "PICKUP_AUTHORIZATION_LIMIT_REACHED";
  } else if (body.qrToken && !verifyPickupQrToken(body.qrToken, authorization.qrTokenHash)) {
    decision = PickupGateDecision.DENIED;
    reasonCode = "PICKUP_QR_INVALID";
  } else if (body.otp && !verifyPickupOtp(body.otp, authorization.otpHash)) {
    decision = PickupGateDecision.DENIED;
    reasonCode = "PICKUP_OTP_INVALID";
  }

  const result = await prisma.$transaction(async tx => {
    let updated = authorization;
    if (decision === PickupGateDecision.APPROVED) {
      const changed = await tx.pickupAuthorization.updateMany({
        where: {
          id: authorization.id,
          organizationId: req.auth!.organizationId,
          status: PickupAuthorizationStatus.ACTIVE,
          usedCount: { lt: authorization.useLimit },
          validFrom: { lte: now },
          validUntil: { gte: now },
        },
        data: { usedCount: { increment: 1 } },
      });
      if (changed.count !== 1) {
        decision = PickupGateDecision.REVIEW;
        reasonCode = "PICKUP_AUTHORIZATION_RACE_RECHECK";
      } else {
        const refreshed = await tx.pickupAuthorization.findUnique({ where: { id: authorization.id } });
        if (!refreshed) throw new AppError(404, "PICKUP_AUTHORIZATION_NOT_FOUND", "Pickup authorization not found");
        if (refreshed.usedCount >= refreshed.useLimit) {
          updated = await tx.pickupAuthorization.update({
            where: { id: refreshed.id },
            data: { status: PickupAuthorizationStatus.USED },
          }) as typeof authorization;
        } else {
          updated = refreshed as typeof authorization;
        }
      }
    }

    const gateEvent = await tx.pickupGateEvent.create({
      data: {
        organizationId: req.auth!.organizationId,
        authorizationId: authorization.id,
        branchId: authorization.student.branchId,
        accessPointId: body.accessPointId ?? null,
        decision,
        reasonCode,
        processedById: req.auth!.userId,
        metadata: json({ credentialMode: body.qrToken ? "QR" : "OTP" }),
      },
    });
    await tx.schoolEvent.create({
      data: {
        organizationId: req.auth!.organizationId,
        branchId: authorization.student.branchId,
        category: SchoolEventCategory.PICKUP,
        type: `PICKUP_${decision}`,
        severity: decision === PickupGateDecision.APPROVED ? SchoolEventSeverity.INFO : SchoolEventSeverity.HIGH,
        status: decision === PickupGateDecision.REVIEW ? SchoolEventStatus.REVIEW_REQUIRED : SchoolEventStatus.RECORDED,
        occurredAt: now,
        sourceType: "PICKUP_GATE_EVENT",
        sourceId: gateEvent.id,
        correlationKey: `student:${authorization.studentId}`,
        studentId: authorization.studentId,
        accessPointId: body.accessPointId ?? null,
        title: decision === PickupGateDecision.APPROVED ? "Authorized student pickup approved" : "Student pickup requires attention",
        summary: reasonCode,
        reviewRequired: decision === PickupGateDecision.REVIEW,
        metadata: json({ authorizationId: authorization.id, guardianName: authorization.guardianName }),
      },
    });
    return { authorization: updated, gateEvent };
  });

  await prisma.auditLog.create({
    data: {
      organizationId: req.auth!.organizationId,
      actorId: req.auth!.userId,
      action: "PICKUP_GATE_VERIFIED",
      entity: "PickupGateEvent",
      entityId: result.gateEvent.id,
      metadata: { authorizationId: authorization.id, decision, reasonCode },
    },
  });

  res.json({
    data: {
      decision,
      reasonCode,
      gateEvent: result.gateEvent,
      authorization: {
        id: authorization.id,
        studentId: authorization.studentId,
        studentName: authorization.student.user.name,
        guardianName: authorization.guardianName,
        guardianPhone: authorization.guardianPhone,
        relationship: authorization.relationship,
        validUntil: authorization.validUntil,
        useLimit: authorization.useLimit,
        usedCount: result.authorization.usedCount,
        status: result.authorization.status,
      },
    },
  });
});

router.get("/connected-campus/parent/transport/:studentId", allow(Role.PARENT), async (req: AuthRequest, res) => {
  const link = await linkedChild(req, cuid.parse(req.params.studentId));
  const assignment = await prisma.studentTransportAssignment.findFirst({
    where: {
      organizationId: req.auth!.organizationId,
      studentId: link.student.id,
      status: TransportStatus.ACTIVE,
    },
    include: {
      route: true,
      vehicle: true,
      pickupStop: true,
      dropStop: true,
    },
    orderBy: { startsAt: "desc" },
  });
  if (!assignment) return res.json({ data: null });
  const trip = await prisma.transportTrip.findFirst({
    where: {
      organizationId: req.auth!.organizationId,
      vehicleId: assignment.vehicleId,
      routeId: assignment.routeId,
      status: TripStatus.STARTED,
    },
    orderBy: { startedAt: "desc" },
    include: { driver: { select: { name: true, phone: true } } },
  });
  const latestRidership = trip ? await prisma.transportRidershipEvent.findFirst({
    where: { organizationId: req.auth!.organizationId, tripId: trip.id, studentId: link.student.id },
    orderBy: { occurredAt: "desc" },
  }) : null;
  res.json({
    data: {
      assignment,
      live: trip ? {
        tripId: trip.id,
        vehicleId: trip.vehicleId,
        currentLatitude: assignment.vehicle.currentLatitude,
        currentLongitude: assignment.vehicle.currentLongitude,
        currentSpeed: assignment.vehicle.currentSpeed,
        lastGpsAt: assignment.vehicle.lastGpsAt,
        routeProgressPercent: trip.routeProgressPercent,
        etaMinutes: trip.etaMinutes,
        latestRidership,
        driver: trip.driver,
      } : null,
    },
  });
});

router.get("/connected-campus/parent/timeline/:studentId", allow(Role.PARENT), async (req: AuthRequest, res) => {
  const link = await linkedChild(req, cuid.parse(req.params.studentId));
  const q = z.object({
    since: z.coerce.date().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  }).parse(req.query);
  const data = await prisma.schoolEvent.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      studentId: link.student.id,
      ...(q.since ? { occurredAt: { gte: q.since } } : {}),
    },
    orderBy: { occurredAt: "desc" },
    take: q.limit,
  });
  res.json({ data });
});

router.get("/connected-campus/parent/ride-cancellations/:studentId", allow(Role.PARENT), async (req: AuthRequest, res) => {
  const link = await linkedChild(req, cuid.parse(req.params.studentId));
  const data = await prisma.transportRideCancellation.findMany({
    where: { organizationId: req.auth!.organizationId, studentId: link.student.id },
    orderBy: { date: "desc" },
    take: 100,
  });
  res.json({ data });
});

router.post("/connected-campus/parent/ride-cancellations", allow(Role.PARENT), async (req: AuthRequest, res) => {
  const body = z.object({
    studentId: cuid,
    date: z.coerce.date(),
    scope: z.nativeEnum(TransportRideCancellationScope),
    reason: z.string().trim().max(5000).optional(),
  }).parse(req.body);
  const link = await linkedChild(req, body.studentId);
  const date = await currentOrganizationDate(req.auth!.organizationId, body.date);
  const assignment = await prisma.studentTransportAssignment.findFirst({
    where: {
      organizationId: req.auth!.organizationId,
      studentId: link.student.id,
      status: TransportStatus.ACTIVE,
      startsAt: { lte: date },
      OR: [{ endsAt: null }, { endsAt: { gte: date } }],
    },
    orderBy: { startsAt: "desc" },
  });
  if (!assignment) throw new AppError(422, "TRANSPORT_ASSIGNMENT_NOT_FOUND", "Student has no active transport assignment for this date");
  try {
    const data = await prisma.transportRideCancellation.create({
      data: {
        organizationId: req.auth!.organizationId,
        assignmentId: assignment.id,
        studentId: link.student.id,
        date,
        scope: body.scope,
        reason: body.reason ?? null,
        createdById: req.auth!.userId,
      },
    });
    await prisma.auditLog.create({
      data: {
        organizationId: req.auth!.organizationId,
        actorId: req.auth!.userId,
        action: "PARENT_TRANSPORT_RIDE_CANCELLED",
        entity: "TransportRideCancellation",
        entityId: data.id,
        metadata: { studentId: link.student.id, date, scope: body.scope },
      },
    });
    res.status(201).json({ data });
  } catch (error: any) {
    if (error?.code === "P2002") throw new AppError(409, "RIDE_CANCELLATION_EXISTS", "A ride cancellation already exists for this date and scope");
    throw error;
  }
});

export default router;
