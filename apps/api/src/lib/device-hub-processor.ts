import {
  AttendanceStatus,
  CameraIncidentSeverity,
  CampusAccessDecision,
  CampusAccessSubjectType,
  ConnectedDeviceBindingType,
  ConnectedDeviceEventStatus,
  Prisma,
  SchoolEventCategory,
  SchoolEventSeverity,
  SchoolEventStatus,
  SafetyIncidentSeverity,
  TripStatus,
} from "@prisma/client";
import { z } from "zod";
import { institutionCalendarDate, parseDateOnly } from "./institution-time.js";
import { systemPrisma } from "./prisma.js";

const normalizedSchema = z.object({
  category: z.enum(["HEARTBEAT","IDENTITY","LOCATION","ACCESS","VIDEO","SENSOR","GENERIC"]),
  subjectExternalId: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  speedKph: z.number().nullable(),
  direction: z.enum(["IN","OUT"]).nullable(),
  reading: z.number().nullable(),
  unit: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

const accessPolicySchema = z.object({
  allowStudents: z.boolean().default(false),
  allowEmployees: z.boolean().default(false),
  requireDirection: z.boolean().default(true),
  allowedDirections: z.array(z.enum(["IN","OUT"])).default(["IN","OUT"]),
}).default({
  allowStudents: false,
  allowEmployees: false,
  requireDirection: true,
  allowedDirections: ["IN","OUT"],
});

class DeviceEventProcessingError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "DeviceEventProcessingError";
  }
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function attendanceTimes(existing: { checkIn: Date | null; checkOut: Date | null } | null, occurredAt: Date, direction: "IN" | "OUT") {
  if (direction === "IN") {
    return {
      checkIn: !existing?.checkIn || occurredAt < existing.checkIn ? occurredAt : existing.checkIn,
      checkOut: existing?.checkOut ?? null,
    };
  }
  return {
    checkIn: existing?.checkIn ?? null,
    checkOut: !existing?.checkOut || occurredAt > existing.checkOut ? occurredAt : existing.checkOut,
  };
}

async function recordSchoolEvent(input: {
  organizationId: string;
  branchId?: string | null;
  category: SchoolEventCategory;
  type: string;
  severity?: SchoolEventSeverity;
  status?: SchoolEventStatus;
  occurredAt: Date;
  sourceType: string;
  sourceId: string;
  correlationKey?: string | null;
  studentId?: string | null;
  employeeId?: string | null;
  vehicleId?: string | null;
  deviceId?: string | null;
  accessPointId?: string | null;
  cameraId?: string | null;
  title: string;
  summary?: string | null;
  metadata?: Record<string, unknown>;
  reviewRequired?: boolean;
}) {
  return systemPrisma.schoolEvent.upsert({
    where: {
      organizationId_sourceType_sourceId: {
        organizationId: input.organizationId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      },
    },
    create: {
      organizationId: input.organizationId,
      branchId: input.branchId ?? null,
      category: input.category,
      type: input.type,
      severity: input.severity ?? SchoolEventSeverity.INFO,
      status: input.status ?? (input.reviewRequired ? SchoolEventStatus.REVIEW_REQUIRED : SchoolEventStatus.RECORDED),
      occurredAt: input.occurredAt,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      correlationKey: input.correlationKey ?? null,
      studentId: input.studentId ?? null,
      employeeId: input.employeeId ?? null,
      vehicleId: input.vehicleId ?? null,
      deviceId: input.deviceId ?? null,
      accessPointId: input.accessPointId ?? null,
      cameraId: input.cameraId ?? null,
      title: input.title,
      summary: input.summary ?? null,
      metadata: input.metadata ? json(input.metadata) : undefined,
      reviewRequired: input.reviewRequired ?? false,
    },
    update: {},
  });
}

async function organizationDate(organizationId: string, instant: Date) {
  const organization = await systemPrisma.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true },
  });
  if (!organization) throw new DeviceEventProcessingError("DEVICE_ORGANIZATION_NOT_FOUND", "Device organization no longer exists");
  return parseDateOnly(institutionCalendarDate(instant, organization.timezone));
}

