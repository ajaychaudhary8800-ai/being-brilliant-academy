import crypto from "node:crypto";
import {
  CameraAccessAction,
  CameraExportStatus,
  CameraIncidentSeverity,
  CameraIncidentStatus,
  CameraSessionStatus,
  CameraStreamKind,
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
import { queueDeviceEventRetry } from "../lib/device-hub-retry-worker.js";
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

function cameraSessionTokenHash(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function safeMediaResult(value: unknown) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const safeUrl = (candidate: unknown, protocols: string[]) => {
    if (typeof candidate !== "string" || candidate.length > 4000) return null;
    try {
      const url = new URL(candidate);
      return protocols.includes(url.protocol) ? candidate : null;
    } catch {
      return null;
    }
  };
  return {
    hlsUrl: safeUrl(record.hlsUrl, ["https:"]),
    webrtcUrl: safeUrl(record.webrtcUrl, ["https:", "wss:"]),
    downloadUrl: safeUrl(record.downloadUrl, ["https:"]),
    expiresAt: typeof record.expiresAt === "string" ? record.expiresAt : null,
  };
}

async function edgeAgentForToken(agentId: string, token: string) {
  const agent = await prisma.connectedCampusEdgeAgent.findUnique({ where: { id: agentId } });
  if (!agent || !verifyEdgeAgentToken(token, agent.tokenHash)) {
    throw new AppError(401, "EDGE_AGENT_UNAUTHORIZED", "Edge Agent token is invalid");
  }
  if (agent.status === EdgeAgentStatus.DISABLED) {
    throw new AppError(409, "EDGE_AGENT_DISABLED", "Edge Agent is disabled");
  }
  return agent;
}

router.post("/device-hub/edge-agents/:agentId/heartbeat", async (req, res) => {
  const agentId = cuid.parse(req.params.agentId);
  const token = req.header("x-edge-agent-token")?.trim() ?? "";
  const agent = await edgeAgentForToken(agentId, token);
  const body = z.object({
    version: z.string().trim().max(100).optional(),
    os: z.string().trim().max(180).optional(),
    hostname: z.string().trim().max(240).optional(),
    capabilities: z.array(z.string().trim().min(1).max(80)).max(200).optional(),
    lastErrorCode: z.string().trim().max(180).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }).parse(req.body);
  const now = new Date();
  const ipHash = req.ip ? crypto.createHash("sha256").update(req.ip).digest("hex") : null;
  const data = await prisma.connectedCampusEdgeAgent.update({
    where: { id: agent.id },
    data: {
      status: body.lastErrorCode ? EdgeAgentStatus.DEGRADED : EdgeAgentStatus.ONLINE,
      lastHeartbeatAt: now,
      lastSeenAt: now,
      version: body.version,
      os: body.os,
      hostname: body.hostname,
      capabilities: body.capabilities ? [...new Set(body.capabilities.map(item => item.toUpperCase()))] : undefined,
      lastErrorCode: body.lastErrorCode,
      lastIpHash: ipHash,
      metadata: body.metadata ? profileJson(body.metadata) : undefined,
    },
    select: {
      id: true, branchId: true, code: true, status: true, version: true, capabilities: true,
      lastHeartbeatAt: true, lastSeenAt: true, lastErrorCode: true,
    },
  });
  res.json({ data });
});

router.get("/device-hub/edge-agents/:agentId/commands", async (req, res) => {
  const agentId = cuid.parse(req.params.agentId);
  const token = req.header("x-edge-agent-token")?.trim() ?? "";
  const agent = await edgeAgentForToken(agentId, token);
  const now = new Date();
  const retryCutoff = new Date(now.getTime() - 60_000);
  const commands = await prisma.connectedDeviceCommand.findMany({
    where: {
      organizationId: agent.organizationId,
      device: { branchId: agent.branchId },
      OR: [
        { status: ConnectedDeviceCommandStatus.QUEUED },
        { status: ConnectedDeviceCommandStatus.SENT, sentAt: { lt: retryCutoff } },
      ],
    },
    include: { device: { select: { id: true, code: true, kind: true, protocol: true, externalDeviceId: true } } },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  if (commands.length) {
    await prisma.connectedDeviceCommand.updateMany({
      where: { id: { in: commands.map(item => item.id) }, organizationId: agent.organizationId },
      data: { status: ConnectedDeviceCommandStatus.SENT, sentAt: now },
    });
  }
  res.json({ data: commands, meta: { agentId: agent.id, branchId: agent.branchId, polledAt: now } });
});

router.post("/device-hub/edge-agents/:agentId/commands/:commandId/ack", async (req, res) => {
  const agentId = cuid.parse(req.params.agentId);
  const token = req.header("x-edge-agent-token")?.trim() ?? "";
  const agent = await edgeAgentForToken(agentId, token);
  const body = z.object({
    outcome: z.enum(["ACKNOWLEDGED","FAILED"]),
    errorCode: z.string().trim().max(180).optional(),
    errorMessage: z.string().trim().max(5000).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }).parse(req.body);
  const command = await prisma.connectedDeviceCommand.findFirst({
    where: {
      id: cuid.parse(req.params.commandId),
      organizationId: agent.organizationId,
      device: { branchId: agent.branchId },
    },
    include: { device: { select: { id: true, code: true } } },
  });
  if (!command) throw new AppError(404, "DEVICE_COMMAND_NOT_FOUND", "Device command not found for this Edge Agent");

  const now = new Date();
  if (body.outcome === "ACKNOWLEDGED") {
    const data = await prisma.$transaction(async tx => {
      const updated = await tx.connectedDeviceCommand.update({
        where: { id: command.id },
        data: {
          status: ConnectedDeviceCommandStatus.ACKNOWLEDGED,
          acknowledgedAt: now,
          failedAt: null,
          errorCode: null,
          errorMessage: null,
          result: body.metadata ? profileJson(body.metadata) : undefined,
        },
      });
      await tx.connectedDeviceRetryJob.updateMany({
        where: { organizationId: agent.organizationId, commandId: command.id, status: { in: [DeviceRetryStatus.QUEUED, DeviceRetryStatus.PROCESSING] } },
        data: { status: DeviceRetryStatus.COMPLETED, lastAttemptAt: now },
      });
      return updated;
    });
    return res.json({ data });
  }

  const dedupeKey = `command:${command.id}`;
  const existing = await prisma.connectedDeviceRetryJob.findUnique({ where: { dedupeKey } });
  const retry = nextRetryState({ attempts: existing?.attempts ?? 0, maxAttempts: existing?.maxAttempts ?? 8, now });
  const data = await prisma.$transaction(async tx => {
    const updated = await tx.connectedDeviceCommand.update({
      where: { id: command.id },
      data: {
        status: ConnectedDeviceCommandStatus.FAILED,
        failedAt: now,
        errorCode: body.errorCode ?? "EDGE_COMMAND_FAILED",
        errorMessage: body.errorMessage ?? "Edge Agent reported command failure",
      },
    });
    await tx.connectedDeviceRetryJob.upsert({
      where: { dedupeKey },
      create: {
        organizationId: agent.organizationId,
        deviceId: command.deviceId,
        commandId: command.id,
        operation: "COMMAND_DELIVERY",
        dedupeKey,
        status: retry.status,
        attempts: retry.attempts,
        maxAttempts: 8,
        nextAttemptAt: retry.nextAttemptAt ?? now,
        lastAttemptAt: now,
        lastErrorCode: body.errorCode ?? "EDGE_COMMAND_FAILED",
        lastErrorMessage: body.errorMessage ?? "Edge Agent reported command failure",
        payload: body.metadata ? profileJson(body.metadata) : undefined,
      },
      update: {
        status: retry.status,
        attempts: retry.attempts,
        nextAttemptAt: retry.nextAttemptAt ?? now,
        lastAttemptAt: now,
        lastErrorCode: body.errorCode ?? "EDGE_COMMAND_FAILED",
        lastErrorMessage: body.errorMessage ?? "Edge Agent reported command failure",
        payload: body.metadata ? profileJson(body.metadata) : undefined,
      },
    });
    return updated;
  });
  res.status(202).json({ data, meta: { retryStatus: retry.status, nextAttemptAt: retry.nextAttemptAt } });
});

router.get("/device-hub/camera-media/:sessionId", async (req, res) => {
  const token = req.header("x-camera-session-token")?.trim() ?? "";
  if (!token) throw new AppError(401, "CAMERA_SESSION_TOKEN_REQUIRED", "Camera session token required");
  const session = await prisma.cameraViewSession.findUnique({
    where: { id: cuid.parse(req.params.sessionId) },
  });
  if (!session || cameraSessionTokenHash(token) !== session.tokenHash) {
    throw new AppError(401, "CAMERA_SESSION_UNAUTHORIZED", "Camera session token is invalid");
  }
  const now = new Date();
  if (session.expiresAt <= now || session.status === CameraSessionStatus.EXPIRED || session.status === CameraSessionStatus.REVOKED) {
    if (session.status !== CameraSessionStatus.EXPIRED) {
      await prisma.cameraViewSession.update({ where: { id: session.id }, data: { status: CameraSessionStatus.EXPIRED } }).catch(() => {});
    }
    throw new AppError(410, "CAMERA_SESSION_EXPIRED", "Camera media session has expired");
  }
  if (!session.commandId) throw new AppError(409, "CAMERA_SESSION_PENDING", "Camera media session is waiting for edge dispatch");
  const command = await prisma.connectedDeviceCommand.findFirst({
    where: { id: session.commandId, organizationId: session.organizationId },
    select: { status: true, result: true, errorCode: true, errorMessage: true },
  });
  if (!command) throw new AppError(409, "CAMERA_SESSION_PENDING", "Camera media command is not available");
  if (command.status === ConnectedDeviceCommandStatus.FAILED) {
    await prisma.cameraViewSession.update({
      where: { id: session.id },
      data: { status: CameraSessionStatus.FAILED, errorCode: command.errorCode ?? "CAMERA_EDGE_FAILED" },
    }).catch(() => {});
    throw new AppError(502, "CAMERA_SESSION_FAILED", command.errorMessage ?? "Camera edge adapter failed to create media session");
  }
  if (command.status !== ConnectedDeviceCommandStatus.ACKNOWLEDGED) {
    return res.status(202).json({ data: { id: session.id, status: CameraSessionStatus.PENDING } });
  }
  const media = safeMediaResult(command.result);
  if (!media.hlsUrl && !media.webrtcUrl) {
    await prisma.cameraViewSession.update({
      where: { id: session.id },
      data: { status: CameraSessionStatus.FAILED, errorCode: "CAMERA_MEDIA_RESULT_INVALID" },
    });
    throw new AppError(502, "CAMERA_MEDIA_RESULT_INVALID", "Edge adapter did not return an approved HTTPS/WSS media URL");
  }
  await prisma.cameraViewSession.update({
    where: { id: session.id },
    data: { status: CameraSessionStatus.READY, lastAccessAt: now },
  });
  res.setHeader("Cache-Control", "no-store");
  res.json({
    data: {
      id: session.id,
      kind: session.kind,
      status: CameraSessionStatus.READY,
      media: { hlsUrl: media.hlsUrl, webrtcUrl: media.webrtcUrl, expiresAt: media.expiresAt },
      watermarkText: session.watermarkText,
      expiresAt: session.expiresAt,
    },
  });
});

router.post("/device-hub/ingest/:deviceId", async (req, res) => {
  const deviceId = cuid.parse(req.params.deviceId);
  const token = req.header("x-device-token")?.trim() ?? "";
  const device = await prisma.connectedDevice.findUnique({ where: { id: deviceId } });
  if (!device || !verifyConnectedDeviceIngestToken(token, device.ingestTokenHash)) {
    throw new AppError(401, "DEVICE_INGEST_UNAUTHORIZED", "Device ingest token is invalid");
  }
  if (device.status === ConnectedDeviceStatus.DISABLED || device.status === ConnectedDeviceStatus.RETIRED) {
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
    const persisted = await prisma.connectedDeviceEvent.findFirst({
      where: { deviceId: device.id, sourceHash },
      select: { id: true, status: true },
    }).catch(() => null);
    if (persisted && ![ "PROCESSED", "REJECTED" ].includes(persisted.status)) {
      await queueDeviceEventRetry({
        organizationId: device.organizationId,
        deviceId: device.id,
        eventId: persisted.id,
        errorCode: "EVENT_PROCESS_FAILED",
        errorMessage: error instanceof Error ? error.message : "Device event processing failed",
      }).catch(() => {});
      await prisma.connectedDevice.update({
        where: { id: device.id },
        data: {
          status: ConnectedDeviceStatus.DEGRADED,
          lastErrorAt: now,
          lastErrorCode: "EVENT_PROCESS_RETRY_QUEUED",
        },
      }).catch(() => {});
      return res.status(202).json({
        data: { id: persisted.id, status: persisted.status },
        meta: { duplicate: false, normalized: true, processing: { queuedForRetry: true } },
      });
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

router.get("/device-hub/adapters", async (req: AuthRequest, res) => {
  const data = await prisma.deviceAdapterRegistry.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });
  res.json({ data });
});

const secretReference = z.string().trim().min(3).max(300).superRefine((value, ctx) => {
  if (/^(https?|rtsp|mqtt):\/\//i.test(value) || /:\/\/[^/]*@/.test(value) || /(?:password|token|secret)=/i.test(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Store a secret-manager reference, not raw credentials or endpoint secrets" });
  }
});

router.get("/device-hub/connectors", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const data = await prisma.deviceConnectorInstance.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      ...(req.auth!.role === Role.SUPER_ADMIN ? {} : { branchId: { in: scope } }),
    },
    include: { adapter: true },
    orderBy: { name: "asc" },
  });
  res.json({
    data: data.map(item => ({
      ...item,
      secretRef: item.secretRef ? "[configured]" : null,
      health: connectorHealth({
        status: item.status,
        lastSuccessAt: item.lastSuccessAt,
        lastErrorAt: item.lastErrorAt,
        consecutiveFailures: item.consecutiveFailures,
        latencyMs: item.latencyMs,
      }),
    })),
  });
});

router.post("/device-hub/connectors", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const body = z.object({
    branchId: cuid.nullable().optional(),
    adapterKey: z.string().trim().min(2).max(100),
    name: z.string().trim().min(2).max(180),
    secretRef: secretReference.nullable().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  }).parse(req.body);
  if (req.auth!.role === Role.BRANCH_ADMIN && !body.branchId) {
    throw new AppError(422, "CONNECTOR_BRANCH_REQUIRED", "Branch administrators must configure connectors inside an assigned branch");
  }
  if (body.branchId) await assertErpBranchTarget(scope, body.branchId);
  const adapter = await prisma.deviceAdapterRegistry.findUnique({ where: { key: body.adapterKey } });
  if (!adapter || !adapter.isActive) throw new AppError(422, "DEVICE_ADAPTER_INVALID", "Selected Device Hub adapter is not active");
  if (adapter.requiredEntitlement) await assertFeatureEntitled(req.auth!.organizationId, adapter.requiredEntitlement);
  try {
    const data = await prisma.deviceConnectorInstance.create({
      data: {
        organizationId: req.auth!.organizationId,
        branchId: body.branchId ?? null,
        adapterId: adapter.id,
        name: body.name,
        secretRef: body.secretRef ?? null,
        config: body.config ? profileJson(body.config) : undefined,
        createdById: req.auth!.userId,
      },
      include: { adapter: true },
    });
    res.status(201).json({ data: { ...data, secretRef: data.secretRef ? "[configured]" : null } });
  } catch (error: any) {
    if (error?.code === "P2002") throw new AppError(409, "DEVICE_CONNECTOR_EXISTS", "Connector name already exists in this organization");
    throw error;
  }
});

