import crypto from "node:crypto";
import {
  CameraIncidentSeverity,
  CameraIncidentStatus,
  CampusAccessDecision,
  CampusAccessPointType,
  ConnectedDeviceBindingType,
  ConnectedDeviceKind,
  ConnectedDeviceCommandStatus,
  ConnectedDeviceProtocol,
  ConnectedDeviceStatus,
  DeviceConnectorStatus,
  DeviceRetryStatus,
  EdgeAgentStatus,
  EmergencyMode,
  Prisma,
  Role,
  SafetyIncidentSeverity,
  SafetyIncidentStatus,
  SchoolEventCategory,
  SchoolEventSeverity,
  SchoolEventStatus,
} from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import {
  connectedDeviceEventEnvelopeSchema,
  connectedDeviceHealth,
  connectedDeviceSourceHash,
  generateConnectedDeviceIngestToken,
  hashConnectedDeviceIngestToken,
  normalizeConnectedDeviceEvent,
  verifyConnectedDeviceIngestToken,
} from "../lib/device-hub.js";
import { processConnectedDeviceEvent } from "../lib/device-hub-processor.js";
import {
  connectorHealth,
  generateEdgeAgentToken,
  hashEdgeAgentToken,
  nextRetryState,
  verifyDeviceEventSignature,
  verifyEdgeAgentToken,
} from "../lib/device-hub-governance.js";
import { AppError } from "../lib/http.js";
import { assertFeatureEntitled } from "../lib/saas-commercial.js";
import { prisma } from "../lib/prisma.js";
import {
  assertErpBranchAccess,
  assertErpBranchTarget,
  erpBranchScope,
  erpBranchWhere,
} from "../lib/erp-branch-access.js";
import { allow, requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
const cuid = z.string().cuid();

function profileJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function deviceForOrganization(organizationId: string, deviceId: string) {
  const device = await prisma.connectedDevice.findFirst({
    where: { id: deviceId, organizationId },
  });
  if (!device) throw new AppError(404, "DEVICE_NOT_FOUND", "Connected device not found");
  return device;
}

router.post("/device-hub/ingest/:deviceId", async (req, res) => {
  const deviceId = cuid.parse(req.params.deviceId);
  const token = req.header("x-device-token")?.trim() ?? "";
  const device = await prisma.connectedDevice.findUnique({ where: { id: deviceId } });
  if (!device || !verifyConnectedDeviceIngestToken(token, device.ingestTokenHash)) {
    throw new AppError(401, "DEVICE_INGEST_UNAUTHORIZED", "Device ingest token is invalid");
  }
  if ([ConnectedDeviceStatus.DISABLED, ConnectedDeviceStatus.RETIRED].includes(device.status)) {
    throw new AppError(409, "DEVICE_INGEST_DISABLED", "This device is not accepting events");
  }

  const envelope = connectedDeviceEventEnvelopeSchema.parse(req.body);
  let normalized;
  try {
    normalized = normalizeConnectedDeviceEvent(envelope);
  } catch (error) {
    throw new AppError(422, "DEVICE_EVENT_INVALID", error instanceof Error ? error.message : "Device event is invalid");
  }
  const sourceHash = connectedDeviceSourceHash({
    externalEventId: envelope.externalEventId,
    eventType: envelope.eventType,
    occurredAt: envelope.occurredAt,
    payload: envelope.payload,
  });
  const now = new Date();
  const timestampHeader = req.header("x-device-timestamp");
  const signatureHeader = req.header("x-device-signature");
  let signatureVerified: boolean | null = null;
  if (device.signatureRequired || timestampHeader || signatureHeader) {
    const signature = verifyDeviceEventSignature({
      sourceHash,
      publicKey: device.signingPublicKey,
      timestampHeader,
      signatureHeader,
      now,
    });
    if (!signature.ok) {
      throw new AppError(401, "DEVICE_SIGNATURE_INVALID", `Device event signature rejected: ${signature.code}`);
    }
    signatureVerified = true;
  }
  const eventDelayMs = Math.max(0, now.getTime() - envelope.occurredAt.getTime());

  try {
    const event = await prisma.$transaction(async tx => {
      const created = await tx.connectedDeviceEvent.create({
        data: {
          organizationId: device.organizationId,
          deviceId: device.id,
          externalEventId: envelope.externalEventId,
          eventType: normalized.eventType,
          occurredAt: normalized.occurredAt,
          eventDelayMs,
          signatureVerified,
          payload: profileJson(envelope.payload),
          normalized: profileJson({
            category: normalized.category,
            subjectExternalId: normalized.subjectExternalId,
            latitude: normalized.latitude,
            longitude: normalized.longitude,
            speedKph: normalized.speedKph,
            direction: normalized.direction,
            reading: normalized.reading,
            unit: normalized.unit,
            metadata: normalized.metadata,
          }),
          status: "NORMALIZED",
          sourceHash,
        },
        select: { id: true, deviceId: true, eventType: true, occurredAt: true, status: true, receivedAt: true },
      });
      await tx.connectedDevice.update({
        where: { id: device.id },
        data: {
          status: ConnectedDeviceStatus.ACTIVE,
          lastSeenAt: now,
          ...(envelope.heartbeat || normalized.category === "HEARTBEAT" ? { lastHeartbeatAt: now } : {}),
          lastErrorAt: null,
          lastErrorCode: null,
          ...(signatureVerified ? { lastSignatureAt: now } : {}),
          ...(typeof normalized.metadata.firmware === "string" ? { firmwareVersion: normalized.metadata.firmware } : {}),
        },
      });
      return created;
    });
    const processing = await processConnectedDeviceEvent(event.id);
    res.status(202).json({ data: { ...event, status: processing.status }, meta: { duplicate: false, normalized: true, processing } });
  } catch (error: any) {
    if (error?.code === "P2002") {
      const existing = await prisma.connectedDeviceEvent.findFirst({
        where: {
          deviceId: device.id,
          OR: [
            ...(envelope.externalEventId ? [{ externalEventId: envelope.externalEventId }] : []),
            { sourceHash },
          ],
        },
        select: { id: true, deviceId: true, eventType: true, occurredAt: true, status: true, receivedAt: true },
      });
      if (existing) {
        const processing = await processConnectedDeviceEvent(existing.id);
        return res.status(200).json({ data: { ...existing, status: processing.status }, meta: { duplicate: true, normalized: true, processing } });
      }
    }
    await prisma.connectedDevice.update({
      where: { id: device.id },
      data: {
        status: ConnectedDeviceStatus.DEGRADED,
        lastErrorAt: now,
        lastErrorCode: "INGEST_FAILED",
      },
    }).catch(() => {});
    throw error;
  }
});

router.use(requireAuth, allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN));