async function identityBinding(input: {
  organizationId: string;
  deviceId: string;
  occurredAt: Date;
  externalSubjectId: string | null;
}) {
  if (!input.externalSubjectId) {
    throw new DeviceEventProcessingError("DEVICE_IDENTITY_MISSING", "Identity event does not contain an external subject identifier");
  }
  const bindings = await systemPrisma.connectedDeviceBinding.findMany({
    where: {
      organizationId: input.organizationId,
      deviceId: input.deviceId,
      externalSubjectId: input.externalSubjectId,
      isActive: true,
      activeFrom: { lte: input.occurredAt },
      OR: [{ activeUntil: null }, { activeUntil: { gte: input.occurredAt } }],
      bindingType: { in: [ConnectedDeviceBindingType.EMPLOYEE, ConnectedDeviceBindingType.STUDENT] },
    },
    select: { id: true, bindingType: true, entityId: true, externalSubjectId: true },
  });
  if (!bindings.length) throw new DeviceEventProcessingError("DEVICE_IDENTITY_UNBOUND", "No active employee or student binding matches this device identity");
  if (bindings.length > 1) throw new DeviceEventProcessingError("DEVICE_IDENTITY_AMBIGUOUS", "More than one active binding matches this device identity");
  return bindings[0]!;
}

async function vehicleBinding(input: { organizationId: string; deviceId: string; occurredAt: Date }) {
  const bindings = await systemPrisma.connectedDeviceBinding.findMany({
    where: {
      organizationId: input.organizationId,
      deviceId: input.deviceId,
      bindingType: ConnectedDeviceBindingType.VEHICLE,
      isActive: true,
      activeFrom: { lte: input.occurredAt },
      OR: [{ activeUntil: null }, { activeUntil: { gte: input.occurredAt } }],
    },
    select: { id: true, entityId: true },
  });
  if (!bindings.length) throw new DeviceEventProcessingError("DEVICE_VEHICLE_UNBOUND", "GPS device is not bound to an active vehicle");
  if (bindings.length > 1) throw new DeviceEventProcessingError("DEVICE_VEHICLE_AMBIGUOUS", "GPS device is bound to more than one active vehicle");
  return bindings[0]!;
}