router.patch("/device-hub/connectors/:connectorId", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const connector = await prisma.deviceConnectorInstance.findFirst({
    where: { id: cuid.parse(req.params.connectorId), organizationId: req.auth!.organizationId },
    include: { adapter: true },
  });
  if (!connector) throw new AppError(404, "DEVICE_CONNECTOR_NOT_FOUND", "Device connector not found");
  if (connector.branchId) assertErpBranchAccess(scope, connector.branchId);
  const body = z.object({
    status: z.nativeEnum(DeviceConnectorStatus).optional(),
    secretRef: secretReference.nullable().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  }).parse(req.body);
  const data = await prisma.deviceConnectorInstance.update({
    where: { id: connector.id },
    data: {
      status: body.status,
      secretRef: body.secretRef,
      config: body.config ? profileJson(body.config) : undefined,
    },
    include: { adapter: true },
  });
  res.json({ data: { ...data, secretRef: data.secretRef ? "[configured]" : null } });
});

router.post("/device-hub/connectors/:connectorId/health-report", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const connector = await prisma.deviceConnectorInstance.findFirst({
    where: { id: cuid.parse(req.params.connectorId), organizationId: req.auth!.organizationId },
  });
  if (!connector) throw new AppError(404, "DEVICE_CONNECTOR_NOT_FOUND", "Device connector not found");
  if (connector.branchId) assertErpBranchAccess(scope, connector.branchId);
  const body = z.object({
    ok: z.boolean(),
    latencyMs: z.number().int().min(0).max(600_000).optional(),
    errorCode: z.string().trim().max(180).optional(),
    errorMessage: z.string().trim().max(5000).optional(),
  }).parse(req.body);
  const now = new Date();
  const data = await prisma.deviceConnectorInstance.update({
    where: { id: connector.id },
    data: body.ok ? {
      status: DeviceConnectorStatus.ACTIVE,
      lastSyncAt: now,
      lastSuccessAt: now,
      latencyMs: body.latencyMs,
      consecutiveFailures: 0,
      lastErrorAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    } : {
      status: DeviceConnectorStatus.DEGRADED,
      lastSyncAt: now,
      latencyMs: body.latencyMs,
      consecutiveFailures: { increment: 1 },
      lastErrorAt: now,
      lastErrorCode: body.errorCode ?? "CONNECTOR_HEALTH_FAILED",
      lastErrorMessage: body.errorMessage ?? "Connector health check failed",
    },
  });
  res.json({
    data: {
      ...data,
      secretRef: data.secretRef ? "[configured]" : null,
      health: connectorHealth({
        status: data.status,
        lastSuccessAt: data.lastSuccessAt,
        lastErrorAt: data.lastErrorAt,
        consecutiveFailures: data.consecutiveFailures,
        latencyMs: data.latencyMs,
      }),
    },
  });
});

