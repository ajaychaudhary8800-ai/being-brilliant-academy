import {
  AIExaminerBenchmarkSuiteStatus,
  CapabilityCertificationKind,
  CapabilityCertificationStatus,
  CertificationEnvironment,
  DataSubjectRequestStatus,
  DataSubjectRequestType,
  Prisma,
  PrivacyConsentStatus,
  PrivacyPurpose,
  PrivacyRetentionAction,
  PrivacySubjectType,
  Role,
} from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { evaluateERP31Readiness } from "../lib/erp-3-1-readiness.js";
import { assertErpBranchAccess, assertErpBranchTarget, erpBranchScope } from "../lib/erp-branch-access.js";
import { AppError } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { allow, requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);
const cuid = z.string().cuid();
const admins = [Role.SUPER_ADMIN, Role.BRANCH_ADMIN] as const;

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function linkedChild(req: AuthRequest, studentId: string) {
  if (req.auth!.role !== Role.PARENT) throw new AppError(403, "PARENT_REQUIRED", "Parent account required");
  const link = await prisma.parentStudent.findFirst({
    where: {
      organizationId: req.auth!.organizationId,
      parentId: req.auth!.userId,
      studentId,
      student: { status: "ACTIVE", user: { isActive: true } },
    },
    select: { student: { select: { id: true, branchId: true, userId: true } } },
  });
  if (!link) throw new AppError(403, "CHILD_ACCESS_DENIED", "This active student is not linked to your parent account");
  return link.student;
}

async function validatePrivacySubject(req: AuthRequest, subjectType: PrivacySubjectType, subjectId: string) {
  const organizationId = req.auth!.organizationId;
  if (subjectType === PrivacySubjectType.STUDENT) {
    const row = await prisma.studentProfile.findFirst({ where: { id: subjectId, organizationId }, select: { id: true, branchId: true } });
    if (!row) throw new AppError(422, "PRIVACY_SUBJECT_INVALID", "Student privacy subject not found");
    return { branchId: row.branchId };
  }
  if (subjectType === PrivacySubjectType.EMPLOYEE) {
    const row = await prisma.employee.findFirst({ where: { id: subjectId, organizationId }, select: { id: true, branchId: true } });
    if (!row) throw new AppError(422, "PRIVACY_SUBJECT_INVALID", "Employee privacy subject not found");
    return { branchId: row.branchId };
  }
  if (subjectType === PrivacySubjectType.GUARDIAN) {
    const row = await prisma.user.findFirst({ where: { id: subjectId, organizationId, role: Role.PARENT }, select: { id: true } });
    if (!row) throw new AppError(422, "PRIVACY_SUBJECT_INVALID", "Guardian privacy subject not found");
    return { branchId: null };
  }
  const row = await prisma.campusVisitor.findFirst({ where: { id: subjectId, organizationId }, select: { id: true, branchId: true } });
  if (!row) throw new AppError(422, "PRIVACY_SUBJECT_INVALID", "Visitor privacy subject not found");
  return { branchId: row.branchId };
}

router.get("/connected-campus/governance/retention-policies", allow(...admins), async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const q = z.object({
    branchId: cuid.optional(),
    purpose: z.nativeEnum(PrivacyPurpose).optional(),
    activeOnly: z.coerce.boolean().default(true),
  }).parse(req.query);
  if (q.branchId) await assertErpBranchTarget(scope, q.branchId);
  const data = await prisma.privacyRetentionPolicy.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      ...(q.branchId ? { branchId: q.branchId } : req.auth!.role === Role.BRANCH_ADMIN ? { branchId: { in: scope } } : {}),
      ...(q.purpose ? { purpose: q.purpose } : {}),
      ...(q.activeOnly ? { isActive: true } : {}),
    },
    orderBy: [{ purpose: "asc" }, { createdAt: "desc" }],
  });
  res.json({ data });
});