const deviceInput = z.object({
  branchId: cuid.nullable().optional(),
  code: z.string().trim().min(2).max(80).regex(/^[A-Za-z0-9._-]+$/),
  name: z.string().trim().min(2).max(180),
  kind: z.nativeEnum(ConnectedDeviceKind),
  protocol: z.nativeEnum(ConnectedDeviceProtocol),
  providerKey: z.string().trim().min(2).max(100),
  externalDeviceId: z.string().trim().min(1).max(180).nullable().optional(),
  signatureRequired: z.boolean().default(false),
  signingPublicKey: z.string().trim().min(32).max(10000).nullable().optional(),
  capabilities: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
  config: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const cameraInput = z.object({
  branchId: cuid,
  code: z.string().trim().min(2).max(80).regex(/^[A-Za-z0-9._-]+$/),
  name: z.string().trim().min(2).max(180),
  deviceId: cuid,
  zone: z.string().trim().max(180).nullable().optional(),
  location: z.string().trim().max(300).nullable().optional(),
  streamSecretRef: z.string().trim().min(3).max(300).nullable().optional(),
  recordingSecretRef: z.string().trim().min(3).max(300).nullable().optional(),
  retentionDays: z.number().int().min(1).max(365).default(30),
  privacyMasking: z.boolean().default(true),
  audioEnabled: z.boolean().default(false),
  aiReviewEnabled: z.boolean().default(false),
  isActive: z.boolean().default(true),
}).superRefine((value, ctx) => {
  for (const [key, ref] of [["streamSecretRef", value.streamSecretRef], ["recordingSecretRef", value.recordingSecretRef]] as const) {
    if (ref && /:\/\/[^/]*@/.test(ref)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: "Store a secret reference, not a credential-bearing stream URL" });
    }
    if (ref && /^(rtsp|http|https):\/\//i.test(ref)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: "Store a secret reference identifier rather than a raw endpoint URL" });
    }
  }
});

router.get("/device-hub/safety-incidents", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const q = z.object({
    branchId: cuid.optional(),
    status: z.nativeEnum(SafetyIncidentStatus).optional(),
    severity: z.nativeEnum(SafetyIncidentSeverity).optional(),
    emergencyMode: z.nativeEnum(EmergencyMode).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  }).parse(req.query);
  if (q.branchId) await assertErpBranchTarget(scope, q.branchId);
  const data = await prisma.safetyIncident.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      ...(req.auth!.role === Role.SUPER_ADMIN
        ? q.branchId ? { branchId: q.branchId } : {}
        : { branchId: { in: scope } }),
      ...(q.status ? { status: q.status } : {}),
      ...(q.severity ? { severity: q.severity } : {}),
      ...(q.emergencyMode ? { emergencyMode: q.emergencyMode } : {}),
    },
    include: { updates: { orderBy: { createdAt: "asc" }, take: 100 } },
    orderBy: [{ severity: "desc" }, { occurredAt: "desc" }],
    take: q.limit,
  });
  res.json({ data });
});