router.get("/device-hub/edge-agents", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const data = await prisma.connectedCampusEdgeAgent.findMany({
    where: { organizationId: req.auth!.organizationId, branchId: { in: scope } },
    orderBy: { name: "asc" },
  });
  res.json({ data: data.map(item => ({ ...item, tokenHash: undefined, publicKey: item.publicKey ? "[configured]" : null })) });
});

router.post("/device-hub/edge-agents", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const body = z.object({
    branchId: cuid,
    code: z.string().trim().min(2).max(80).regex(/^[A-Za-z0-9._-]+$/),
    name: z.string().trim().min(2).max(180),
    publicKey: z.string().trim().min(32).max(10000).nullable().optional(),
    capabilities: z.array(z.string().trim().min(1).max(100)).max(200).default([]),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }).parse(req.body);
  await assertErpBranchTarget(scope, body.branchId);
  await assertFeatureEntitled(req.auth!.organizationId, "connectedCampus");
  const token = generateEdgeAgentToken();
  try {
    const data = await prisma.connectedCampusEdgeAgent.create({
      data: {
        organizationId: req.auth!.organizationId,
        branchId: body.branchId,
        code: body.code.toUpperCase(),
        name: body.name,
        tokenHash: hashEdgeAgentToken(token),
        publicKey: body.publicKey ?? null,
        capabilities: [...new Set(body.capabilities.map(item => item.toUpperCase()))],
        metadata: body.metadata ? profileJson(body.metadata) : undefined,
      },
      select: {
        id: true, organizationId: true, branchId: true, code: true, name: true, status: true,
        capabilities: true, createdAt: true, updatedAt: true,
      },
    });
    res.status(201).json({ data, credential: { token, displayOnce: true }, meta: { productionReady: false, hardwareValidated: false } });
  } catch (error: any) {
    if (error?.code === "P2002") throw new AppError(409, "EDGE_AGENT_EXISTS", "Edge Agent code already exists in this branch");
    throw error;
  }
});

