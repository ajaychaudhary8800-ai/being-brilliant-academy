import {
  Role,
  SchoolEventStatus,
  TransportAlertStatus,
  TransportAlertType,
  TransportGeofenceType,
  TransportStatus,
  TripStatus,
} from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import {
  assertErpBranchAccess,
  assertErpBranchTarget,
  erpBranchScope,
} from "../lib/erp-branch-access.js";
import { allow, requireAuth, type AuthRequest } from "../middleware/auth.js";
import { requireCommercialFeature } from "../middleware/commercial-entitlement.js";

const router = Router();
router.use(requireAuth, allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN));
router.use(requireCommercialFeature("transport"));
const cuid = z.string().cuid();

async function scopedTrip(req: AuthRequest, tripId: string) {
  const scope = await erpBranchScope(req);
  const trip = await prisma.transportTrip.findFirst({
    where: { id: tripId, organizationId: req.auth!.organizationId },
    include: {
      route: { include: { stops: { include: { stop: true }, orderBy: { pickupSequence: "asc" } } } },
      vehicle: true,
      driver: true,
    },
  });
  if (!trip) throw new AppError(404, "TRANSPORT_TRIP_NOT_FOUND", "Transport trip not found");
  assertErpBranchAccess(scope, trip.route.branchId);
  return trip;
}

router.get("/transport/intelligence/policy", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const branchId = cuid.parse(req.query.branchId);
  await assertErpBranchTarget(scope, branchId);
  const data = await prisma.transportSafetyPolicy.findUnique({ where: { branchId } });
  res.json({
    data: data ?? {
      branchId,
      overspeedKph: 60,
      harshAccelerationMps2: 3,
      harshBrakingMps2: -3.5,
      unauthorizedHaltMinutes: 10,
      gpsOfflineMinutes: 5,
      delayedStartMinutes: 10,
      routeDeviationMeters: 500,
      stopGeofenceMeters: 250,
      inheritedDefaults: true,
    },
  });
});

router.put("/transport/intelligence/policy", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const body = z.object({
    branchId: cuid,
    overspeedKph: z.number().min(10).max(200),
    harshAccelerationMps2: z.number().min(0.5).max(15),
    harshBrakingMps2: z.number().min(-15).max(-0.5),
    unauthorizedHaltMinutes: z.number().int().min(1).max(180),
    gpsOfflineMinutes: z.number().int().min(1).max(1440),
    delayedStartMinutes: z.number().int().min(1).max(180),
    routeDeviationMeters: z.number().int().min(50).max(50000),
    stopGeofenceMeters: z.number().int().min(20).max(5000),
  }).parse(req.body);
  await assertErpBranchTarget(scope, body.branchId);
  const data = await prisma.transportSafetyPolicy.upsert({
    where: { branchId: body.branchId },
    create: { organizationId: req.auth!.organizationId, ...body, updatedById: req.auth!.userId },
    update: { ...body, updatedById: req.auth!.userId },
  });
  await prisma.auditLog.create({
    data: {
      organizationId: req.auth!.organizationId,
      actorId: req.auth!.userId,
      action: "TRANSPORT_SAFETY_POLICY_UPDATED",
      entity: "TransportSafetyPolicy",
      entityId: data.id,
      metadata: { branchId: data.branchId },
    },
  });
  res.json({ data });
});

router.get("/transport/intelligence/alerts", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const q = z.object({
    branchId: cuid.optional(),
    vehicleId: cuid.optional(),
    tripId: cuid.optional(),
    studentId: cuid.optional(),
    type: z.nativeEnum(TransportAlertType).optional(),
    status: z.nativeEnum(TransportAlertStatus).optional(),
    since: z.coerce.date().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  }).parse(req.query);
  if (q.branchId) await assertErpBranchTarget(scope, q.branchId);
  const data = await prisma.transportAlert.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      branchId: { in: q.branchId ? [q.branchId] : scope },
      ...(q.vehicleId ? { vehicleId: q.vehicleId } : {}),
      ...(q.tripId ? { tripId: q.tripId } : {}),
      ...(q.studentId ? { studentId: q.studentId } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.since ? { occurredAt: { gte: q.since } } : {}),
    },
    include: { vehicle: { select: { id: true, vehicleNumber: true } }, trip: { select: { id: true, routeId: true } } },
    orderBy: [{ status: "asc" }, { occurredAt: "desc" }],
    take: q.limit,
  });
  res.json({ data });
});

