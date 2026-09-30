import {
  AttendanceStatus,
  CampusAccessDecision,
  CampusAccessSubjectType,
  ConnectedDeviceBindingType,
  ConnectedDeviceEventStatus,
  Prisma,
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
  return { adapter: "CAMPUS_ACCESS", accessEventId: created.id, decision: created.decision, reasonCode: created.reasonCode };
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
    if (parsed.data.category === "IDENTITY") result = await processIdentity(event, parsed.data);
    else if (parsed.data.category === "LOCATION") result = await processLocation(event, parsed.data);
    else if (parsed.data.category === "ACCESS") result = await processAccess(event, parsed.data);
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