router.post("/device-hub/edge-agents/:agentId/rotate-token", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const agent = await prisma.connectedCampusEdgeAgent.findFirst({
    where: { id: cuid.parse(req.params.agentId), organizationId: req.auth!.organizationId },
  });
  if (!agent) throw new AppError(404, "EDGE_AGENT_NOT_FOUND", "Edge Agent not found");
  assertErpBranchAccess(scope, agent.branchId);
  const token = generateEdgeAgentToken();
  await prisma.connectedCampusEdgeAgent.update({
    where: { id: agent.id },
    data: { tokenHash: hashEdgeAgentToken(token), status: EdgeAgentStatus.PROVISIONING },
  });
  await prisma.auditLog.create({
    data: {
      organizationId: req.auth!.organizationId,
      actorId: req.auth!.userId,
      action: "EDGE_AGENT_TOKEN_ROTATED",
      entity: "ConnectedCampusEdgeAgent",
      entityId: agent.id,
    },
  });
  res.json({ data: { agentId: agent.id }, credential: { token, displayOnce: true } });
});

router.patch("/device-hub/edge-agents/:agentId", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const agent = await prisma.connectedCampusEdgeAgent.findFirst({
    where: { id: cuid.parse(req.params.agentId), organizationId: req.auth!.organizationId },
  });
  if (!agent) throw new AppError(404, "EDGE_AGENT_NOT_FOUND", "Edge Agent not found");
  assertErpBranchAccess(scope, agent.branchId);
  const body = z.object({
    status: z.nativeEnum(EdgeAgentStatus).optional(),
    name: z.string().trim().min(2).max(180).optional(),
    publicKey: z.string().trim().min(32).max(10000).nullable().optional(),
    capabilities: z.array(z.string().trim().min(1).max(100)).max(200).optional(),
  }).parse(req.body);
  const data = await prisma.connectedCampusEdgeAgent.update({
    where: { id: agent.id },
    data: {
      ...body,
      capabilities: body.capabilities ? [...new Set(body.capabilities.map(item => item.toUpperCase()))] : undefined,
    },
    select: {
      id: true, organizationId: true, branchId: true, code: true, name: true, status: true, version: true,
      os: true, hostname: true, capabilities: true, lastHeartbeatAt: true, lastSeenAt: true, lastErrorCode: true,
      createdAt: true, updatedAt: true,
    },
  });
  res.json({ data });
});