router.post("/connected-campus/governance/retention-policies", allow(...admins), async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const body = z.object({
    branchId: cuid.nullable().optional(),
    purpose: z.nativeEnum(PrivacyPurpose),
    subjectType: z.nativeEnum(PrivacySubjectType).nullable().optional(),
    retentionDays: z.number().int().min(1).max(36500),
    action: z.nativeEnum(PrivacyRetentionAction),
    legalBasis: z.string().trim().min(3).max(1000),
    policyVersion: z.string().trim().min(1).max(80),
  }).parse(req.body);
  if (req.auth!.role === Role.BRANCH_ADMIN && !body.branchId) {
    throw new AppError(422, "RETENTION_BRANCH_REQUIRED", "Branch administrators must create branch-scoped retention policy");
  }
  if (body.branchId) await assertErpBranchTarget(scope, body.branchId);
  const now = new Date();
  const data = await prisma.$transaction(async tx => {
    await tx.privacyRetentionPolicy.updateMany({
      where: {
        organizationId: req.auth!.organizationId,
        branchId: body.branchId ?? null,
        purpose: body.purpose,
        subjectType: body.subjectType ?? null,
        isActive: true,
      },
      data: { isActive: false },
    });
    const created = await tx.privacyRetentionPolicy.create({
      data: {
        organizationId: req.auth!.organizationId,
        branchId: body.branchId ?? null,
        purpose: body.purpose,
        subjectType: body.subjectType ?? null,
        retentionDays: body.retentionDays,
        action: body.action,
        legalBasis: body.legalBasis,
        policyVersion: body.policyVersion,
        approvedById: req.auth!.userId,
        approvedAt: now,
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId: req.auth!.organizationId,
        actorId: req.auth!.userId,
        action: "PRIVACY_RETENTION_POLICY_APPROVED",
        entity: "PrivacyRetentionPolicy",
        entityId: created.id,
        metadata: { branchId: created.branchId, purpose: created.purpose, subjectType: created.subjectType, retentionDays: created.retentionDays, action: created.action, policyVersion: created.policyVersion },
      },
    });
    return created;
  });
  res.status(201).json({ data });
});

router.get("/connected-campus/governance/consents", allow(...admins), async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const q = z.object({
    subjectType: z.nativeEnum(PrivacySubjectType).optional(),
    subjectId: cuid.optional(),
    purpose: z.nativeEnum(PrivacyPurpose).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  }).parse(req.query);
  if (q.subjectType && q.subjectId) {
    const subject = await validatePrivacySubject(req, q.subjectType, q.subjectId);
    if (subject.branchId) assertErpBranchAccess(scope, subject.branchId);
  }
  const data = await prisma.privacyConsentRecord.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      ...(q.subjectType ? { subjectType: q.subjectType } : {}),
      ...(q.subjectId ? { subjectId: q.subjectId } : {}),
      ...(q.purpose ? { purpose: q.purpose } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: q.limit,
  });
  res.json({ data });
});

router.get("/connected-campus/parent/privacy/:studentId/consents", allow(Role.PARENT), async (req: AuthRequest, res) => {
  const student = await linkedChild(req, cuid.parse(req.params.studentId));
  const data = await prisma.privacyConsentRecord.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      subjectType: PrivacySubjectType.STUDENT,
      subjectId: student.id,
      guardianId: req.auth!.userId,
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json({ data });
});