async function processIdentity(event: any, normalized: z.infer<typeof normalizedSchema>) {
  if (!normalized.direction) {
    throw new DeviceEventProcessingError("DEVICE_ATTENDANCE_DIRECTION_REQUIRED", "Attendance event must specify check-in/entry or check-out/exit");
  }
  const binding = await identityBinding({
    organizationId: event.organizationId,
    deviceId: event.deviceId,
    occurredAt: event.occurredAt,
    externalSubjectId: normalized.subjectExternalId,
  });
  const date = await organizationDate(event.organizationId, event.occurredAt);

  if (binding.bindingType === ConnectedDeviceBindingType.EMPLOYEE) {
    const employee = await systemPrisma.employee.findFirst({
      where: { id: binding.entityId, organizationId: event.organizationId },
      select: { id: true, branchId: true, status: true },
    });
    if (!employee) throw new DeviceEventProcessingError("DEVICE_EMPLOYEE_NOT_FOUND", "Bound employee no longer exists");
    if (event.device.branchId && employee.branchId !== event.device.branchId) {
      throw new DeviceEventProcessingError("DEVICE_BINDING_BRANCH_MISMATCH", "Employee and biometric device are no longer in the same branch");
    }
    const existing = await systemPrisma.hrAttendance.findUnique({
      where: { employeeId_date: { employeeId: employee.id, date } },
      select: { id: true, checkIn: true, checkOut: true },
    });
    const times = attendanceTimes(existing, event.occurredAt, normalized.direction);
    const attendance = await systemPrisma.hrAttendance.upsert({
      where: { employeeId_date: { employeeId: employee.id, date } },
      create: {
        organizationId: event.organizationId,
        employeeId: employee.id,
        date,
        status: AttendanceStatus.PRESENT,
        checkIn: times.checkIn,
        checkOut: times.checkOut,
        source: "DEVICE_HUB",
        biometricReference: event.id,
      },
      update: {
        status: AttendanceStatus.PRESENT,
        checkIn: times.checkIn,
        checkOut: times.checkOut,
        source: "DEVICE_HUB",
        biometricReference: event.id,
      },
      select: { id: true, employeeId: true, date: true, checkIn: true, checkOut: true, source: true },
    });
    await recordSchoolEvent({
      organizationId: event.organizationId,
      branchId: employee.branchId,
      category: SchoolEventCategory.ATTENDANCE,
      type: `EMPLOYEE_${normalized.direction}`,
      occurredAt: event.occurredAt,
      sourceType: "HR_ATTENDANCE_DEVICE_EVENT",
      sourceId: event.id,
      employeeId: employee.id,
      deviceId: event.deviceId,
      correlationKey: `employee:${employee.id}`,
      title: `Employee attendance ${normalized.direction === "IN" ? "check-in" : "check-out"}`,
      metadata: { attendanceId: attendance.id, bindingId: binding.id },
    });
    return { adapter: "HR_ATTENDANCE", bindingId: binding.id, attendanceId: attendance.id };
  }

  const student = await systemPrisma.studentProfile.findFirst({
    where: { id: binding.entityId, organizationId: event.organizationId },
    select: { id: true, userId: true, batchId: true, branchId: true, status: true },
  });
  if (!student) throw new DeviceEventProcessingError("DEVICE_STUDENT_NOT_FOUND", "Bound student no longer exists");
  if (event.device.branchId && student.branchId !== event.device.branchId) {
    throw new DeviceEventProcessingError("DEVICE_BINDING_BRANCH_MISMATCH", "Student and attendance device are no longer in the same branch");
  }
  const existing = await systemPrisma.attendance.findUnique({
    where: { studentId_batchId_date: { studentId: student.userId, batchId: student.batchId, date } },
    select: { id: true, checkIn: true, checkOut: true },
  });
  const times = attendanceTimes(existing, event.occurredAt, normalized.direction);
  const attendance = await systemPrisma.attendance.upsert({
    where: { studentId_batchId_date: { studentId: student.userId, batchId: student.batchId, date } },
    create: {
      organizationId: event.organizationId,
      studentId: student.userId,
      batchId: student.batchId,
      date,
      status: AttendanceStatus.PRESENT,
      checkIn: times.checkIn,
      checkOut: times.checkOut,
      remarks: `Device Hub: ${event.device.code}`,
    },
    update: {
      status: AttendanceStatus.PRESENT,
      checkIn: times.checkIn,
      checkOut: times.checkOut,
    },
    select: { id: true, studentId: true, batchId: true, date: true, checkIn: true, checkOut: true },
  });
  await recordSchoolEvent({
    organizationId: event.organizationId,
    branchId: student.branchId,
    category: SchoolEventCategory.ATTENDANCE,
    type: `STUDENT_${normalized.direction}`,
    occurredAt: event.occurredAt,
    sourceType: "STUDENT_ATTENDANCE_DEVICE_EVENT",
    sourceId: event.id,
    studentId: student.id,
    deviceId: event.deviceId,
    correlationKey: `student:${student.id}`,
    title: `Student attendance ${normalized.direction === "IN" ? "check-in" : "check-out"}`,
    metadata: { attendanceId: attendance.id, bindingId: binding.id, batchId: student.batchId },
  });
  return { adapter: "STUDENT_ATTENDANCE", bindingId: binding.id, attendanceId: attendance.id };
}