router.get("/device-hub/retries", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const q = z.object({
    status: z.nativeEnum(DeviceRetryStatus).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  }).parse(req.query);
  const data = await prisma.connectedDeviceRetryJob.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      device: { ...(req.auth!.role === Role.SUPER_ADMIN ? {} : { branchId: { in: scope } }) },
      ...(q.status ? { status: q.status } : {}),
    },
    include: { device: { select: { id: true, code: true, branchId: true, kind: true } } },
    orderBy: [{ status: "asc" }, { nextAttemptAt: "asc" }],
    take: q.limit,
  });
  res.json({ data });
});

router.post("/device-hub/retries/:retryId/requeue", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const retry = await prisma.connectedDeviceRetryJob.findFirst({
    where: { id: cuid.parse(req.params.retryId), organizationId: req.auth!.organizationId },
    include: { device: { select: { branchId: true } } },
  });
  if (!retry) throw new AppError(404, "DEVICE_RETRY_NOT_FOUND", "Device retry job not found");
  if (retry.device.branchId) assertErpBranchAccess(scope, retry.device.branchId);
  const data = await prisma.connectedDeviceRetryJob.update({
    where: { id: retry.id },
    data: { status: DeviceRetryStatus.QUEUED, nextAttemptAt: new Date(), lastErrorCode: null, lastErrorMessage: null },
  });
  if (retry.commandId) {
    await prisma.connectedDeviceCommand.updateMany({
      where: { id: retry.commandId, organizationId: req.auth!.organizationId },
      data: { status: ConnectedDeviceCommandStatus.QUEUED },
    });
  }
  res.json({ data });
});

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

const cameraBaseInput = z.object({
  branchId: cuid,
  code: z.string().trim().min(2).max(80).regex(/^[A-Za-z0-9._-]+$/),
  name: z.string().trim().min(2).max(180),
  deviceId: cuid,
  zone: z.string().trim().max(180).nullable().optional(),
  location: z.string().trim().max(300).nullable().optional(),
  building: z.string().trim().max(180).nullable().optional(),
  floor: z.string().trim().max(80).nullable().optional(),
  groupName: z.string().trim().max(180).nullable().optional(),
  mapX: z.number().min(-100000).max(100000).nullable().optional(),
  mapY: z.number().min(-100000).max(100000).nullable().optional(),
  nvrRef: z.string().trim().max(180).nullable().optional(),
  channelRef: z.string().trim().max(180).nullable().optional(),
  vehicleId: cuid.nullable().optional(),
  streamSecretRef: z.string().trim().min(3).max(300).nullable().optional(),
  recordingSecretRef: z.string().trim().min(3).max(300).nullable().optional(),
  retentionDays: z.number().int().min(1).max(365).default(30),
  privacyMasking: z.boolean().default(true),
  watermarkEnabled: z.boolean().default(true),
  audioEnabled: z.boolean().default(false),
  aiReviewEnabled: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

const cameraInput = cameraBaseInput.superRefine((value, ctx) => {
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
  if (incident.status === SafetyIncidentStatus.RESOLVED || incident.status === SafetyIncidentStatus.FALSE_ALARM) {
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

async function scopedCamera(req: AuthRequest, cameraId: string) {
  const scope = await erpBranchScope(req);
  const camera = await prisma.campusCamera.findFirst({
    where: { id: cameraId, organizationId: req.auth!.organizationId, isActive: true },
  });
  if (!camera) throw new AppError(404, "CAMERA_NOT_FOUND", "Active campus camera not found");
  assertErpBranchAccess(scope, camera.branchId);
  return camera;
}

router.post("/device-hub/cameras/:cameraId/sessions", async (req: AuthRequest, res) => {
  const camera = await scopedCamera(req, cuid.parse(req.params.cameraId));
  const body = z.object({
    kind: z.nativeEnum(CameraStreamKind),
    playbackFrom: z.coerce.date().optional(),
    playbackTo: z.coerce.date().optional(),
  }).superRefine((value, ctx) => {
    if (value.kind === CameraStreamKind.PLAYBACK && (!value.playbackFrom || !value.playbackTo)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["playbackFrom"], message: "Playback requires start and end time" });
    }
    if (value.playbackFrom && value.playbackTo && value.playbackTo <= value.playbackFrom) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["playbackTo"], message: "Playback end must be after start" });
    }
    if (value.playbackFrom && value.playbackTo && value.playbackTo.getTime() - value.playbackFrom.getTime() > 4 * 60 * 60_000) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["playbackTo"], message: "One playback session cannot exceed four hours" });
    }
  }).parse(req.body);

  const now = new Date();
  if (body.kind === CameraStreamKind.PLAYBACK && body.playbackFrom) {
    const retentionStart = new Date(now.getTime() - camera.retentionDays * 24 * 60 * 60_000);
    if (body.playbackFrom < retentionStart) throw new AppError(410, "CAMERA_PLAYBACK_OUTSIDE_RETENTION", "Requested playback is outside camera retention policy");
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = cameraSessionTokenHash(token);
  const expiresAt = new Date(now.getTime() + 10 * 60_000);
  const watermarkText = camera.watermarkEnabled ? `${camera.code} • ${req.auth!.userId} • ${now.toISOString()}` : null;

  const result = await prisma.$transaction(async tx => {
    const session = await tx.cameraViewSession.create({
      data: {
        organizationId: req.auth!.organizationId,
        cameraId: camera.id,
        requestedById: req.auth!.userId,
        kind: body.kind,
        tokenHash,
        playbackFrom: body.kind === CameraStreamKind.PLAYBACK ? body.playbackFrom : null,
        playbackTo: body.kind === CameraStreamKind.PLAYBACK ? body.playbackTo : null,
        expiresAt,
        watermarkText,
      },
    });
    const command = await tx.connectedDeviceCommand.create({
      data: {
        organizationId: req.auth!.organizationId,
        deviceId: camera.deviceId,
        commandType: "CAMERA_CREATE_STREAM_SESSION",
        idempotencyKey: `camera-session:${session.id}`,
        requestedById: req.auth!.userId,
        payload: profileJson({
          sessionId: session.id,
          kind: body.kind,
          playbackFrom: body.playbackFrom?.toISOString() ?? null,
          playbackTo: body.playbackTo?.toISOString() ?? null,
          expiresAt: expiresAt.toISOString(),
          watermarkText,
          nvrRef: camera.nvrRef,
          channelRef: camera.channelRef,
          streamSecretRef: camera.streamSecretRef,
          recordingSecretRef: camera.recordingSecretRef,
        }),
      },
    });
    const updated = await tx.cameraViewSession.update({ where: { id: session.id }, data: { commandId: command.id } });
    await tx.cameraAccessAudit.create({
      data: {
        organizationId: req.auth!.organizationId,
        cameraId: camera.id,
        userId: req.auth!.userId,
        action: body.kind === CameraStreamKind.LIVE ? CameraAccessAction.LIVE_SESSION : CameraAccessAction.PLAYBACK_SESSION,
        sessionId: session.id,
        metadata: profileJson({ commandId: command.id, playbackFrom: body.playbackFrom?.toISOString() ?? null, playbackTo: body.playbackTo?.toISOString() ?? null }),
      },
    });
    return updated;
  });

  res.status(202).json({
    data: {
      id: result.id,
      cameraId: result.cameraId,
      kind: result.kind,
      status: result.status,
      expiresAt: result.expiresAt,
      watermarkText: result.watermarkText,
    },
    credential: { sessionToken: token, displayOnce: true },
    mediaHandoff: { endpoint: `/api/v1/device-hub/camera-media/${result.id}`, header: "x-camera-session-token" },
  });
});