router.post("/connected-campus/parent/privacy/:studentId/consents", allow(Role.PARENT), async (req: AuthRequest, res) => {
  const student = await linkedChild(req, cuid.parse(req.params.studentId));
  const body = z.object({
    purpose: z.nativeEnum(PrivacyPurpose),
    status: z.enum(["GRANTED","DENIED","WITHDRAWN"]),
    policyVersion: z.string().trim().min(1).max(80),
    source: z.string().trim().min(2).max(80).default("PARENT_PORTAL"),
    expiresAt: z.coerce.date().nullable().optional(),
    evidence: z.record(z.string(), z.unknown()).optional(),
  }).parse(req.body);
  const now = new Date();
  const data = await prisma.$transaction(async tx => {
    const record = await tx.privacyConsentRecord.create({
      data: {
        organizationId: req.auth!.organizationId,
        subjectType: PrivacySubjectType.STUDENT,
        subjectId: student.id,
        guardianId: req.auth!.userId,
        purpose: body.purpose,
        status: body.status,
        policyVersion: body.policyVersion,
        source: body.source,
        evidence: body.evidence ? json(body.evidence) : undefined,
        grantedAt: body.status === "GRANTED" ? now : null,
        withdrawnAt: body.status === "WITHDRAWN" ? now : null,
        expiresAt: body.expiresAt ?? null,
        recordedById: req.auth!.userId,
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId: req.auth!.organizationId,
        actorId: req.auth!.userId,
        action: "PARENT_PRIVACY_CHOICE_RECORDED",
        entity: "PrivacyConsentRecord",
        entityId: record.id,
        metadata: { studentId: student.id, purpose: record.purpose, status: record.status, policyVersion: record.policyVersion },
      },
    });
    return record;
  });
  res.status(201).json({ data, meta: { note: "A consent record documents the guardian choice; it does not override processing required by law or essential school safety/operations." } });
});

router.post("/connected-campus/parent/privacy/:studentId/requests", allow(Role.PARENT), async (req: AuthRequest, res) => {
  const student = await linkedChild(req, cuid.parse(req.params.studentId));
  const body = z.object({
    type: z.nativeEnum(DataSubjectRequestType),
    scope: z.record(z.string(), z.unknown()).optional(),
    reason: z.string().trim().max(5000).optional(),
  }).parse(req.body);
  const data = await prisma.$transaction(async tx => {
    const request = await tx.dataSubjectRequest.create({
      data: {
        organizationId: req.auth!.organizationId,
        subjectType: PrivacySubjectType.STUDENT,
        subjectId: student.id,
        requestedById: req.auth!.userId,
        type: body.type,
        scope: body.scope ? json(body.scope) : undefined,
        reason: body.reason ?? null,
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId: req.auth!.organizationId,
        actorId: req.auth!.userId,
        action: "DATA_SUBJECT_REQUEST_CREATED",
        entity: "DataSubjectRequest",
        entityId: request.id,
        metadata: { studentId: student.id, type: request.type },
      },
    });
    return request;
  });
  res.status(201).json({
    data,
    meta: {
      automaticDeletion: false,
      note: "Deletion/restriction requests require identity verification, legal/retention review, and authorized human completion.",
    },
  });
});

router.get("/connected-campus/parent/privacy/:studentId/requests", allow(Role.PARENT), async (req: AuthRequest, res) => {
  const student = await linkedChild(req, cuid.parse(req.params.studentId));
  const data = await prisma.dataSubjectRequest.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      subjectType: PrivacySubjectType.STUDENT,
      subjectId: student.id,
      requestedById: req.auth!.userId,
    },
    orderBy: { createdAt: "desc" },
  });
  res.json({ data });
});

router.get("/connected-campus/governance/data-requests", allow(...admins), async (req: AuthRequest, res) => {
  const q = z.object({
    status: z.nativeEnum(DataSubjectRequestStatus).optional(),
    type: z.nativeEnum(DataSubjectRequestType).optional(),
    subjectType: z.nativeEnum(PrivacySubjectType).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  }).parse(req.query);
  const data = await prisma.dataSubjectRequest.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.subjectType ? { subjectType: q.subjectType } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: q.limit,
  });
  res.json({ data });
});

const requestTransitions: Record<DataSubjectRequestStatus, DataSubjectRequestStatus[]> = {
  REQUESTED: [DataSubjectRequestStatus.VERIFIED, DataSubjectRequestStatus.REJECTED, DataSubjectRequestStatus.CANCELLED],
  VERIFIED: [DataSubjectRequestStatus.IN_PROGRESS, DataSubjectRequestStatus.REJECTED, DataSubjectRequestStatus.CANCELLED],
  IN_PROGRESS: [DataSubjectRequestStatus.COMPLETED, DataSubjectRequestStatus.REJECTED, DataSubjectRequestStatus.CANCELLED],
  COMPLETED: [],
  REJECTED: [],
  CANCELLED: [],
};