async function processLocation(event: any, normalized: z.infer<typeof normalizedSchema>) {
  if (normalized.latitude === null || normalized.longitude === null) {
    throw new DeviceEventProcessingError("DEVICE_LOCATION_COORDINATES_REQUIRED", "Location event requires latitude and longitude");
  }
  const binding = await vehicleBinding({
    organizationId: event.organizationId,
    deviceId: event.deviceId,
    occurredAt: event.occurredAt,
  });
  const vehicle = await systemPrisma.transportVehicle.findFirst({
    where: { id: binding.entityId, organizationId: event.organizationId },
    select: { id: true, branchId: true },
  });
  if (!vehicle) throw new DeviceEventProcessingError("DEVICE_VEHICLE_NOT_FOUND", "Bound vehicle no longer exists");
  if (event.device.branchId && vehicle.branchId !== event.device.branchId) {
    throw new DeviceEventProcessingError("DEVICE_BINDING_BRANCH_MISMATCH", "Vehicle and GPS device are no longer in the same branch");
  }

  const trip = await systemPrisma.transportTrip.findFirst({
    where: {
      organizationId: event.organizationId,
      vehicleId: vehicle.id,
      status: TripStatus.STARTED,
    },
    select: { id: true, route: { select: { branchId: true } } },
    orderBy: { startedAt: "desc" },
  });
  if (trip && trip.route.branchId !== vehicle.branchId) {
    throw new DeviceEventProcessingError("DEVICE_TRIP_BRANCH_MISMATCH", "Active trip branch does not match the bound vehicle");
  }

  const geofenceEvent = typeof normalized.metadata.geofenceEvent === "string"
    ? normalized.metadata.geofenceEvent.slice(0, 180)
    : null;

  await systemPrisma.$transaction(async tx => {
    await tx.transportVehicle.update({
      where: { id: vehicle.id },
      data: {
        currentLatitude: normalized.latitude!,
        currentLongitude: normalized.longitude!,
        currentSpeed: normalized.speedKph ?? 0,
        lastGpsAt: event.occurredAt,
      },
    });
    if (trip) {
      await tx.transportGpsPoint.upsert({
        where: { deviceEventId: event.id },
        create: {
          organizationId: event.organizationId,
          tripId: trip.id,
          deviceEventId: event.id,
          latitude: normalized.latitude!,
          longitude: normalized.longitude!,
          speed: normalized.speedKph ?? 0,
          recordedAt: event.occurredAt,
          geofenceEvent,
        },
        update: {},
      });
    }
  });

  await recordSchoolEvent({
    organizationId: event.organizationId,
    branchId: vehicle.branchId,
    category: SchoolEventCategory.TRANSPORT,
    type: geofenceEvent ? "GPS_GEOFENCE" : "GPS_POSITION",
    occurredAt: event.occurredAt,
    sourceType: "TRANSPORT_GPS_DEVICE_EVENT",
    sourceId: event.id,
    vehicleId: vehicle.id,
    deviceId: event.deviceId,
    correlationKey: trip?.id ? `trip:${trip.id}` : `vehicle:${vehicle.id}`,
    title: geofenceEvent ? `Vehicle geofence event: ${geofenceEvent}` : "Vehicle location update",
    metadata: {
      tripId: trip?.id ?? null,
      latitude: normalized.latitude,
      longitude: normalized.longitude,
      speedKph: normalized.speedKph,
      geofenceEvent,
    },
  });
  return { adapter: "TRANSPORT_GPS", bindingId: binding.id, vehicleId: vehicle.id, tripId: trip?.id ?? null };
}