router.get("/device-hub/cameras/:cameraId/bookmarks", async (req: AuthRequest, res) => {
  const camera = await scopedCamera(req, cuid.parse(req.params.cameraId));
  const data = await prisma.cameraBookmark.findMany({
    where: { organizationId: req.auth!.organizationId, cameraId: camera.id },
    orderBy: { occurredAt: "desc" },
    take: 500,
  });
  res.json({ data });
});

router.post("/device-hub/cameras/:cameraId/bookmarks", async (req: AuthRequest, res) => {
  const camera = await scopedCamera(req, cuid.parse(req.params.cameraId));
  const body = z.object({
    label: z.string().trim().min(2).max(180),
    occurredAt: z.coerce.date(),
    notes: z.string().trim().max(5000).optional(),
  }).parse(req.body);
  const retentionStart = new Date(Date.now() - camera.retentionDays * 24 * 60 * 60_000);
  if (body.occurredAt < retentionStart) throw new AppError(410, "CAMERA_BOOKMARK_OUTSIDE_RETENTION", "Bookmark time is outside camera retention policy");
  const data = await prisma.$transaction(async tx => {
    const bookmark = await tx.cameraBookmark.create({
      data: {
        organizationId: req.auth!.organizationId,
        cameraId: camera.id,
        userId: req.auth!.userId,
        label: body.label,
        occurredAt: body.occurredAt,
        notes: body.notes ?? null,
      },
    });
    await tx.cameraAccessAudit.create({
      data: {
        organizationId: req.auth!.organizationId,
        cameraId: camera.id,
        userId: req.auth!.userId,
        action: CameraAccessAction.BOOKMARK,
        metadata: profileJson({ bookmarkId: bookmark.id, occurredAt: body.occurredAt.toISOString() }),
      },
    });
    return bookmark;
  });
  res.status(201).json({ data });
});

router.post("/device-hub/cameras/:cameraId/exports", async (req: AuthRequest, res) => {
  const camera = await scopedCamera(req, cuid.parse(req.params.cameraId));
  const body = z.object({
    fromAt: z.coerce.date(),
    toAt: z.coerce.date(),
    reason: z.string().trim().min(5).max(5000),
  }).parse(req.body);
  if (body.toAt <= body.fromAt) throw new AppError(422, "CAMERA_EXPORT_RANGE_INVALID", "Export end must be after start");
  if (body.toAt.getTime() - body.fromAt.getTime() > 2 * 60 * 60_000) {
    throw new AppError(422, "CAMERA_EXPORT_RANGE_TOO_LARGE", "One video export cannot exceed two hours");
  }
  const retentionStart = new Date(Date.now() - camera.retentionDays * 24 * 60 * 60_000);
  if (body.fromAt < retentionStart) throw new AppError(410, "CAMERA_EXPORT_OUTSIDE_RETENTION", "Requested export is outside camera retention policy");
  const watermarkText = `${camera.code} • export • ${req.auth!.userId} • ${new Date().toISOString()}`;
  const data = await prisma.$transaction(async tx => {
    const request = await tx.cameraExportRequest.create({
      data: {
        organizationId: req.auth!.organizationId,
        cameraId: camera.id,
        requestedById: req.auth!.userId,
        reason: body.reason,
        fromAt: body.fromAt,
        toAt: body.toAt,
        watermarkText,
      },
    });
    await tx.cameraAccessAudit.create({
      data: {
        organizationId: req.auth!.organizationId,
        cameraId: camera.id,
        userId: req.auth!.userId,
        action: CameraAccessAction.EXPORT_REQUEST,
        exportRequestId: request.id,
        metadata: profileJson({ fromAt: body.fromAt.toISOString(), toAt: body.toAt.toISOString() }),
      },
    });
    return request;
  });
  res.status(201).json({ data });
});

router.get("/device-hub/camera-exports", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const q = z.object({
    status: z.nativeEnum(CameraExportStatus).optional(),
    cameraId: cuid.optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  }).parse(req.query);
  const data = await prisma.cameraExportRequest.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      camera: {
        ...(req.auth!.role === Role.SUPER_ADMIN ? {} : erpBranchWhere(scope)),
        ...(q.cameraId ? { id: q.cameraId } : {}),
      },
      ...(q.status ? { status: q.status } : {}),
    },
    include: { camera: { select: { id: true, branchId: true, code: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: q.limit,
  });
  res.json({
    data: data.map(item => ({
      ...item,
      externalRef: item.externalRef ? "[ready]" : null,
    })),
  });
});