router.post("/device-hub/safety-incidents", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const body = z.object({
    branchId: cuid,
    title: z.string().trim().min(3).max(240),
    description: z.string().trim().max(5000).optional(),
    severity: z.nativeEnum(SafetyIncidentSeverity),
    occurredAt: z.coerce.date().default(() => new Date()),
  }).parse(req.body);
  await assertErpBranchTarget(scope, body.branchId);
  const code = `SAFE-${crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
  const data = await prisma.$transaction(async tx => {
    const incident = await tx.safetyIncident.create({
      data: {
        organizationId: req.auth!.organizationId,
        branchId: body.branchId,
        code,
        title: body.title,
        description: body.description ?? null,
        severity: body.severity,
        sourceType: "MANUAL",
        reportedById: req.auth!.userId,
        occurredAt: body.occurredAt,
      },
    });
    const event = await tx.schoolEvent.create({
      data: {
        organizationId: req.auth!.organizationId,
        branchId: body.branchId,
        category: SchoolEventCategory.SAFETY,
        type: "MANUAL_SAFETY_INCIDENT",
        severity: body.severity === SafetyIncidentSeverity.CRITICAL ? SchoolEventSeverity.CRITICAL
          : body.severity === SafetyIncidentSeverity.HIGH ? SchoolEventSeverity.HIGH
          : body.severity === SafetyIncidentSeverity.MEDIUM ? SchoolEventSeverity.MEDIUM
          : SchoolEventSeverity.LOW,
        status: SchoolEventStatus.REVIEW_REQUIRED,
        occurredAt: body.occurredAt,
        sourceType: "SAFETY_INCIDENT",
        sourceId: incident.id,
        correlationKey: `safety:${incident.id}`,
        title: body.title,
        summary: body.description ?? null,
        reviewRequired: true,
      },
    });
    return tx.safetyIncident.update({ where: { id: incident.id }, data: { schoolEventId: event.id } });
  });
  await prisma.auditLog.create({
    data: {
      organizationId: req.auth!.organizationId,
      actorId: req.auth!.userId,
      action: "SAFETY_INCIDENT_CREATED",
      entity: "SafetyIncident",
      entityId: data.id,
      metadata: { branchId: data.branchId, severity: data.severity },
    },
  });
  res.status(201).json({ data });
});

async function scopedSafetyIncident(req: AuthRequest, incidentId: string) {
  const scope = await erpBranchScope(req);
  const incident = await prisma.safetyIncident.findFirst({
    where: { id: incidentId, organizationId: req.auth!.organizationId },
  });
  if (!incident) throw new AppError(404, "SAFETY_INCIDENT_NOT_FOUND", "Safety incident not found");
  assertErpBranchAccess(scope, incident.branchId);
  return incident;
}

router.post("/device-hub/safety-incidents/:incidentId/acknowledge", async (req: AuthRequest, res) => {
  const incident = await scopedSafetyIncident(req, cuid.parse(req.params.incidentId));
  if ([SafetyIncidentStatus.RESOLVED, SafetyIncidentStatus.FALSE_ALARM].includes(incident.status)) {
    throw new AppError(409, "SAFETY_INCIDENT_CLOSED", "Closed incidents cannot be acknowledged");
  }
  const now = new Date();
  const data = await prisma.safetyIncident.update({
    where: { id: incident.id },
    data: {
      status: incident.status === SafetyIncidentStatus.OPEN ? SafetyIncidentStatus.ACKNOWLEDGED : incident.status,
      acknowledgedById: incident.acknowledgedById ?? req.auth!.userId,
      acknowledgedAt: incident.acknowledgedAt ?? now,
      commanderId: incident.commanderId ?? req.auth!.userId,
    },
  });
  await prisma.safetyIncidentUpdate.create({
    data: {
      organizationId: req.auth!.organizationId,
      incidentId: incident.id,
      type: "ACKNOWLEDGED",
      message: "Incident acknowledged by command-center operator.",
      createdById: req.auth!.userId,
    },
  });
  await prisma.auditLog.create({
    data: {
      organizationId: req.auth!.organizationId,
      actorId: req.auth!.userId,
      action: "SAFETY_INCIDENT_ACKNOWLEDGED",
      entity: "SafetyIncident",
      entityId: incident.id,
    },
  });
  res.json({ data });
});

router.post("/device-hub/safety-incidents/:incidentId/mode", async (req: AuthRequest, res) => {
  const incident = await scopedSafetyIncident(req, cuid.parse(req.params.incidentId));
  if ([SafetyIncidentStatus.RESOLVED, SafetyIncidentStatus.FALSE_ALARM].includes(incident.status)) {
    throw new AppError(409, "SAFETY_INCIDENT_CLOSED", "Closed incidents cannot change emergency mode");
  }
  const body = z.object({
    emergencyMode: z.enum(["ALERT","SECURE_CAMPUS","EVACUATION","REUNIFICATION","ALL_CLEAR"]),
    message: z.string().trim().min(3).max(5000),
  }).parse(req.body);
  const data = await prisma.$transaction(async tx => {
    const updated = await tx.safetyIncident.update({
      where: { id: incident.id },
      data: {
        emergencyMode: body.emergencyMode,
        status: SafetyIncidentStatus.ACTIVE_RESPONSE,
        commanderId: req.auth!.userId,
        acknowledgedById: incident.acknowledgedById ?? req.auth!.userId,
        acknowledgedAt: incident.acknowledgedAt ?? new Date(),
      },
    });
    await tx.safetyIncidentUpdate.create({
      data: {
        organizationId: req.auth!.organizationId,
        incidentId: incident.id,
        type: "MODE_CHANGED",
        emergencyMode: body.emergencyMode,
        message: body.message,
        createdById: req.auth!.userId,
      },
    });
    return updated;
  });
  await prisma.auditLog.create({
    data: {
      organizationId: req.auth!.organizationId,
      actorId: req.auth!.userId,
      action: "SAFETY_EMERGENCY_MODE_CHANGED",
      entity: "SafetyIncident",
      entityId: incident.id,
      metadata: { emergencyMode: body.emergencyMode },
    },
  });
  res.json({ data });
});

router.post("/device-hub/safety-incidents/:incidentId/updates", async (req: AuthRequest, res) => {
  const incident = await scopedSafetyIncident(req, cuid.parse(req.params.incidentId));
  const body = z.object({
    type: z.string().trim().min(2).max(100),
    message: z.string().trim().min(3).max(5000),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }).parse(req.body);
  const data = await prisma.safetyIncidentUpdate.create({
    data: {
      organizationId: req.auth!.organizationId,
      incidentId: incident.id,
      type: body.type.toUpperCase(),
      message: body.message,
      createdById: req.auth!.userId,
      metadata: body.metadata ? profileJson(body.metadata) : undefined,
    },
  });
  res.status(201).json({ data });
});

router.post("/device-hub/safety-incidents/:incidentId/resolve", async (req: AuthRequest, res) => {
  const incident = await scopedSafetyIncident(req, cuid.parse(req.params.incidentId));
  const body = z.object({
    outcome: z.enum(["RESOLVED","FALSE_ALARM"]),
    resolutionNotes: z.string().trim().min(5).max(5000),
  }).parse(req.body);
  const now = new Date();
  const data = await prisma.$transaction(async tx => {
    const updated = await tx.safetyIncident.update({
      where: { id: incident.id },
      data: {
        status: body.outcome,
        emergencyMode: EmergencyMode.ALL_CLEAR,
        resolvedById: req.auth!.userId,
        resolvedAt: now,
        resolutionNotes: body.resolutionNotes,
      },
    });
    await tx.safetyIncidentUpdate.create({
      data: {
        organizationId: req.auth!.organizationId,
        incidentId: incident.id,
        type: body.outcome,
        emergencyMode: EmergencyMode.ALL_CLEAR,
        message: body.resolutionNotes,
        createdById: req.auth!.userId,
      },
    });
    if (incident.schoolEventId) {
      await tx.schoolEvent.updateMany({
        where: { id: incident.schoolEventId, organizationId: req.auth!.organizationId },
        data: {
          status: body.outcome === "RESOLVED" ? SchoolEventStatus.RESOLVED : SchoolEventStatus.DISMISSED,
          resolvedById: req.auth!.userId,
          resolvedAt: now,
          resolutionNotes: body.resolutionNotes,
        },
      });
    }
    return updated;
  });
  await prisma.auditLog.create({
    data: {
      organizationId: req.auth!.organizationId,
      actorId: req.auth!.userId,
      action: "SAFETY_INCIDENT_RESOLVED",
      entity: "SafetyIncident",
      entityId: incident.id,
      metadata: { outcome: body.outcome },
    },
  });
  res.json({ data });
});

router.get("/device-hub/events", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const q = z.object({
    category: z.nativeEnum(SchoolEventCategory).optional(),
    severity: z.nativeEnum(SchoolEventSeverity).optional(),
    status: z.nativeEnum(SchoolEventStatus).optional(),
    branchId: cuid.optional(),
    studentId: cuid.optional(),
    employeeId: cuid.optional(),
    vehicleId: cuid.optional(),
    correlationKey: z.string().trim().max(180).optional(),
    since: z.coerce.date().optional(),
    until: z.coerce.date().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  }).superRefine((value, ctx) => {
    if (value.since && value.until && value.until < value.since) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["until"], message: "until must not be before since" });
    }
  }).parse(req.query);
  if (q.branchId) await assertErpBranchTarget(scope, q.branchId);
  const data = await prisma.schoolEvent.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      ...(req.auth!.role === Role.SUPER_ADMIN
        ? q.branchId ? { branchId: q.branchId } : {}
        : { branchId: { in: scope } }),
      ...(q.category ? { category: q.category } : {}),
      ...(q.severity ? { severity: q.severity } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.studentId ? { studentId: q.studentId } : {}),
      ...(q.employeeId ? { employeeId: q.employeeId } : {}),
      ...(q.vehicleId ? { vehicleId: q.vehicleId } : {}),
      ...(q.correlationKey ? { correlationKey: q.correlationKey } : {}),
      ...((q.since || q.until) ? { occurredAt: { ...(q.since ? { gte: q.since } : {}), ...(q.until ? { lte: q.until } : {}) } } : {}),
    },
    take: q.limit,
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
  });
  res.json({ data });
});

router.get("/device-hub/events/:eventId/context", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const event = await prisma.schoolEvent.findFirst({
    where: { id: cuid.parse(req.params.eventId), organizationId: req.auth!.organizationId },
  });
  if (!event) throw new AppError(404, "SCHOOL_EVENT_NOT_FOUND", "School event not found");
  if (event.branchId) assertErpBranchAccess(scope, event.branchId);
  const windowStart = new Date(event.occurredAt.getTime() - 15 * 60_000);
  const windowEnd = new Date(event.occurredAt.getTime() + 15 * 60_000);
  const OR: Prisma.SchoolEventWhereInput[] = [
    ...(event.correlationKey ? [{ correlationKey: event.correlationKey }] : []),
    ...(event.studentId ? [{ studentId: event.studentId }] : []),
    ...(event.employeeId ? [{ employeeId: event.employeeId }] : []),
    ...(event.vehicleId ? [{ vehicleId: event.vehicleId }] : []),
    ...(event.deviceId ? [{ deviceId: event.deviceId }] : []),
    ...(event.accessPointId ? [{ accessPointId: event.accessPointId }] : []),
    ...(event.cameraId ? [{ cameraId: event.cameraId }] : []),
  ];
  const context = OR.length ? await prisma.schoolEvent.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      occurredAt: { gte: windowStart, lte: windowEnd },
      OR,
    },
    orderBy: { occurredAt: "asc" },
    take: 200,
  }) : [event];
  res.json({ data: { event, context, window: { startsAt: windowStart, endsAt: windowEnd } } });
});

router.patch("/device-hub/events/:eventId/review", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const event = await prisma.schoolEvent.findFirst({
    where: { id: cuid.parse(req.params.eventId), organizationId: req.auth!.organizationId },
  });
  if (!event) throw new AppError(404, "SCHOOL_EVENT_NOT_FOUND", "School event not found");
  if (event.branchId) assertErpBranchAccess(scope, event.branchId);
  const body = z.object({
    status: z.enum(["ACKNOWLEDGED","RESOLVED","DISMISSED"]),
    resolutionNotes: z.string().trim().min(3).max(5000).optional(),
  }).parse(req.body);
  if (["RESOLVED","DISMISSED"].includes(body.status) && !body.resolutionNotes) {
    throw new AppError(422, "SCHOOL_EVENT_RESOLUTION_REQUIRED", "Resolved or dismissed events require review notes");
  }
  const now = new Date();
  const data = await prisma.schoolEvent.update({
    where: { id: event.id },
    data: {
      status: body.status,
      ...(body.status === "ACKNOWLEDGED"
        ? { acknowledgedById: req.auth!.userId, acknowledgedAt: event.acknowledgedAt ?? now }
        : {}),
      ...(body.status === "RESOLVED" || body.status === "DISMISSED"
        ? { resolvedById: req.auth!.userId, resolvedAt: now, resolutionNotes: body.resolutionNotes }
        : {}),
    },
  });
  await prisma.auditLog.create({
    data: {
      organizationId: req.auth!.organizationId,
      actorId: req.auth!.userId,
      action: "SCHOOL_EVENT_REVIEWED",
      entity: "SchoolEvent",
      entityId: event.id,
      metadata: { status: body.status },
    },
  });
  res.json({ data });
});

router.get("/device-hub/cameras", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const cameras = await prisma.campusCamera.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      ...(req.auth!.role === Role.SUPER_ADMIN ? {} : erpBranchWhere(scope)),
    },
    orderBy: [{ branchId: "asc" }, { name: "asc" }],
  });
  const devices = cameras.length ? await prisma.connectedDevice.findMany({
    where: { organizationId: req.auth!.organizationId, id: { in: cameras.map(camera => camera.deviceId) } },
    select: { id: true, status: true, lastHeartbeatAt: true, lastSeenAt: true, lastErrorAt: true, lastErrorCode: true, firmwareVersion: true },
  }) : [];
  const byId = new Map(devices.map(device => [device.id, device]));
  res.json({
    data: cameras.map(camera => {
      const device = byId.get(camera.deviceId);
      return {
        ...camera,
        streamSecretRef: camera.streamSecretRef ? "[configured]" : null,
        recordingSecretRef: camera.recordingSecretRef ? "[configured]" : null,
        health: device ? connectedDeviceHealth({
          status: device.status,
          lastHeartbeatAt: device.lastHeartbeatAt,
          lastSeenAt: device.lastSeenAt,
        }) : { online: false, stale: true, lastSeenAt: null, ageSeconds: null },
        deviceStatus: device?.status ?? "MISSING",
        lastErrorAt: device?.lastErrorAt ?? null,
        lastErrorCode: device?.lastErrorCode ?? null,
        firmwareVersion: device?.firmwareVersion ?? null,
      };
    }),
  });
});

router.post("/device-hub/cameras", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const body = cameraInput.parse(req.body);
  await assertErpBranchTarget(scope, body.branchId);
  const device = await deviceForOrganization(req.auth!.organizationId, body.deviceId);
  if (device.kind !== ConnectedDeviceKind.CAMERA) throw new AppError(422, "CAMERA_DEVICE_KIND_INVALID", "Campus camera requires a CAMERA Device Hub record");
  if (device.branchId && device.branchId !== body.branchId) throw new AppError(422, "CAMERA_DEVICE_BRANCH_MISMATCH", "Camera and Device Hub record must belong to the same branch");
  try {
    const data = await prisma.campusCamera.create({
      data: {
        organizationId: req.auth!.organizationId,
        ...body,
        code: body.code.toUpperCase(),
        zone: body.zone ?? null,
        location: body.location ?? null,
        streamSecretRef: body.streamSecretRef ?? null,
        recordingSecretRef: body.recordingSecretRef ?? null,
      },
      select: {
        id: true, organizationId: true, branchId: true, code: true, name: true, deviceId: true, zone: true, location: true,
        retentionDays: true, privacyMasking: true, audioEnabled: true, aiReviewEnabled: true, isActive: true, createdAt: true, updatedAt: true,
      },
    });
    res.status(201).json({ data, meta: { hardwareValidated: false, productionReady: false } });
  } catch (error: any) {
    if (error?.code === "P2002") throw new AppError(409, "CAMERA_ALREADY_EXISTS", "Camera code or Device Hub assignment already exists");
    throw error;
  }
});

router.patch("/device-hub/cameras/:cameraId", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const camera = await prisma.campusCamera.findFirst({ where: { id: cuid.parse(req.params.cameraId), organizationId: req.auth!.organizationId } });
  if (!camera) throw new AppError(404, "CAMERA_NOT_FOUND", "Campus camera not found");
  assertErpBranchAccess(scope, camera.branchId);
  const body = cameraInput.partial().parse(req.body);
  const targetBranch = body.branchId ?? camera.branchId;
  await assertErpBranchTarget(scope, targetBranch);
  if (body.deviceId) {
    const device = await deviceForOrganization(req.auth!.organizationId, body.deviceId);
    if (device.kind !== ConnectedDeviceKind.CAMERA) throw new AppError(422, "CAMERA_DEVICE_KIND_INVALID", "Campus camera requires a CAMERA Device Hub record");
    if (device.branchId && device.branchId !== targetBranch) throw new AppError(422, "CAMERA_DEVICE_BRANCH_MISMATCH", "Camera and Device Hub record must belong to the same branch");
  }
  const data = await prisma.campusCamera.update({
    where: { id: camera.id },
    data: { ...body, code: body.code?.toUpperCase() },
    select: {
      id: true, organizationId: true, branchId: true, code: true, name: true, deviceId: true, zone: true, location: true,
      retentionDays: true, privacyMasking: true, audioEnabled: true, aiReviewEnabled: true, isActive: true, createdAt: true, updatedAt: true,
    },
  });
  res.json({ data });
});

router.get("/device-hub/camera-incidents", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const q = z.object({
    status: z.nativeEnum(CameraIncidentStatus).optional(),
    severity: z.nativeEnum(CameraIncidentSeverity).optional(),
    cameraId: cuid.optional(),
    since: z.coerce.date().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  }).parse(req.query);
  const data = await prisma.cameraIncident.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      camera: {
        ...(req.auth!.role === Role.SUPER_ADMIN ? {} : erpBranchWhere(scope)),
        ...(q.cameraId ? { id: q.cameraId } : {}),
      },
      ...(q.status ? { status: q.status } : {}),
      ...(q.severity ? { severity: q.severity } : {}),
      ...(q.since ? { occurredAt: { gte: q.since } } : {}),
    },
    include: { camera: { select: { id: true, branchId: true, code: true, name: true, zone: true, location: true } } },
    take: q.limit,
    orderBy: { occurredAt: "desc" },
  });
  res.json({ data });
});

router.patch("/device-hub/camera-incidents/:incidentId", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const incident = await prisma.cameraIncident.findFirst({
    where: { id: cuid.parse(req.params.incidentId), organizationId: req.auth!.organizationId },
    include: { camera: { select: { branchId: true } } },
  });
  if (!incident) throw new AppError(404, "CAMERA_INCIDENT_NOT_FOUND", "Camera incident not found");
  assertErpBranchAccess(scope, incident.camera.branchId);
  const body = z.object({
    status: z.enum(["ACKNOWLEDGED","INVESTIGATING","RESOLVED","DISMISSED"]),
    resolutionNotes: z.string().trim().min(3).max(5000).optional(),
  }).parse(req.body);
  if (["RESOLVED","DISMISSED"].includes(body.status) && !body.resolutionNotes) {
    throw new AppError(422, "CAMERA_INCIDENT_RESOLUTION_REQUIRED", "Resolved or dismissed incidents require review notes");
  }
  const now = new Date();
  const data = await prisma.cameraIncident.update({
    where: { id: incident.id },
    data: {
      status: body.status,
      ...(body.status === "ACKNOWLEDGED" || body.status === "INVESTIGATING"
        ? { acknowledgedById: req.auth!.userId, acknowledgedAt: incident.acknowledgedAt ?? now }
        : {}),
      ...(body.status === "RESOLVED" || body.status === "DISMISSED"
        ? { resolvedById: req.auth!.userId, resolvedAt: now, resolutionNotes: body.resolutionNotes }
        : {}),
    },
  });
  await prisma.auditLog.create({
    data: {
      organizationId: req.auth!.organizationId,
      actorId: req.auth!.userId,
      action: "CAMERA_INCIDENT_REVIEWED",
      entity: "CameraIncident",
      entityId: incident.id,
      metadata: { status: body.status },
    },
  });
  res.json({ data });
});

const accessPointInput = z.object({
  branchId: cuid,
  code: z.string().trim().min(2).max(80).regex(/^[A-Za-z0-9._-]+$/),
  name: z.string().trim().min(2).max(180),
  type: z.nativeEnum(CampusAccessPointType),
  zone: z.string().trim().max(180).nullable().optional(),
  deviceId: cuid.nullable().optional(),
  entryDirection: z.enum(["IN","OUT"]).nullable().optional(),
  isActive: z.boolean().default(true),
  policy: z.object({
    allowStudents: z.boolean().default(false),
    allowEmployees: z.boolean().default(false),
    requireDirection: z.boolean().default(true),
    allowedDirections: z.array(z.enum(["IN","OUT"])).min(1).max(2).default(["IN","OUT"]),
  }).default({ allowStudents: false, allowEmployees: false, requireDirection: true, allowedDirections: ["IN","OUT"] }),
});

router.get("/device-hub/access-points", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const data = await prisma.campusAccessPoint.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      ...(req.auth!.role === Role.SUPER_ADMIN ? {} : erpBranchWhere(scope)),
    },
    orderBy: [{ branchId: "asc" }, { name: "asc" }],
  });
  res.json({ data });
});

router.post("/device-hub/access-points", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const body = accessPointInput.parse(req.body);
  await assertErpBranchTarget(scope, body.branchId);
  if (body.deviceId) {
    const device = await deviceForOrganization(req.auth!.organizationId, body.deviceId);
    if (device.branchId && device.branchId !== body.branchId) {
      throw new AppError(422, "ACCESS_POINT_DEVICE_BRANCH_MISMATCH", "Access point and connected device must belong to the same branch");
    }
    if (![ConnectedDeviceKind.ACCESS_CONTROL, ConnectedDeviceKind.RFID, ConnectedDeviceKind.BIOMETRIC].includes(device.kind)) {
      throw new AppError(422, "ACCESS_POINT_DEVICE_KIND_INVALID", "Access points require an access-control, RFID, or biometric device");
    }
  }
  try {
    const data = await prisma.campusAccessPoint.create({
      data: {
        organizationId: req.auth!.organizationId,
        branchId: body.branchId,
        code: body.code.toUpperCase(),
        name: body.name,
        type: body.type,
        zone: body.zone ?? null,
        deviceId: body.deviceId ?? null,
        entryDirection: body.entryDirection ?? null,
        isActive: body.isActive,
        policy: profileJson(body.policy),
      },
    });
    res.status(201).json({ data });
  } catch (error: any) {
    if (error?.code === "P2002") throw new AppError(409, "ACCESS_POINT_EXISTS", "Access point code or device assignment already exists");
    throw error;
  }
});

router.patch("/device-hub/access-points/:accessPointId", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const accessPoint = await prisma.campusAccessPoint.findFirst({
    where: { id: cuid.parse(req.params.accessPointId), organizationId: req.auth!.organizationId },
  });
  if (!accessPoint) throw new AppError(404, "ACCESS_POINT_NOT_FOUND", "Campus access point not found");
  assertErpBranchAccess(scope, accessPoint.branchId);
  const body = accessPointInput.partial().parse(req.body);
  const targetBranchId = body.branchId ?? accessPoint.branchId;
  await assertErpBranchTarget(scope, targetBranchId);
  if (body.deviceId) {
    const device = await deviceForOrganization(req.auth!.organizationId, body.deviceId);
    if (device.branchId && device.branchId !== targetBranchId) {
      throw new AppError(422, "ACCESS_POINT_DEVICE_BRANCH_MISMATCH", "Access point and connected device must belong to the same branch");
    }
  }
  const data = await prisma.campusAccessPoint.update({
    where: { id: accessPoint.id },
    data: {
      ...body,
      code: body.code?.toUpperCase(),
      policy: body.policy ? profileJson(body.policy) : undefined,
    },
  });
  res.json({ data });
});

router.get("/device-hub/access-events", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const q = z.object({
    decision: z.nativeEnum(CampusAccessDecision).optional(),
    accessPointId: cuid.optional(),
    since: z.coerce.date().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  }).parse(req.query);
  const data = await prisma.campusAccessEvent.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      accessPoint: {
        ...(req.auth!.role === Role.SUPER_ADMIN ? {} : erpBranchWhere(scope)),
        ...(q.accessPointId ? { id: q.accessPointId } : {}),
      },
      ...(q.decision ? { decision: q.decision } : {}),
      ...(q.since ? { occurredAt: { gte: q.since } } : {}),
    },
    include: { accessPoint: { select: { id: true, branchId: true, code: true, name: true, zone: true } } },
    take: q.limit,
    orderBy: { occurredAt: "desc" },
  });
  res.json({ data });
});

router.patch("/device-hub/access-events/:eventId/review", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const event = await prisma.campusAccessEvent.findFirst({
    where: { id: cuid.parse(req.params.eventId), organizationId: req.auth!.organizationId },
    include: { accessPoint: { select: { branchId: true } } },
  });
  if (!event) throw new AppError(404, "ACCESS_EVENT_NOT_FOUND", "Campus access event not found");
  assertErpBranchAccess(scope, event.accessPoint.branchId);
  const body = z.object({
    decision: z.enum(["GRANTED","DENIED"]),
    reviewNotes: z.string().trim().min(3).max(5000),
  }).parse(req.body);
  if (event.decision !== CampusAccessDecision.REVIEW && event.reviewedAt) {
    throw new AppError(409, "ACCESS_EVENT_ALREADY_REVIEWED", "This access event has already been reviewed");
  }
  const data = await prisma.campusAccessEvent.update({
    where: { id: event.id },
    data: {
      decision: body.decision,
      reviewedById: req.auth!.userId,
      reviewNotes: body.reviewNotes,
      reviewedAt: new Date(),
    },
  });
  await prisma.auditLog.create({
    data: {
      organizationId: req.auth!.organizationId,
      actorId: req.auth!.userId,
      action: "CAMPUS_ACCESS_EVENT_REVIEWED",
      entity: "CampusAccessEvent",
      entityId: event.id,
      metadata: { decision: body.decision },
    },
  });
  res.json({ data });
});

router.get("/device-hub/devices", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const q = z.object({
    kind: z.nativeEnum(ConnectedDeviceKind).optional(),
    status: z.nativeEnum(ConnectedDeviceStatus).optional(),
    branchId: cuid.optional(),
    search: z.string().trim().max(100).optional(),
  }).parse(req.query);
  if (q.branchId) await assertErpBranchTarget(scope, q.branchId);
  const branchWhere = erpBranchWhere(scope);
  const data = await prisma.connectedDevice.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      ...(req.auth!.role === Role.SUPER_ADMIN ? {} : branchWhere),
      ...(q.branchId ? { branchId: q.branchId } : {}),
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.search ? { OR: [
        { name: { contains: q.search, mode: "insensitive" } },
        { code: { contains: q.search, mode: "insensitive" } },
        { externalDeviceId: { contains: q.search, mode: "insensitive" } },
      ] } : {}),
    },
    include: { _count: { select: { events: true, bindings: true, commands: true } } },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });
  res.json({
    data: data.map(device => ({
      ...device,
      ingestTokenHash: undefined,
      health: connectedDeviceHealth({
        status: device.status,
        lastHeartbeatAt: device.lastHeartbeatAt,
        lastSeenAt: device.lastSeenAt,
      }),
    })),
  });
});

router.post("/device-hub/devices", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const body = deviceInput.parse(req.body);
  if (req.auth!.role === Role.BRANCH_ADMIN && !body.branchId) {
    throw new AppError(422, "DEVICE_BRANCH_REQUIRED", "Branch administrators must provision devices inside an assigned branch");
  }
  if (body.branchId) await assertErpBranchTarget(scope, body.branchId);
  if (body.signatureRequired && !body.signingPublicKey) {
    throw new AppError(422, "DEVICE_SIGNING_KEY_REQUIRED", "Signed device ingestion requires an Ed25519 public key");
  }
  if (body.signingPublicKey) {
    try {
      const key = crypto.createPublicKey(body.signingPublicKey);
      if (key.asymmetricKeyType !== "ed25519") throw new Error("not ed25519");
    } catch {
      throw new AppError(422, "DEVICE_SIGNING_KEY_INVALID", "Device signing key must be a valid Ed25519 public key");
    }
  }
  const token = generateConnectedDeviceIngestToken();
  try {
    const device = await prisma.connectedDevice.create({
      data: {
        organizationId: req.auth!.organizationId,
        branchId: body.branchId ?? null,
        code: body.code.toUpperCase(),
        name: body.name,
        kind: body.kind,
        protocol: body.protocol,
        providerKey: body.providerKey,
        externalDeviceId: body.externalDeviceId ?? null,
        signatureRequired: body.signatureRequired,
        signingPublicKey: body.signingPublicKey ?? null,
        capabilities: [...new Set(body.capabilities.map(value => value.toUpperCase()))],
        config: body.config ? profileJson(body.config) : undefined,
        metadata: body.metadata ? profileJson(body.metadata) : undefined,
        ingestTokenHash: hashConnectedDeviceIngestToken(token),
      },
      select: {
        id: true, organizationId: true, branchId: true, code: true, name: true, kind: true, protocol: true,
        providerKey: true, externalDeviceId: true, status: true, signatureRequired: true, signingPublicKey: true, capabilities: true, config: true, metadata: true,
        createdAt: true, updatedAt: true,
      },
    });
    await prisma.auditLog.create({
      data: {
        organizationId: req.auth!.organizationId,
        actorId: req.auth!.userId,
        action: "CONNECTED_DEVICE_CREATED",
        entity: "ConnectedDevice",
        entityId: device.id,
        metadata: { branchId: device.branchId, kind: device.kind, protocol: device.protocol, providerKey: device.providerKey },
      },
    });
    res.status(201).json({
      data: device,
      credential: { ingestToken: token, displayOnce: true },
      meta: { hardwareValidated: false, productionReady: false },
    });
  } catch (error: any) {
    if (error?.code === "P2002") throw new AppError(409, "DEVICE_ALREADY_EXISTS", "Device code or provider identity already exists");
    throw error;
  }
});

router.patch("/device-hub/devices/:deviceId", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const device = await deviceForOrganization(req.auth!.organizationId, cuid.parse(req.params.deviceId));
  if (device.branchId) assertErpBranchAccess(scope, device.branchId);
  const body = z.object({
    branchId: cuid.nullable().optional(),
    code: z.string().trim().min(2).max(80).regex(/^[A-Za-z0-9._-]+$/).optional(),
    name: z.string().trim().min(2).max(180).optional(),
    kind: z.nativeEnum(ConnectedDeviceKind).optional(),
    protocol: z.nativeEnum(ConnectedDeviceProtocol).optional(),
    providerKey: z.string().trim().min(2).max(100).optional(),
    externalDeviceId: z.string().trim().min(1).max(180).nullable().optional(),
    signatureRequired: z.boolean().optional(),
    signingPublicKey: z.string().trim().min(32).max(10000).nullable().optional(),
    capabilities: z.array(z.string().trim().min(1).max(80)).max(100).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    status: z.nativeEnum(ConnectedDeviceStatus).optional(),
    firmwareVersion: z.string().trim().max(100).nullable().optional(),
  }).parse(req.body);
  if (body.branchId !== undefined && body.branchId !== null) await assertErpBranchTarget(scope, body.branchId);
  const resultingSignatureRequired = body.signatureRequired ?? device.signatureRequired;
  const resultingSigningPublicKey = body.signingPublicKey === undefined ? device.signingPublicKey : body.signingPublicKey;
  if (resultingSignatureRequired && !resultingSigningPublicKey) {
    throw new AppError(422, "DEVICE_SIGNING_KEY_REQUIRED", "Signed device ingestion requires an Ed25519 public key");
  }
  if (resultingSigningPublicKey) {
    try {
      const key = crypto.createPublicKey(resultingSigningPublicKey);
      if (key.asymmetricKeyType !== "ed25519") throw new Error("not ed25519");
    } catch {
      throw new AppError(422, "DEVICE_SIGNING_KEY_INVALID", "Device signing key must be a valid Ed25519 public key");
    }
  }
  if (req.auth!.role === Role.BRANCH_ADMIN && body.branchId === null) {
    throw new AppError(422, "DEVICE_BRANCH_REQUIRED", "Branch administrators cannot move devices to organization scope");
  }
  const updated = await prisma.connectedDevice.update({
    where: { id: device.id },
    data: {
      ...body,
      code: body.code?.toUpperCase(),
      capabilities: body.capabilities ? [...new Set(body.capabilities.map(value => value.toUpperCase()))] : undefined,
      config: body.config ? profileJson(body.config) : undefined,
      metadata: body.metadata ? profileJson(body.metadata) : undefined,
    },
    select: {
      id: true, organizationId: true, branchId: true, code: true, name: true, kind: true, protocol: true,
      providerKey: true, externalDeviceId: true, status: true, signatureRequired: true, signingPublicKey: true, capabilities: true, config: true, metadata: true,
      firmwareVersion: true, lastHeartbeatAt: true, lastSeenAt: true, lastErrorAt: true, lastErrorCode: true, createdAt: true, updatedAt: true,
    },
  });
  res.json({ data: updated });
});

router.post("/device-hub/devices/:deviceId/rotate-token", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const device = await deviceForOrganization(req.auth!.organizationId, cuid.parse(req.params.deviceId));
  if (device.branchId) assertErpBranchAccess(scope, device.branchId);
  const token = generateConnectedDeviceIngestToken();
  await prisma.connectedDevice.update({
    where: { id: device.id },
    data: { ingestTokenHash: hashConnectedDeviceIngestToken(token) },
  });
  await prisma.auditLog.create({
    data: {
      organizationId: req.auth!.organizationId,
      actorId: req.auth!.userId,
      action: "CONNECTED_DEVICE_TOKEN_ROTATED",
      entity: "ConnectedDevice",
      entityId: device.id,
    },
  });
  res.json({ data: { deviceId: device.id }, credential: { ingestToken: token, displayOnce: true } });
});

const bindingInput = z.object({
  bindingType: z.nativeEnum(ConnectedDeviceBindingType),
  entityId: cuid,
  externalSubjectId: z.string().trim().min(1).max(180).optional(),
  label: z.string().trim().max(180).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  activeFrom: z.coerce.date().optional(),
  activeUntil: z.coerce.date().nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.activeUntil && value.activeFrom && value.activeUntil <= value.activeFrom) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["activeUntil"], message: "Binding end time must be after its start time" });
  }
});

async function validateBindingTarget(req: AuthRequest, type: ConnectedDeviceBindingType, entityId: string, deviceBranchId: string | null) {
  const organizationId = req.auth!.organizationId;
  if (type === ConnectedDeviceBindingType.EMPLOYEE) {
    const row = await prisma.employee.findFirst({ where: { id: entityId, organizationId }, select: { id: true, branchId: true } });
    if (!row) throw new AppError(422, "DEVICE_BINDING_TARGET_INVALID", "Employee binding target not found");
    if (deviceBranchId && row.branchId !== deviceBranchId) throw new AppError(422, "DEVICE_BINDING_BRANCH_MISMATCH", "Employee and device must belong to the same branch");
    return;
  }
  if (type === ConnectedDeviceBindingType.STUDENT) {
    const row = await prisma.studentProfile.findFirst({ where: { id: entityId, organizationId }, select: { id: true, branchId: true } });
    if (!row) throw new AppError(422, "DEVICE_BINDING_TARGET_INVALID", "Student binding target not found");
    if (deviceBranchId && row.branchId !== deviceBranchId) throw new AppError(422, "DEVICE_BINDING_BRANCH_MISMATCH", "Student and device must belong to the same branch");
    return;
  }
  if (type === ConnectedDeviceBindingType.VEHICLE) {
    const row = await prisma.transportVehicle.findFirst({ where: { id: entityId, organizationId }, select: { id: true, branchId: true } });
    if (!row) throw new AppError(422, "DEVICE_BINDING_TARGET_INVALID", "Vehicle binding target not found");
    if (deviceBranchId && row.branchId !== deviceBranchId) throw new AppError(422, "DEVICE_BINDING_BRANCH_MISMATCH", "Vehicle and device must belong to the same branch");
    return;
  }
  if (type === ConnectedDeviceBindingType.ROUTE) {
    const row = await prisma.transportRoute.findFirst({ where: { id: entityId, organizationId }, select: { id: true, branchId: true } });
    if (!row) throw new AppError(422, "DEVICE_BINDING_TARGET_INVALID", "Route binding target not found");
    if (deviceBranchId && row.branchId !== deviceBranchId) throw new AppError(422, "DEVICE_BINDING_BRANCH_MISMATCH", "Route and device must belong to the same branch");
  }
}

router.get("/device-hub/devices/:deviceId/bindings", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const device = await deviceForOrganization(req.auth!.organizationId, cuid.parse(req.params.deviceId));
  if (device.branchId) assertErpBranchAccess(scope, device.branchId);
  const data = await prisma.connectedDeviceBinding.findMany({
    where: { organizationId: req.auth!.organizationId, deviceId: device.id },
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
  });
  res.json({ data });
});

router.post("/device-hub/devices/:deviceId/bindings", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const device = await deviceForOrganization(req.auth!.organizationId, cuid.parse(req.params.deviceId));
  if (device.branchId) assertErpBranchAccess(scope, device.branchId);
  const body = bindingInput.parse(req.body);
  await validateBindingTarget(req, body.bindingType, body.entityId, device.branchId);
  try {
    const data = await prisma.connectedDeviceBinding.create({
      data: {
        organizationId: req.auth!.organizationId,
        deviceId: device.id,
        bindingType: body.bindingType,
        entityId: body.entityId,
        externalSubjectId: body.externalSubjectId,
        label: body.label,
        metadata: body.metadata ? profileJson(body.metadata) : undefined,
        activeFrom: body.activeFrom ?? new Date(),
        activeUntil: body.activeUntil ?? null,
      },
    });
    res.status(201).json({ data });
  } catch (error: any) {
    if (error?.code === "P2002") throw new AppError(409, "DEVICE_BINDING_EXISTS", "This device binding already exists");
    throw error;
  }
});

router.patch("/device-hub/bindings/:bindingId", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const binding = await prisma.connectedDeviceBinding.findFirst({
    where: { id: cuid.parse(req.params.bindingId), organizationId: req.auth!.organizationId },
    include: { device: { select: { branchId: true } } },
  });
  if (!binding) throw new AppError(404, "DEVICE_BINDING_NOT_FOUND", "Device binding not found");
  if (binding.device.branchId) assertErpBranchAccess(scope, binding.device.branchId);
  const body = z.object({
    isActive: z.boolean().optional(),
    activeUntil: z.coerce.date().nullable().optional(),
    label: z.string().trim().max(180).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }).parse(req.body);
  const data = await prisma.connectedDeviceBinding.update({
    where: { id: binding.id },
    data: {
      ...body,
      metadata: body.metadata ? profileJson(body.metadata) : undefined,
    },
  });
  res.json({ data });
});

router.get("/device-hub/devices/:deviceId/events", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const device = await deviceForOrganization(req.auth!.organizationId, cuid.parse(req.params.deviceId));
  if (device.branchId) assertErpBranchAccess(scope, device.branchId);
  const q = z.object({
    limit: z.coerce.number().int().min(1).max(500).default(100),
    eventType: z.string().trim().max(120).optional(),
    since: z.coerce.date().optional(),
  }).parse(req.query);
  const data = await prisma.connectedDeviceEvent.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      deviceId: device.id,
      ...(q.eventType ? { eventType: q.eventType.toUpperCase() } : {}),
      ...(q.since ? { occurredAt: { gte: q.since } } : {}),
    },
    take: q.limit,
    orderBy: { occurredAt: "desc" },
  });
  res.json({ data });
});

router.get("/device-hub/devices/:deviceId/health", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const device = await deviceForOrganization(req.auth!.organizationId, cuid.parse(req.params.deviceId));
  if (device.branchId) assertErpBranchAccess(scope, device.branchId);
  const staleAfterSeconds = z.coerce.number().int().min(30).max(86400).default(300).parse(req.query.staleAfterSeconds);
  res.json({
    data: {
      deviceId: device.id,
      status: device.status,
      health: connectedDeviceHealth({
        status: device.status,
        lastHeartbeatAt: device.lastHeartbeatAt,
        lastSeenAt: device.lastSeenAt,
        staleAfterSeconds,
      }),
      lastErrorAt: device.lastErrorAt,
      lastErrorCode: device.lastErrorCode,
      firmwareVersion: device.firmwareVersion,
    },
  });
});

router.post("/device-hub/devices/:deviceId/commands", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const device = await deviceForOrganization(req.auth!.organizationId, cuid.parse(req.params.deviceId));
  if (device.branchId) assertErpBranchAccess(scope, device.branchId);
  if ([ConnectedDeviceStatus.DISABLED, ConnectedDeviceStatus.RETIRED].includes(device.status)) {
    throw new AppError(409, "DEVICE_COMMAND_DISABLED", "Disabled or retired devices cannot accept commands");
  }
  const body = z.object({
    commandType: z.string().trim().min(1).max(120),
    payload: z.record(z.string(), z.unknown()).optional(),
    idempotencyKey: z.string().trim().min(8).max(180),
  }).parse(req.body);
  try {
    const data = await prisma.connectedDeviceCommand.create({
      data: {
        organizationId: req.auth!.organizationId,
        deviceId: device.id,
        commandType: body.commandType.toUpperCase(),
        payload: body.payload ? profileJson(body.payload) : undefined,
        idempotencyKey: body.idempotencyKey,
        requestedById: req.auth!.userId,
      },
    });
    res.status(202).json({
      data,
      meta: {
        dispatched: false,
        guidance: "Command is queued in Device Hub. A protocol adapter must acknowledge delivery before it is considered sent.",
      },
    });
  } catch (error: any) {
    if (error?.code === "P2002") {
      const existing = await prisma.connectedDeviceCommand.findFirst({
        where: { deviceId: device.id, idempotencyKey: body.idempotencyKey },
      });
      return res.status(200).json({ data: existing, meta: { duplicate: true, dispatched: false } });
    }
    throw error;
  }
});

export default router;