router.patch("/connected-campus/governance/data-requests/:requestId", allow(...admins), async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const request = await prisma.dataSubjectRequest.findFirst({
    where: { id: cuid.parse(req.params.requestId), organizationId: req.auth!.organizationId },
  });
  if (!request) throw new AppError(404, "DATA_SUBJECT_REQUEST_NOT_FOUND", "Data subject request not found");
  const subject = await validatePrivacySubject(req, request.subjectType, request.subjectId);
  if (subject.branchId) assertErpBranchAccess(scope, subject.branchId);
  const body = z.object({
    status: z.nativeEnum(DataSubjectRequestStatus),
    assignedToId: cuid.nullable().optional(),
    resultRef: z.string().trim().max(1000).nullable().optional(),
    rejectionReason: z.string().trim().max(5000).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }).parse(req.body);
  if (!requestTransitions[request.status].includes(body.status)) {
    throw new AppError(409, "DATA_SUBJECT_REQUEST_TRANSITION_INVALID", `Cannot transition privacy request from ${request.status} to ${body.status}`);
  }
  if (body.status === DataSubjectRequestStatus.REJECTED && !body.rejectionReason) {
    throw new AppError(422, "DATA_SUBJECT_REJECTION_REASON_REQUIRED", "Rejected privacy requests require a reason");
  }
  if (body.status === DataSubjectRequestStatus.COMPLETED && !body.resultRef) {
    throw new AppError(422, "DATA_SUBJECT_RESULT_REQUIRED", "Completed privacy requests require a result/evidence reference");
  }
  const now = new Date();
  const data = await prisma.$transaction(async tx => {
    const updated = await tx.dataSubjectRequest.update({
      where: { id: request.id },
      data: {
        status: body.status,
        assignedToId: body.assignedToId,
        resultRef: body.resultRef,
        rejectionReason: body.rejectionReason,
        metadata: body.metadata ? json(body.metadata) : undefined,
        ...(body.status === DataSubjectRequestStatus.VERIFIED ? { verifiedById: req.auth!.userId, verifiedAt: now } : {}),
        ...(body.status === DataSubjectRequestStatus.COMPLETED ? { completedById: req.auth!.userId, completedAt: now } : {}),
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId: req.auth!.organizationId,
        actorId: req.auth!.userId,
        action: "DATA_SUBJECT_REQUEST_UPDATED",
        entity: "DataSubjectRequest",
        entityId: request.id,
        metadata: { fromStatus: request.status, toStatus: body.status, type: request.type },
      },
    });
    return updated;
  });
  res.json({ data });
});

router.get("/connected-campus/governance/certifications", allow(...admins), async (req: AuthRequest, res) => {
  const q = z.object({
    capabilityKey: z.string().trim().max(120).optional(),
    kind: z.nativeEnum(CapabilityCertificationKind).optional(),
    status: z.nativeEnum(CapabilityCertificationStatus).optional(),
    environment: z.nativeEnum(CertificationEnvironment).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  }).parse(req.query);
  const data = await prisma.capabilityCertification.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      ...(q.capabilityKey ? { capabilityKey: q.capabilityKey } : {}),
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.environment ? { environment: q.environment } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: q.limit,
  });
  res.json({ data });
});