router.post("/device-hub/camera-exports/:exportId/decision", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const request = await prisma.cameraExportRequest.findFirst({
    where: { id: cuid.parse(req.params.exportId), organizationId: req.auth!.organizationId },
    include: { camera: true },
  });
  if (!request) throw new AppError(404, "CAMERA_EXPORT_NOT_FOUND", "Camera export request not found");
  assertErpBranchAccess(scope, request.camera.branchId);
  if (request.status !== CameraExportStatus.PENDING_APPROVAL) {
    throw new AppError(409, "CAMERA_EXPORT_DECISION_LOCKED", "Camera export request has already been processed");
  }
  if (request.requestedById === req.auth!.userId) {
    throw new AppError(403, "CAMERA_EXPORT_SELF_APPROVAL_FORBIDDEN", "Video export requires a different authorized approver");
  }
  const body = z.object({
    decision: z.enum(["APPROVE","REJECT"]),
    reason: z.string().trim().min(3).max(5000).optional(),
  }).parse(req.body);
  if (body.decision === "REJECT" && !body.reason) throw new AppError(422, "CAMERA_EXPORT_REJECTION_REASON_REQUIRED", "Rejected export requires a reason");
  const now = new Date();

  if (body.decision === "REJECT") {
    const data = await prisma.$transaction(async tx => {
      const updated = await tx.cameraExportRequest.update({
        where: { id: request.id },
        data: {
          status: CameraExportStatus.REJECTED,
          rejectedById: req.auth!.userId,
          rejectedAt: now,
          rejectionReason: body.reason,
        },
      });
      await tx.cameraAccessAudit.create({
        data: {
          organizationId: req.auth!.organizationId,
          cameraId: request.cameraId,
          userId: req.auth!.userId,
          action: CameraAccessAction.EXPORT_APPROVE,
          exportRequestId: request.id,
          metadata: profileJson({ decision: "REJECT", reason: body.reason }),
        },
      });
      return updated;
    });
    return res.json({ data });
  }

  const data = await prisma.$transaction(async tx => {
    const command = await tx.connectedDeviceCommand.create({
      data: {
        organizationId: req.auth!.organizationId,
        deviceId: request.camera.deviceId,
        commandType: "CAMERA_EXPORT_CLIP",
        idempotencyKey: `camera-export:${request.id}`,
        requestedById: req.auth!.userId,
        payload: profileJson({
          exportRequestId: request.id,
          fromAt: request.fromAt.toISOString(),
          toAt: request.toAt.toISOString(),
          watermarkText: request.watermarkText,
          nvrRef: request.camera.nvrRef,
          channelRef: request.camera.channelRef,
          recordingSecretRef: request.camera.recordingSecretRef,
        }),
      },
    });
    const updated = await tx.cameraExportRequest.update({
      where: { id: request.id },
      data: {
        status: CameraExportStatus.PROCESSING,
        approvedById: req.auth!.userId,
        approvedAt: now,
        commandId: command.id,
      },
    });
    await tx.cameraAccessAudit.create({
      data: {
        organizationId: req.auth!.organizationId,
        cameraId: request.cameraId,
        userId: req.auth!.userId,
        action: CameraAccessAction.EXPORT_APPROVE,
        exportRequestId: request.id,
        metadata: profileJson({ decision: "APPROVE", commandId: command.id }),
      },
    });
    return updated;
  });
  res.status(202).json({ data });
});

async function reconcileCameraExport(exportId: string, organizationId: string) {
  const request = await prisma.cameraExportRequest.findFirst({
    where: { id: exportId, organizationId },
    include: { camera: { select: { branchId: true } } },
  });
  if (!request) return null;
  if (request.status !== CameraExportStatus.PROCESSING || !request.commandId) return request;
  const command = await prisma.connectedDeviceCommand.findFirst({
    where: { id: request.commandId, organizationId },
    select: { status: true, result: true, errorCode: true, errorMessage: true },
  });
  if (!command) return request;
  if (command.status === ConnectedDeviceCommandStatus.FAILED) {
    return prisma.cameraExportRequest.update({
      where: { id: request.id },
      data: {
        status: CameraExportStatus.FAILED,
        errorCode: command.errorCode ?? "CAMERA_EXPORT_FAILED",
        errorMessage: command.errorMessage ?? "Camera export command failed",
      },
      include: { camera: { select: { branchId: true } } },
    });
  }
  if (command.status !== ConnectedDeviceCommandStatus.ACKNOWLEDGED) return request;
  const media = safeMediaResult(command.result);
  if (!media.downloadUrl) {
    return prisma.cameraExportRequest.update({
      where: { id: request.id },
      data: {
        status: CameraExportStatus.FAILED,
        errorCode: "CAMERA_EXPORT_RESULT_INVALID",
        errorMessage: "Edge adapter did not return an approved HTTPS download URL",
      },
      include: { camera: { select: { branchId: true } } },
    });
  }
  const externalExpiry = media.expiresAt ? new Date(media.expiresAt) : null;
  const expiresAt = externalExpiry && Number.isFinite(externalExpiry.getTime()) && externalExpiry > new Date()
    ? externalExpiry
    : new Date(Date.now() + 15 * 60_000);
  return prisma.cameraExportRequest.update({
    where: { id: request.id },
    data: {
      status: CameraExportStatus.READY,
      externalRef: media.downloadUrl,
      expiresAt,
      errorCode: null,
      errorMessage: null,
    },
    include: { camera: { select: { branchId: true } } },
  });
}

