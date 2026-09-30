import {
  ConnectedDeviceBindingType,
  ConnectedDeviceKind,
  ConnectedDeviceProtocol,
  ConnectedDeviceStatus,
  Prisma,
  Role,
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
import { AppError } from "../lib/http.js";
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

  try {
    const event = await prisma.$transaction(async tx => {
      const created = await tx.connectedDeviceEvent.create({
        data: {
          organizationId: device.organizationId,
          deviceId: device.id,
          externalEventId: envelope.externalEventId,
          eventType: normalized.eventType,
          occurredAt: normalized.occurredAt,
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
  capabilities: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
  config: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
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
        capabilities: [...new Set(body.capabilities.map(value => value.toUpperCase()))],
        config: body.config ? profileJson(body.config) : undefined,
        metadata: body.metadata ? profileJson(body.metadata) : undefined,
        ingestTokenHash: hashConnectedDeviceIngestToken(token),
      },
      select: {
        id: true, organizationId: true, branchId: true, code: true, name: true, kind: true, protocol: true,
        providerKey: true, externalDeviceId: true, status: true, capabilities: true, config: true, metadata: true,
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
  const body = deviceInput.partial().extend({
    status: z.nativeEnum(ConnectedDeviceStatus).optional(),
    firmwareVersion: z.string().trim().max(100).nullable().optional(),
  }).parse(req.body);
  if (body.branchId !== undefined && body.branchId !== null) await assertErpBranchTarget(scope, body.branchId);
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
      providerKey: true, externalDeviceId: true, status: true, capabilities: true, config: true, metadata: true,
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