router.post("/connected-campus/governance/certifications", allow(...admins), async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const body = z.object({
    capabilityKey: z.string().trim().min(2).max(120).regex(/^[a-z0-9._-]+$/),
    kind: z.nativeEnum(CapabilityCertificationKind),
    environment: z.nativeEnum(CertificationEnvironment),
    adapterKey: z.string().trim().max(100).nullable().optional(),
    deviceId: cuid.nullable().optional(),
    benchmarkRunId: cuid.nullable().optional(),
    vendor: z.string().trim().max(180).nullable().optional(),
    hardwareModel: z.string().trim().max(180).nullable().optional(),
    firmwareVersion: z.string().trim().max(100).nullable().optional(),
    protocolVersion: z.string().trim().max(100).nullable().optional(),
    evidence: z.record(z.string(), z.unknown()),
    testedAt: z.coerce.date().nullable().optional(),
    expiresAt: z.coerce.date().nullable().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
  }).superRefine((value, ctx) => {
    if (value.environment === CertificationEnvironment.REAL_DEVICE && !value.deviceId && !value.hardwareModel) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["deviceId"], message: "Real-device certification requires a Device Hub device or explicit hardware model" });
    }
    if (value.kind === CapabilityCertificationKind.AI_GRADING && !value.benchmarkRunId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["benchmarkRunId"], message: "AI grading certification requires a benchmark run" });
    }
  }).parse(req.body);
  if (body.deviceId) {
    const device = await prisma.connectedDevice.findFirst({ where: { id: body.deviceId, organizationId: req.auth!.organizationId }, select: { id: true, branchId: true } });
    if (!device) throw new AppError(422, "CERTIFICATION_DEVICE_INVALID", "Certification device not found");
    if (device.branchId) assertErpBranchAccess(scope, device.branchId);
  }
  if (body.adapterKey) {
    const adapter = await prisma.deviceAdapterRegistry.findUnique({ where: { key: body.adapterKey }, select: { id: true, isActive: true } });
    if (!adapter?.isActive) throw new AppError(422, "CERTIFICATION_ADAPTER_INVALID", "Certification adapter is not active");
  }
  if (body.benchmarkRunId) {
    const run = await prisma.aIExaminerBenchmarkRun.findFirst({
      where: { id: body.benchmarkRunId, organizationId: req.auth!.organizationId },
      select: { id: true, benchmarkReady: true, status: true },
    });
    if (!run) throw new AppError(422, "CERTIFICATION_BENCHMARK_INVALID", "Benchmark run not found");
  }
  const data = await prisma.capabilityCertification.create({
    data: {
      organizationId: req.auth!.organizationId,
      capabilityKey: body.capabilityKey,
      kind: body.kind,
      environment: body.environment,
      adapterKey: body.adapterKey ?? null,
      deviceId: body.deviceId ?? null,
      benchmarkRunId: body.benchmarkRunId ?? null,
      vendor: body.vendor ?? null,
      hardwareModel: body.hardwareModel ?? null,
      firmwareVersion: body.firmwareVersion ?? null,
      protocolVersion: body.protocolVersion ?? null,
      evidence: json(body.evidence),
      testedAt: body.testedAt ?? null,
      expiresAt: body.expiresAt ?? null,
      testedById: req.auth!.userId,
      notes: body.notes ?? null,
      status: CapabilityCertificationStatus.IN_REVIEW,
    },
  });
  await prisma.auditLog.create({
    data: {
      organizationId: req.auth!.organizationId,
      actorId: req.auth!.userId,
      action: "CAPABILITY_CERTIFICATION_SUBMITTED",
      entity: "CapabilityCertification",
      entityId: data.id,
      metadata: { capabilityKey: data.capabilityKey, kind: data.kind, environment: data.environment },
    },
  });
  res.status(201).json({ data });
});