router.get("/device-hub/camera-exports/:exportId", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const request = await reconcileCameraExport(cuid.parse(req.params.exportId), req.auth!.organizationId);
  if (!request) throw new AppError(404, "CAMERA_EXPORT_NOT_FOUND", "Camera export request not found");
  assertErpBranchAccess(scope, request.camera.branchId);
  res.json({
    data: {
      ...request,
      externalRef: request.externalRef ? "[ready]" : null,
    },
  });
});

router.get("/device-hub/camera-exports/:exportId/download", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const request = await reconcileCameraExport(cuid.parse(req.params.exportId), req.auth!.organizationId);
  if (!request) throw new AppError(404, "CAMERA_EXPORT_NOT_FOUND", "Camera export request not found");
  assertErpBranchAccess(scope, request.camera.branchId);
  if (request.status !== CameraExportStatus.READY || !request.externalRef) {
    throw new AppError(409, "CAMERA_EXPORT_NOT_READY", "Camera export is not ready for download");
  }
  if (request.expiresAt && request.expiresAt <= new Date()) {
    await prisma.cameraExportRequest.update({ where: { id: request.id }, data: { status: CameraExportStatus.EXPIRED, externalRef: null } });
    throw new AppError(410, "CAMERA_EXPORT_EXPIRED", "Camera export download has expired");
  }
  const safe = safeMediaResult({ downloadUrl: request.externalRef });
  if (!safe.downloadUrl) throw new AppError(502, "CAMERA_EXPORT_URL_INVALID", "Camera export URL is not an approved HTTPS endpoint");
  await prisma.cameraAccessAudit.create({
    data: {
      organizationId: req.auth!.organizationId,
      cameraId: request.cameraId,
      userId: req.auth!.userId,
      action: CameraAccessAction.EXPORT_DOWNLOAD,
      exportRequestId: request.id,
      metadata: profileJson({ expiresAt: request.expiresAt?.toISOString() ?? null }),
    },
  });
  res.setHeader("Cache-Control", "no-store");
  res.json({ data: { url: safe.downloadUrl, expiresAt: request.expiresAt, watermarkText: request.watermarkText } });
});

router.get("/device-hub/cameras/:cameraId/access-audit", async (req: AuthRequest, res) => {
  const camera = await scopedCamera(req, cuid.parse(req.params.cameraId));
  const q = z.object({ limit: z.coerce.number().int().min(1).max(1000).default(200) }).parse(req.query);
  const data = await prisma.cameraAccessAudit.findMany({
    where: { organizationId: req.auth!.organizationId, cameraId: camera.id },
    orderBy: { occurredAt: "desc" },
    take: q.limit,
  });
  res.json({ data });
});

router.get("/device-hub/cameras/:cameraId/trip-context", async (req: AuthRequest, res) => {
  const camera = await scopedCamera(req, cuid.parse(req.params.cameraId));
  if (!camera.vehicleId) return res.json({ data: { camera, activeTrip: null } });
  const activeTrip = await prisma.transportTrip.findFirst({
    where: { organizationId: req.auth!.organizationId, vehicleId: camera.vehicleId, status: "STARTED" },
    orderBy: { startedAt: "desc" },
    include: { route: true, driver: true },
  });
  res.json({ data: { camera: { ...camera, streamSecretRef: undefined, recordingSecretRef: undefined }, activeTrip } });
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
  if (body.vehicleId) {
    const vehicle = await prisma.transportVehicle.findFirst({
      where: { id: body.vehicleId, organizationId: req.auth!.organizationId, branchId: body.branchId },
      select: { id: true },
    });
    if (!vehicle) throw new AppError(422, "CAMERA_VEHICLE_INVALID", "Bus camera vehicle must belong to the same branch");
  }
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
        building: true, floor: true, groupName: true, mapX: true, mapY: true, nvrRef: true, channelRef: true, vehicleId: true,
        retentionDays: true, privacyMasking: true, watermarkEnabled: true, audioEnabled: true, aiReviewEnabled: true, lastTamperAt: true,
        isActive: true, createdAt: true, updatedAt: true,
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
  const body = cameraBaseInput.partial().parse(req.body);
  const targetBranch = body.branchId ?? camera.branchId;
  await assertErpBranchTarget(scope, targetBranch);
  if (body.deviceId) {
    const device = await deviceForOrganization(req.auth!.organizationId, body.deviceId);
    if (device.kind !== ConnectedDeviceKind.CAMERA) throw new AppError(422, "CAMERA_DEVICE_KIND_INVALID", "Campus camera requires a CAMERA Device Hub record");
    if (device.branchId && device.branchId !== targetBranch) throw new AppError(422, "CAMERA_DEVICE_BRANCH_MISMATCH", "Camera and Device Hub record must belong to the same branch");
  }
  if (body.vehicleId) {
    const vehicle = await prisma.transportVehicle.findFirst({
      where: { id: body.vehicleId, organizationId: req.auth!.organizationId, branchId: targetBranch },
      select: { id: true },
    });
    if (!vehicle) throw new AppError(422, "CAMERA_VEHICLE_INVALID", "Bus camera vehicle must belong to the same branch");
  }
  const data = await prisma.campusCamera.update({
    where: { id: camera.id },
    data: { ...body, code: body.code?.toUpperCase() },
    select: {
      id: true, organizationId: true, branchId: true, code: true, name: true, deviceId: true, zone: true, location: true,
      building: true, floor: true, groupName: true, mapX: true, mapY: true, nvrRef: true, channelRef: true, vehicleId: true,
      retentionDays: true, privacyMasking: true, watermarkEnabled: true, audioEnabled: true, aiReviewEnabled: true, lastTamperAt: true,
      isActive: true, createdAt: true, updatedAt: true,
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
    if (device.kind !== ConnectedDeviceKind.ACCESS_CONTROL && device.kind !== ConnectedDeviceKind.RFID && device.kind !== ConnectedDeviceKind.BIOMETRIC) {
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