async function processAccess(event: any, normalized: z.infer<typeof normalizedSchema>) {
  const accessPoint = await systemPrisma.campusAccessPoint.findFirst({
    where: {
      organizationId: event.organizationId,
      deviceId: event.deviceId,
      isActive: true,
    },
  });
  if (!accessPoint) {
    throw new DeviceEventProcessingError("ACCESS_POINT_UNBOUND", "Access-control device is not bound to an active campus access point");
  }
  if (event.device.branchId && accessPoint.branchId !== event.device.branchId) {
    throw new DeviceEventProcessingError("ACCESS_POINT_BRANCH_MISMATCH", "Access point and device are not in the same branch");
  }

  const policy = accessPolicySchema.parse(accessPoint.policy ?? {});
  let subjectType = CampusAccessSubjectType.UNKNOWN;
  let subjectId: string | null = null;
  let reasonCode = "ACCESS_IDENTITY_UNKNOWN";
  let decision = CampusAccessDecision.REVIEW;

  const subject = normalized.subjectExternalId
    ? await systemPrisma.connectedDeviceBinding.findMany({
        where: {
          organizationId: event.organizationId,
          deviceId: event.deviceId,
          externalSubjectId: normalized.subjectExternalId,
          isActive: true,
          activeFrom: { lte: event.occurredAt },
          OR: [{ activeUntil: null }, { activeUntil: { gte: event.occurredAt } }],
          bindingType: { in: [ConnectedDeviceBindingType.STUDENT, ConnectedDeviceBindingType.EMPLOYEE] },
        },
        select: { bindingType: true, entityId: true },
      })
    : [];

  if (subject.length === 1) {
    const binding = subject[0]!;
    subjectType = binding.bindingType === ConnectedDeviceBindingType.STUDENT
      ? CampusAccessSubjectType.STUDENT
      : CampusAccessSubjectType.EMPLOYEE;
    subjectId = binding.entityId;

    if (policy.requireDirection && !normalized.direction) {
      decision = CampusAccessDecision.REVIEW;
      reasonCode = "ACCESS_DIRECTION_MISSING";
    } else if (normalized.direction && !policy.allowedDirections.includes(normalized.direction)) {
      decision = CampusAccessDecision.DENIED;
      reasonCode = "ACCESS_DIRECTION_NOT_ALLOWED";
    } else {
      const allowed = subjectType === CampusAccessSubjectType.STUDENT ? policy.allowStudents : policy.allowEmployees;
      decision = allowed ? CampusAccessDecision.GRANTED : CampusAccessDecision.DENIED;
      reasonCode = allowed ? "ACCESS_POLICY_GRANTED" : "ACCESS_SUBJECT_TYPE_NOT_ALLOWED";
    }
  } else if (subject.length > 1) {
    decision = CampusAccessDecision.REVIEW;
    reasonCode = "ACCESS_IDENTITY_AMBIGUOUS";
  }

  const created = await systemPrisma.campusAccessEvent.upsert({
    where: { deviceEventId: event.id },
    create: {
      organizationId: event.organizationId,
      accessPointId: accessPoint.id,
      deviceEventId: event.id,
      subjectType,
      subjectId,
      externalSubjectId: normalized.subjectExternalId,
      direction: normalized.direction,
      decision,
      reasonCode,
      occurredAt: event.occurredAt,
      metadata: json({ policyVersion: 1, deviceCode: event.device.code }),
    },
    update: {},
    select: { id: true, accessPointId: true, subjectType: true, subjectId: true, decision: true, reasonCode: true },
  });
  await recordSchoolEvent({
    organizationId: event.organizationId,
    branchId: accessPoint.branchId,
    category: SchoolEventCategory.ACCESS,
    type: `ACCESS_${created.decision}`,
    severity: created.decision === CampusAccessDecision.DENIED ? SchoolEventSeverity.MEDIUM : SchoolEventSeverity.INFO,
    occurredAt: event.occurredAt,
    sourceType: "CAMPUS_ACCESS_EVENT",
    sourceId: created.id,
    studentId: subjectType === CampusAccessSubjectType.STUDENT ? subjectId : null,
    employeeId: subjectType === CampusAccessSubjectType.EMPLOYEE ? subjectId : null,
    deviceId: event.deviceId,
    accessPointId: accessPoint.id,
    correlationKey: subjectId ? `${subjectType.toLocaleLowerCase("en")}:${subjectId}` : `access-point:${accessPoint.id}`,
    title: `Campus access ${created.decision.toLocaleLowerCase("en")}`,
    summary: created.reasonCode,
    reviewRequired: created.decision === CampusAccessDecision.REVIEW,
    metadata: { direction: normalized.direction, externalSubjectId: normalized.subjectExternalId },
  });
  return { adapter: "CAMPUS_ACCESS", accessEventId: created.id, decision: created.decision, reasonCode: created.reasonCode };
}

function cameraSeverity(value: unknown) {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  return Object.values(CameraIncidentSeverity).includes(normalized as CameraIncidentSeverity)
    ? normalized as CameraIncidentSeverity
    : CameraIncidentSeverity.INFO;
}

function isSafetySignal(eventType: string) {
  return /(SOS|PANIC|FIRE|EMERGENCY|DISTRESS|SMOKE_ALARM|DURESS)/i.test(eventType);
}