router.patch("/transport/intelligence/alerts/:alertId", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const alert = await prisma.transportAlert.findFirst({
    where: { id: cuid.parse(req.params.alertId), organizationId: req.auth!.organizationId },
  });
  if (!alert) throw new AppError(404, "TRANSPORT_ALERT_NOT_FOUND", "Transport alert not found");
  assertErpBranchAccess(scope, alert.branchId);
  const body = z.object({
    status: z.enum(["ACKNOWLEDGED","RESOLVED","DISMISSED"]),
    resolutionNotes: z.string().trim().min(3).max(5000).optional(),
  }).parse(req.body);
  if (["RESOLVED","DISMISSED"].includes(body.status) && !body.resolutionNotes) {
    throw new AppError(422, "TRANSPORT_ALERT_RESOLUTION_REQUIRED", "Resolved or dismissed alerts require review notes");
  }
  const now = new Date();
  const data = await prisma.$transaction(async tx => {
    const updated = await tx.transportAlert.update({
      where: { id: alert.id },
      data: {
        status: body.status,
        ...(body.status === "ACKNOWLEDGED" ? { acknowledgedById: req.auth!.userId, acknowledgedAt: now } : {}),
        ...(body.status === "RESOLVED" || body.status === "DISMISSED"
          ? { resolvedById: req.auth!.userId, resolvedAt: now, resolutionNotes: body.resolutionNotes }
          : {}),
      },
    });
    await tx.schoolEvent.updateMany({
      where: { organizationId: req.auth!.organizationId, sourceType: "TRANSPORT_ALERT", sourceId: alert.id },
      data: {
        status: body.status === "ACKNOWLEDGED" ? SchoolEventStatus.ACKNOWLEDGED
          : body.status === "RESOLVED" ? SchoolEventStatus.RESOLVED
          : SchoolEventStatus.DISMISSED,
        ...(body.status === "RESOLVED" || body.status === "DISMISSED"
          ? { resolvedById: req.auth!.userId, resolvedAt: now, resolutionNotes: body.resolutionNotes }
          : { acknowledgedById: req.auth!.userId, acknowledgedAt: now }),
      },
    });
    return updated;
  });
  res.json({ data });
});

router.get("/transport/intelligence/trips/:tripId/live", async (req: AuthRequest, res) => {
  const trip = await scopedTrip(req, cuid.parse(req.params.tripId));
  const policy = await prisma.transportSafetyPolicy.findUnique({ where: { branchId: trip.route.branchId } });
  const gpsOfflineMinutes = policy?.gpsOfflineMinutes ?? 5;
  const lastPoint = await prisma.transportGpsPoint.findFirst({
    where: { organizationId: req.auth!.organizationId, tripId: trip.id },
    orderBy: { recordedAt: "desc" },
  });
  const now = new Date();
  const gpsAgeSeconds = trip.vehicle.lastGpsAt ? Math.max(0, Math.floor((now.getTime() - trip.vehicle.lastGpsAt.getTime()) / 1000)) : null;
  const gpsOffline = gpsAgeSeconds === null || gpsAgeSeconds > gpsOfflineMinutes * 60;
  const ridership = await prisma.transportRidershipEvent.findMany({
    where: { organizationId: req.auth!.organizationId, tripId: trip.id },
    orderBy: { occurredAt: "asc" },
  });
  const onboard = new Set<string>();
  for (const event of ridership) {
    if (event.type === "BOARD") onboard.add(event.studentId);
    else onboard.delete(event.studentId);
  }
  res.json({
    data: {
      trip,
      lastPoint,
      routeProgressPercent: trip.routeProgressPercent,
      etaMinutes: trip.etaMinutes,
      gps: { offline: gpsOffline, ageSeconds: gpsAgeSeconds, thresholdMinutes: gpsOfflineMinutes },
      ridership: { onboardCount: onboard.size, onboardStudentIds: [...onboard], eventCount: ridership.length },
    },
  });
});

router.get("/transport/intelligence/trips/:tripId/replay", async (req: AuthRequest, res) => {
  const trip = await scopedTrip(req, cuid.parse(req.params.tripId));
  const q = z.object({
    since: z.coerce.date().optional(),
    until: z.coerce.date().optional(),
    limit: z.coerce.number().int().min(1).max(10000).default(5000),
  }).parse(req.query);
  const data = await prisma.transportGpsPoint.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      tripId: trip.id,
      ...((q.since || q.until) ? { recordedAt: { ...(q.since ? { gte: q.since } : {}), ...(q.until ? { lte: q.until } : {}) } } : {}),
    },
    orderBy: { recordedAt: "asc" },
    take: q.limit,
  });
  res.json({ data, meta: { tripId: trip.id, points: data.length } });
});

router.get("/transport/intelligence/trips/:tripId/still-onboard", async (req: AuthRequest, res) => {
  const trip = await scopedTrip(req, cuid.parse(req.params.tripId));
  const events = await prisma.transportRidershipEvent.findMany({
    where: { organizationId: req.auth!.organizationId, tripId: trip.id },
    orderBy: { occurredAt: "asc" },
  });
  const latest = new Map<string, typeof events[number]>();
  for (const event of events) latest.set(event.studentId, event);
  const onboard = [...latest.values()].filter(event => event.type === "BOARD");
  res.json({ data: onboard, meta: { tripId: trip.id, stillOnboard: onboard.length, tripStatus: trip.status } });
});