router.patch("/connected-campus/governance/certifications/:certificationId/review", allow(Role.SUPER_ADMIN), async (req: AuthRequest, res) => {
  const certification = await prisma.capabilityCertification.findFirst({
    where: { id: cuid.parse(req.params.certificationId), organizationId: req.auth!.organizationId },
  });
  if (!certification) throw new AppError(404, "CAPABILITY_CERTIFICATION_NOT_FOUND", "Capability certification not found");
  if (certification.status !== CapabilityCertificationStatus.DRAFT && certification.status !== CapabilityCertificationStatus.IN_REVIEW) {
    throw new AppError(409, "CAPABILITY_CERTIFICATION_CLOSED", "Certification has already been reviewed");
  }
  const body = z.object({
    status: z.enum(["PASSED","FAILED"]),
    notes: z.string().trim().min(3).max(5000),
  }).parse(req.body);
  if (body.status === "PASSED") {
    if (!certification.testedAt) throw new AppError(422, "CERTIFICATION_TEST_DATE_REQUIRED", "Passing certification requires a test date");
    if (certification.environment === CertificationEnvironment.REAL_DEVICE && !certification.deviceId && !certification.hardwareModel) {
      throw new AppError(422, "REAL_DEVICE_EVIDENCE_REQUIRED", "Hardware production certification requires real-device evidence");
    }
    if (certification.kind === CapabilityCertificationKind.AI_GRADING) {
      if (!certification.benchmarkRunId) throw new AppError(422, "BENCHMARK_CERTIFICATION_REQUIRED", "AI grading certification requires benchmark evidence");
      const run = await prisma.aIExaminerBenchmarkRun.findFirst({
        where: { id: certification.benchmarkRunId, organizationId: req.auth!.organizationId },
        select: { status: true, benchmarkReady: true },
      });
      if (!run || run.status !== "COMPLETED" || !run.benchmarkReady) {
        throw new AppError(422, "BENCHMARK_NOT_READY", "AI grading benchmark must be completed and pass its configured release thresholds");
      }
    }
  }
  const now = new Date();
  const data = await prisma.$transaction(async tx => {
    const updated = await tx.capabilityCertification.update({
      where: { id: certification.id },
      data: {
        status: body.status,
        approvedById: req.auth!.userId,
        approvedAt: now,
        notes: body.notes,
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId: req.auth!.organizationId,
        actorId: req.auth!.userId,
        action: "CAPABILITY_CERTIFICATION_REVIEWED",
        entity: "CapabilityCertification",
        entityId: certification.id,
        metadata: { capabilityKey: certification.capabilityKey, status: body.status, environment: certification.environment },
      },
    });
    return updated;
  });
  res.json({ data });
});