async function processSafetySignal(event: any, normalized: z.infer<typeof normalizedSchema>) {
  if (!event.device.branchId) {
    throw new DeviceEventProcessingError("SAFETY_SIGNAL_BRANCH_REQUIRED", "Safety signal device must be assigned to a branch");
  }
  const type = event.eventType.toLocaleUpperCase("en");
  const severity = /(SOS|PANIC|FIRE|EMERGENCY|DISTRESS|DURESS)/.test(type)
    ? SafetyIncidentSeverity.CRITICAL
    : SafetyIncidentSeverity.HIGH;
  const titleRaw = typeof normalized.metadata.title === "string" ? normalized.metadata.title.trim() : "";
  const descriptionRaw = typeof normalized.metadata.description === "string" ? normalized.metadata.description.trim() : "";

  const schoolEvent = await recordSchoolEvent({
    organizationId: event.organizationId,
    branchId: event.device.branchId,
    category: SchoolEventCategory.SAFETY,
    type,
    severity: severity === SafetyIncidentSeverity.CRITICAL ? SchoolEventSeverity.CRITICAL : SchoolEventSeverity.HIGH,
    occurredAt: event.occurredAt,
    sourceType: "DEVICE_SAFETY_SIGNAL",
    sourceId: event.id,
    deviceId: event.deviceId,
    correlationKey: `device:${event.deviceId}`,
    title: (titleRaw || `Safety alert: ${type}`).slice(0, 240),
    summary: descriptionRaw ? descriptionRaw.slice(0, 5000) : null,
    reviewRequired: true,
    metadata: { sourceDeviceCode: event.device.code, category: normalized.category },
  });

  const incident = await systemPrisma.safetyIncident.upsert({
    where: { deviceEventId: event.id },
    create: {
      organizationId: event.organizationId,
      branchId: event.device.branchId,
      code: `AUTO-${event.id.slice(-12).toUpperCase()}`,
      title: (titleRaw || `Safety alert: ${type}`).slice(0, 240),
      description: descriptionRaw ? descriptionRaw.slice(0, 5000) : null,
      severity,
      sourceType: "DEVICE",
      sourceId: event.deviceId,
      schoolEventId: schoolEvent.id,
      deviceEventId: event.id,
      occurredAt: event.occurredAt,
      metadata: json({ deviceCode: event.device.code, eventType: type }),
    },
    update: {},
    select: { id: true, code: true, severity: true, status: true, emergencyMode: true },
  });

  return {
    adapter: "SAFETY_INCIDENT",
    incidentId: incident.id,
    severity: incident.severity,
    status: incident.status,
    reviewRequired: true,
  };
}

async function processVideo(event: any, normalized: z.infer<typeof normalizedSchema>) {
  const camera = await systemPrisma.campusCamera.findFirst({
    where: {
      organizationId: event.organizationId,
      deviceId: event.deviceId,
      isActive: true,
    },
    select: { id: true, branchId: true, code: true, name: true, aiReviewEnabled: true, privacyMasking: true },
  });
  if (!camera) {
    throw new DeviceEventProcessingError("CAMERA_UNREGISTERED", "Camera device is not registered as an active campus camera");
  }
  if (event.device.branchId && camera.branchId !== event.device.branchId) {
    throw new DeviceEventProcessingError("CAMERA_BRANCH_MISMATCH", "Camera and Device Hub record are not in the same branch");
  }

  const confidenceRaw = typeof normalized.metadata.confidence === "number"
    ? normalized.metadata.confidence
    : Number(normalized.metadata.confidence);
  const confidence = Number.isFinite(confidenceRaw) && confidenceRaw >= 0 && confidenceRaw <= 1 ? confidenceRaw : null;
  const severity = cameraSeverity(normalized.metadata.severity);
  const titleRaw = typeof normalized.metadata.title === "string" ? normalized.metadata.title.trim() : "";
  const descriptionRaw = typeof normalized.metadata.description === "string" ? normalized.metadata.description.trim() : "";
  const clipExternalRef = typeof normalized.metadata.clipExternalRef === "string" ? normalized.metadata.clipExternalRef.trim() : null;
  const snapshotExternalRef = typeof normalized.metadata.snapshotExternalRef === "string" ? normalized.metadata.snapshotExternalRef.trim() : null;

  const incident = await systemPrisma.cameraIncident.upsert({
    where: { deviceEventId: event.id },
    create: {
      organizationId: event.organizationId,
      cameraId: camera.id,
      deviceEventId: event.id,
      eventType: event.eventType,
      severity,
      title: (titleRaw || `${camera.name}: ${event.eventType}`).slice(0, 240),
      description: descriptionRaw ? descriptionRaw.slice(0, 5000) : null,
      occurredAt: event.occurredAt,
      confidence,
      reviewRequired: true,
      clipExternalRef: clipExternalRef ? clipExternalRef.slice(0, 1000) : null,
      snapshotExternalRef: snapshotExternalRef ? snapshotExternalRef.slice(0, 1000) : null,
      metadata: json({
        aiReviewEnabled: camera.aiReviewEnabled,
        privacyMasking: camera.privacyMasking,
        sourceDeviceCode: event.device.code,
      }),
    },
    update: {},
    select: { id: true, cameraId: true, eventType: true, severity: true, status: true, reviewRequired: true, confidence: true },
  });

  await recordSchoolEvent({
    organizationId: event.organizationId,
    branchId: camera.branchId,
    category: SchoolEventCategory.CAMERA,
    type: event.eventType,
    severity: severity === CameraIncidentSeverity.CRITICAL ? SchoolEventSeverity.CRITICAL
      : severity === CameraIncidentSeverity.HIGH ? SchoolEventSeverity.HIGH
      : severity === CameraIncidentSeverity.MEDIUM ? SchoolEventSeverity.MEDIUM
      : severity === CameraIncidentSeverity.LOW ? SchoolEventSeverity.LOW
      : SchoolEventSeverity.INFO,
    occurredAt: event.occurredAt,
    sourceType: "CAMERA_INCIDENT",
    sourceId: incident.id,
    deviceId: event.deviceId,
    cameraId: camera.id,
    correlationKey: `camera:${camera.id}`,
    title: incident.eventType,
    reviewRequired: true,
    metadata: { incidentId: incident.id, confidence, aiReviewEnabled: camera.aiReviewEnabled },
  });
  return {
    adapter: "CAMERA_INCIDENT",
    incidentId: incident.id,
    reviewRequired: true,
    aiReviewEnabled: camera.aiReviewEnabled,
  };
}