router.get("/transport/intelligence/offline-vehicles", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const [vehicles, policies] = await Promise.all([
    prisma.transportVehicle.findMany({
      where: { organizationId: req.auth!.organizationId, branchId: { in: scope }, status: TransportStatus.ACTIVE },
      select: { id: true, branchId: true, vehicleNumber: true, lastGpsAt: true, gpsDeviceId: true },
    }),
    prisma.transportSafetyPolicy.findMany({ where: { organizationId: req.auth!.organizationId, branchId: { in: scope } } }),
  ]);
  const policyMap = new Map(policies.map(policy => [policy.branchId, policy]));
  const now = Date.now();
  const data = vehicles.map(vehicle => {
    const threshold = policyMap.get(vehicle.branchId)?.gpsOfflineMinutes ?? 5;
    const ageSeconds = vehicle.lastGpsAt ? Math.max(0, Math.floor((now - vehicle.lastGpsAt.getTime()) / 1000)) : null;
    return { ...vehicle, thresholdMinutes: threshold, ageSeconds, offline: ageSeconds === null || ageSeconds > threshold * 60 };
  }).filter(vehicle => vehicle.offline);
  res.json({ data });
});

const geofenceInput = z.object({
  branchId: cuid,
  routeId: cuid.nullable().optional(),
  stopId: cuid.nullable().optional(),
  name: z.string().trim().min(2).max(180),
  type: z.nativeEnum(TransportGeofenceType),
  geometry: z.record(z.string(), z.unknown()),
  radiusMeters: z.number().int().min(10).max(100000).nullable().optional(),
  isActive: z.boolean().default(true),
});

router.get("/transport/intelligence/geofences", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const branchId = req.query.branchId ? cuid.parse(req.query.branchId) : undefined;
  if (branchId) await assertErpBranchTarget(scope, branchId);
  const data = await prisma.transportGeofence.findMany({
    where: { organizationId: req.auth!.organizationId, branchId: { in: branchId ? [branchId] : scope } },
    orderBy: { name: "asc" },
  });
  res.json({ data });
});

router.post("/transport/intelligence/geofences", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const body = geofenceInput.parse(req.body);
  await assertErpBranchTarget(scope, body.branchId);
  if (body.routeId) {
    const route = await prisma.transportRoute.findFirst({ where: { id: body.routeId, organizationId: req.auth!.organizationId }, select: { branchId: true } });
    if (!route || route.branchId !== body.branchId) throw new AppError(422, "TRANSPORT_GEOFENCE_ROUTE_INVALID", "Geofence route must belong to the selected branch");
  }
  if (body.stopId) {
    const stop = await prisma.transportStop.findFirst({ where: { id: body.stopId, organizationId: req.auth!.organizationId }, select: { branchId: true } });
    if (!stop || stop.branchId !== body.branchId) throw new AppError(422, "TRANSPORT_GEOFENCE_STOP_INVALID", "Geofence stop must belong to the selected branch");
  }
  if (body.type === TransportGeofenceType.CIRCLE && !body.radiusMeters) {
    throw new AppError(422, "TRANSPORT_GEOFENCE_RADIUS_REQUIRED", "Circle geofence requires a radius");
  }
  const data = await prisma.transportGeofence.create({
    data: {
      organizationId: req.auth!.organizationId,
      ...body,
      routeId: body.routeId ?? null,
      stopId: body.stopId ?? null,
    },
  });
  res.status(201).json({ data });
});

router.get("/transport/intelligence/fleet", async (req: AuthRequest, res) => {
  const scope = await erpBranchScope(req);
  const now = new Date();
  const expiryWindow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const [vehicles, servicesDue, documentsExpiring, alerts, fuel] = await Promise.all([
    prisma.transportVehicle.findMany({
      where: { organizationId: req.auth!.organizationId, branchId: { in: scope } },
      select: { id: true, branchId: true, vehicleNumber: true, status: true, odometerKm: true, batteryPercent: true, estimatedRangeKm: true, lastGpsAt: true },
    }),
    prisma.transportService.findMany({
      where: { organizationId: req.auth!.organizationId, vehicle: { branchId: { in: scope } }, OR: [
        { nextServiceDate: { lte: expiryWindow } },
      ] },
      include: { vehicle: { select: { vehicleNumber: true } } },
      orderBy: { nextServiceDate: "asc" },
      take: 100,
    }),
    prisma.transportVehicleDocument.findMany({
      where: { organizationId: req.auth!.organizationId, vehicle: { branchId: { in: scope } }, expiryDate: { lte: expiryWindow } },
      include: { vehicle: { select: { vehicleNumber: true } } },
      orderBy: { expiryDate: "asc" },
      take: 100,
    }),
    prisma.transportAlert.groupBy({
      by: ["type"],
      where: { organizationId: req.auth!.organizationId, branchId: { in: scope }, status: { in: [TransportAlertStatus.OPEN, TransportAlertStatus.ACKNOWLEDGED] } },
      _count: true,
    }),
    prisma.transportFuelLog.aggregate({
      where: { organizationId: req.auth!.organizationId, vehicle: { branchId: { in: scope } } },
      _sum: { litres: true, amountPaise: true },
    }),
  ]);
  res.json({ data: { vehicles, servicesDue, documentsExpiring, openAlertsByType: alerts, fuelTotals: fuel._sum } });
});

export default router;