router.get("/connected-campus/governance/readiness", allow(Role.SUPER_ADMIN), async (req: AuthRequest, res) => {
  const now = new Date();
  const requiredPrivacyPurposes = Object.values(PrivacyPurpose);
  const [
    devices,
    connectors,
    certifications,
    benchmarkSuites,
    benchmarkRuns,
    retentionPolicies,
    retryCounts,
  ] = await Promise.all([
    prisma.connectedDevice.findMany({
      where: {
        organizationId: req.auth!.organizationId,
        status: { notIn: ["DISABLED","RETIRED"] },
      },
      select: { id: true, status: true, kind: true, branchId: true, lastSeenAt: true, lastHeartbeatAt: true },
    }),
    prisma.deviceConnectorInstance.findMany({
      where: {
        organizationId: req.auth!.organizationId,
        status: { not: "DISABLED" },
      },
      include: { adapter: { select: { key: true, name: true } } },
    }),
    prisma.capabilityCertification.findMany({
      where: {
        organizationId: req.auth!.organizationId,
        status: CapabilityCertificationStatus.PASSED,
        OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
      },
    }),
    prisma.aIExaminerBenchmarkSuite.findMany({
      where: {
        organizationId: req.auth!.organizationId,
        status: AIExaminerBenchmarkSuiteStatus.ACTIVE,
      },
      select: { id: true, code: true, name: true, subjectId: true, questionType: true, classLevel: true },
    }),
    prisma.aIExaminerBenchmarkRun.findMany({
      where: {
        organizationId: req.auth!.organizationId,
        status: "COMPLETED",
        benchmarkReady: true,
      },
      select: { id: true, suiteId: true, benchmarkReady: true, completedAt: true },
      orderBy: { completedAt: "desc" },
    }),
    prisma.privacyRetentionPolicy.findMany({
      where: { organizationId: req.auth!.organizationId, isActive: true },
      select: { purpose: true, branchId: true, policyVersion: true, retentionDays: true, action: true, legalBasis: true },
    }),
    prisma.connectedDeviceRetryJob.groupBy({
      by: ["status"],
      where: { organizationId: req.auth!.organizationId },
      _count: true,
    }),
  ]);

  const activeAdapterKeys = connectors.map(connector => connector.adapter.key);
  const certifiedRealDeviceIds = certifications
    .filter(certification =>
      certification.environment === CertificationEnvironment.REAL_DEVICE
      && (certification.kind === CapabilityCertificationKind.HARDWARE_DEVICE || certification.kind === CapabilityCertificationKind.HARDWARE_ADAPTER)
      && certification.deviceId
    )
    .map(certification => certification.deviceId!);
  const certifiedRealAdapterKeys = certifications
    .filter(certification =>
      certification.environment === CertificationEnvironment.REAL_DEVICE
      && (certification.kind === CapabilityCertificationKind.HARDWARE_ADAPTER || certification.kind === CapabilityCertificationKind.HARDWARE_DEVICE)
      && certification.adapterKey
    )
    .map(certification => certification.adapterKey!);

  const readySuiteIds = new Set(benchmarkRuns.map(run => run.suiteId));
  const benchmarkReadySuiteCodes = benchmarkSuites.filter(suite => readySuiteIds.has(suite.id)).map(suite => suite.code);
  const benchmarkRunToSuite = new Map(benchmarkRuns.map(run => [run.id, run.suiteId]));
  const certifiedSuiteIds = new Set(
    certifications
      .filter(certification => certification.kind === CapabilityCertificationKind.AI_GRADING && certification.benchmarkRunId)
      .map(certification => benchmarkRunToSuite.get(certification.benchmarkRunId!))
      .filter((value): value is string => Boolean(value))
  );
  const aiCertifiedSuiteCodes = benchmarkSuites.filter(suite => certifiedSuiteIds.has(suite.id)).map(suite => suite.code);
  const securityPrivacyCertified = certifications.some(certification =>
    certification.kind === CapabilityCertificationKind.SECURITY_PRIVACY
    && (certification.environment === CertificationEnvironment.STAGING || certification.environment === CertificationEnvironment.PRODUCTION_LIKE)
  );

  const readiness = evaluateERP31Readiness({
    activeDeviceIds: devices.map(device => device.id),
    certifiedRealDeviceIds,
    activeAdapterKeys,
    certifiedRealAdapterKeys,
    activeBenchmarkSuiteCodes: benchmarkSuites.map(suite => suite.code),
    benchmarkReadySuiteCodes,
    aiCertifiedSuiteCodes,
    requiredPrivacyPurposes,
    configuredPrivacyPurposes: retentionPolicies.map(policy => policy.purpose),
    securityPrivacyCertified,
  });

  const deviceStatusCounts = Object.fromEntries(
    [...new Set(devices.map(device => device.status))].map(status => [
      status,
      devices.filter(device => device.status === status).length,
    ])
  );
  const connectorStatusCounts = Object.fromEntries(
    [...new Set(connectors.map(connector => connector.status))].map(status => [
      status,
      connectors.filter(connector => connector.status === status).length,
    ])
  );

  res.json({
    data: {
      ...readiness,
      softwareVersion: "ERP/LMS 3.1",
      evaluatedAt: now,
      operational: {
        deviceStatusCounts,
        connectorStatusCounts,
        retryQueue: Object.fromEntries(retryCounts.map(row => [row.status, row._count])),
      },
      evidence: {
        activeDevices: devices,
        activeConnectors: connectors.map(connector => ({
          id: connector.id,
          branchId: connector.branchId,
          name: connector.name,
          status: connector.status,
          adapterKey: connector.adapter.key,
          adapterName: connector.adapter.name,
          lastSuccessAt: connector.lastSuccessAt,
          lastErrorAt: connector.lastErrorAt,
          lastErrorCode: connector.lastErrorCode,
        })),
        certifications,
        benchmarkSuites,
        benchmarkReadySuiteCodes,
        aiCertifiedSuiteCodes,
        retentionPolicies,
      },
    },
  });
});

export default router;