export async function processConnectedDeviceEvent(eventId: string) {
  const event = await systemPrisma.connectedDeviceEvent.findUnique({
    where: { id: eventId },
    include: { device: { select: { id: true, organizationId: true, branchId: true, code: true, kind: true, status: true } } },
  });
  if (!event) throw new Error("Connected Device event not found");
  if (event.status === ConnectedDeviceEventStatus.PROCESSED) {
    return { eventId: event.id, status: event.status, replay: true, result: event.normalized };
  }
  if (event.status === ConnectedDeviceEventStatus.REJECTED) {
    return { eventId: event.id, status: event.status, replay: true, errorCode: event.errorCode };
  }
  const parsed = normalizedSchema.safeParse(event.normalized);
  if (!parsed.success) {
    await systemPrisma.connectedDeviceEvent.update({
      where: { id: event.id },
      data: {
        status: ConnectedDeviceEventStatus.REJECTED,
        errorCode: "DEVICE_NORMALIZED_PAYLOAD_INVALID",
        errorMessage: parsed.error.issues.slice(0, 5).map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; "),
        processedAt: new Date(),
      },
    });
    return { eventId: event.id, status: ConnectedDeviceEventStatus.REJECTED, errorCode: "DEVICE_NORMALIZED_PAYLOAD_INVALID" };
  }

  try {
    let result: Record<string, unknown>;
    if (isSafetySignal(event.eventType)) result = await processSafetySignal(event, parsed.data);
    else if (parsed.data.category === "IDENTITY") result = await processIdentity(event, parsed.data);
    else if (parsed.data.category === "LOCATION") result = await processLocation(event, parsed.data);
    else if (parsed.data.category === "ACCESS") result = await processAccess(event, parsed.data);
    else if (parsed.data.category === "VIDEO") result = await processVideo(event, parsed.data);
    else if (parsed.data.category === "HEARTBEAT") result = { adapter: "HEARTBEAT" };
    else {
      return { eventId: event.id, status: event.status, replay: false, pendingAdapter: parsed.data.category };
    }

    const updated = await systemPrisma.connectedDeviceEvent.update({
      where: { id: event.id },
      data: {
        status: ConnectedDeviceEventStatus.PROCESSED,
        normalized: json({ ...parsed.data, processing: result }),
        processedAt: new Date(),
        errorCode: null,
        errorMessage: null,
      },
      select: { id: true, status: true, processedAt: true, normalized: true },
    });
    return { eventId: updated.id, status: updated.status, replay: false, result };
  } catch (error) {
    if (error instanceof DeviceEventProcessingError) {
      const updated = await systemPrisma.connectedDeviceEvent.update({
        where: { id: event.id },
        data: {
          status: ConnectedDeviceEventStatus.REJECTED,
          errorCode: error.code,
          errorMessage: error.message,
          processedAt: new Date(),
        },
        select: { id: true, status: true, errorCode: true, errorMessage: true, processedAt: true },
      });
      return { eventId: updated.id, status: updated.status, replay: false, errorCode: updated.errorCode, errorMessage: updated.errorMessage };
    }
    throw error;
  }
}
