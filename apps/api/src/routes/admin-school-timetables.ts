import { Prisma, Role, TimetableDay, TimetableStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { allow, requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN));
const id = z.string().cuid();
const selection = z.object({
  periodNumber: z.number().int().min(1).max(50),
  subjectId: id,
  teacherId: id,
  classroomId: id,
});
const request = z.object({
  batchId: id,
  day: z.nativeEnum(TimetableDay),
  entries: z.array(selection).min(1).max(50),
});
const query = z.object({ batchId: id, day: z.nativeEnum(TimetableDay) });
type Client = Prisma.TransactionClient | typeof prisma;
type Selection = z.infer<typeof selection>;

async function schoolContext(req: AuthRequest, batchId: string, day: TimetableDay, db: Client) {
  const orgId = req.auth!.organizationId;
  if (!orgId) throw new AppError(403, "INSTITUTION_REQUIRED", "Organization selection is required");
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { groupLabelType: true } });
  if (org?.groupLabelType !== "SECTION") {
    throw new AppError(403, "SCHOOL_TIMETABLE_ONLY", "Class-wise timetable editing is available for school organizations only");
  }
  const batch = await db.batch.findFirst({
    where: { id: batchId, organizationId: orgId, status: "ACTIVE", branch: { organizationId: orgId, isActive: true } },
    select: { id: true, name: true, branchId: true, courseId: true, academicSessionId: true, academicSession: true,
      branch: { select: { branchName: true } }, course: { select: { title: true } } },
  });
  if (!batch) throw new AppError(404, "SCHOOL_SECTION_NOT_FOUND", "Active section not found in your institution");
  if (req.auth!.role === Role.BRANCH_ADMIN) {
    const allowed = await db.branchUser.findFirst({
      where: { branchId: batch.branchId, userId: req.auth!.userId }, select: { branchId: true },
    });
    if (!allowed) throw new AppError(403, "BRANCH_FORBIDDEN", "You cannot manage this school branch");
  }
  const [periods, allocations, classrooms, existing] = await Promise.all([
    db.timetablePeriod.findMany({
      where: { branchId: batch.branchId, academicSessionId: batch.academicSessionId, day, isActive: true, organizationId: orgId },
      select: { id: true, periodNumber: true, startMinute: true, endMinute: true, type: true, label: true },
      orderBy: [{ startMinute: "asc" }, { periodNumber: "asc" }],
    }),
    db.teacherAllocation.findMany({
      where: { organizationId: orgId, branchId: batch.branchId, courseId: batch.courseId,
        batchId: batch.id, academicSessionId: batch.academicSessionId, status: "ACTIVE",
        subject: { status: "ACTIVE", courses: { some: { courseId: batch.courseId, isActive: true } } },
        teacher: { branchId: batch.branchId, user: { isActive: true } } },
      select: { id: true, subjectId: true, teacherId: true, weeklyPeriods: true,
        subject: { select: { name: true } }, teacher: { select: { user: { select: { name: true } } } } },
    }),
    db.classroom.findMany({ where: { branchId: batch.branchId, organizationId: orgId, isActive: true },
      select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.timetable.findMany({ where: { organizationId: orgId, batchId: batch.id, day, status: { not: "ARCHIVED" } },
      select: { id: true, periodNumber: true, startMinute: true, endMinute: true, subjectId: true,
        teacherId: true, classroomId: true, status: true,
        subject: { select: { name: true } }, teacher: { select: { user: { select: { name: true } } } },
        classroom: { select: { name: true } } }, orderBy: { startMinute: "asc" } }),
  ]);
  return { batch, periods, allocations, classrooms, existing };
}

async function plan(req: AuthRequest, batchId: string, day: TimetableDay, entries: Selection[], db: Client) {
  const context = await schoolContext(req, batchId, day, db);
  const periodMap = new Map(context.periods.map(p => [p.periodNumber, p]));
  const pairs = new Set(context.allocations.map(a => a.teacherId + ":" + a.subjectId));
  const rooms = new Set(context.classrooms.map(r => r.id));
  const seen = new Set<number>();
  const conflicts: Array<{ periodNumber: number; code: string; message: string }> = [];
  const prepared: Array<Selection & { startMinute: number; endMinute: number }> = [];
  for (const entry of entries) {
    const period = periodMap.get(entry.periodNumber);
    const conflict = (code: string, message: string) => conflicts.push({ periodNumber: entry.periodNumber, code, message });
    if (seen.has(entry.periodNumber)) { conflict("DUPLICATE_DAY_PERIOD", "Select each teaching period only once"); continue; }
    seen.add(entry.periodNumber);
    if (!period || period.type !== "TEACHING") { conflict("NOT_A_TEACHING_PERIOD", "Only configured teaching periods may have subjects and teachers"); continue; }
    if (!pairs.has(entry.teacherId + ":" + entry.subjectId)) { conflict("SUBJECT_NOT_ALLOCATED", "Assign this subject and teacher to the section before scheduling"); continue; }
    if (!rooms.has(entry.classroomId)) { conflict("INVALID_CLASSROOM", "Select an active classroom belonging to this branch"); continue; }
    const base = { organizationId: req.auth!.organizationId!, branchId: context.batch.branchId,
      academicSessionId: context.batch.academicSessionId, day,
      startMinute: { lt: period.endMinute }, endMinute: { gt: period.startMinute } };
    const [sectionOccupied, teacherOccupied, roomOccupied, archivedExact] = await Promise.all([
      db.timetable.findFirst({ where: { ...base, batchId, status: { not: TimetableStatus.ARCHIVED } }, select: { id: true } }),
      db.timetable.findFirst({ where: { ...base, teacherId: entry.teacherId, status: { not: TimetableStatus.ARCHIVED } }, select: { id: true } }),
      db.timetable.findFirst({ where: { ...base, classroomId: entry.classroomId, status: { not: TimetableStatus.ARCHIVED } }, select: { id: true } }),
      db.timetable.findFirst({ where: { branchId: context.batch.branchId, batchId, day,
        startMinute: period.startMinute, endMinute: period.endMinute }, select: { id: true } }),
    ]);
    if (sectionOccupied || archivedExact) conflict("SECTION_PERIOD_OCCUPIED", "This section already has an entry in that period, including archived slots");
    else if (teacherOccupied) conflict("TEACHER_SCHEDULE_CONFLICT", "This teacher is already scheduled at this time");
    else if (roomOccupied) conflict("CLASSROOM_SCHEDULE_CONFLICT", "This classroom is already scheduled at this time");
    else prepared.push({ ...entry, startMinute: period.startMinute, endMinute: period.endMinute });
  }
  return { context, conflicts, prepared };
}

router.get("/timetables/school-day", async (req: AuthRequest, res) => {
  const params = query.parse(req.query);
  const data = await schoolContext(req, params.batchId, params.day, prisma);
  res.json({ data });
});

router.post("/timetables/school-day/preview", async (req: AuthRequest, res) => {
  const parsed = request.parse(req.body);
  const result = await plan(req, parsed.batchId, parsed.day, parsed.entries, prisma);
  res.json({ data: { requested: parsed.entries.length, conflicts: result.conflicts,
    available: result.prepared.length } });
});

router.post("/timetables/school-day", async (req: AuthRequest, res) => {
  const parsed = request.parse(req.body);
  // Serialize writes for this branch. The same advisory lock is used by the existing weekly and single-period flows.
  const saved = await prisma.$transaction(async tx => {
    const context = await schoolContext(req, parsed.batchId, parsed.day, tx);
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${"erp-timetable:" + context.batch.branchId}))`;
    const checked = await plan(req, parsed.batchId, parsed.day, parsed.entries, tx);
    if (checked.conflicts.length) throw new AppError(409, "SCHOOL_DAY_CONFLICT",
      checked.conflicts.map(c => "Period " + c.periodNumber + ": " + c.message).join("; "));
    const results = [];
    for (const entry of checked.prepared) {
      const row = await tx.timetable.create({
        data: { organizationId: req.auth!.organizationId!, branchId: context.batch.branchId,
          courseId: context.batch.courseId, batchId: context.batch.id,
          academicSessionId: context.batch.academicSessionId, academicSession: context.batch.academicSession,
          day: parsed.day, status: TimetableStatus.ACTIVE, ...entry },
        select: { id: true, periodNumber: true },
      });
      await tx.auditLog.create({ data: { organizationId: req.auth!.organizationId!, actorId: req.auth!.userId,
        action: "CREATE", entity: "Timetable", entityId: row.id,
        metadata: { schoolClassDay: true, batchId: context.batch.id, day: parsed.day, periodNumber: row.periodNumber } } });
      results.push(row);
    }
    return results;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 30000 });
  res.status(201).json({ data: saved, meta: { created: saved.length } });
});

export default router;
