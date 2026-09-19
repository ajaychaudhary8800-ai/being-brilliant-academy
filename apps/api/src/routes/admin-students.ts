import "express-async-errors";
import { Gender, Prisma, Role, StudentAcademicEnrollmentSource, StudentAcademicEnrollmentStatus, StudentAcademicTransitionType, StudentStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { academicEnrollmentInclude, academicPlacementConflict, assertAcademicProjectionConsistent, changeActiveEnrollmentRollNo, closeActiveAcademicEnrollment, createActiveAcademicEnrollment, getActiveAcademicEnrollment, normalizeAcademicRollNumber, resolveAuthoritativeBatchTuple, runSerializableAcademicPlacement, synchronizeStudentAcademicProjection, transitionStudentAcademicPlacement, type AcademicPlacementDb } from "../lib/academic-placement.js";
import { processBulkAcademicTransitions } from "../lib/bulk-academic-transitions.js";
import { AppError } from "../lib/http.js";
import { institutionCalendarDate, parseDateOnly } from "../lib/institution-time.js";
import { logger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import { deleteObject } from "../lib/storage.js";
import { parseStoredImageLocation, storedImagePublicPrefix } from "../lib/stored-image.js";
import { allow, requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN));

const phone = z.string().trim().regex(/^\+?[0-9][0-9 -]{6,19}$/, "Enter a valid mobile number");
const studentPhotoReference = z.union([
  z.string().url(),
  z.string().regex(/^\/api\/v1\/uploaded-images\/student-photo\/[A-Za-z0-9_-]{1,100}\/[0-9a-f-]{36}\.(?:jpg|png|webp)$/, "Invalid student photo reference"),
]);
const input = z.object({
  admissionNo: z.string().trim().toUpperCase().min(3).max(40),
  rollNo: z.string().trim().toUpperCase().min(1).max(30),
  name: z.string().trim().min(2).max(100),
  gender: z.nativeEnum(Gender),
  dateOfBirth: z.coerce.date(),
  fatherName: z.string().trim().min(2).max(100),
  motherName: z.string().trim().min(2).max(100),
  mobile: phone,
  parentMobile: phone,
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128).optional(),
  address: z.string().trim().min(5).max(1000),
  branchId: z.string().cuid(),
  batchId: z.string().cuid(),
  academicSession: z.string().trim().min(4).max(30),
  admissionDate: z.coerce.date(),
  bloodGroup: z.string().trim().max(10).nullable().optional(),
  category: z.string().trim().max(50).nullable().optional(),
  aadhaarNo: z.string().trim().regex(/^\d{12}$/, "Aadhaar number must contain 12 digits").nullable().optional(),
  photoUrl: studentPhotoReference.nullable().optional(),
  status: z.nativeEnum(StudentStatus).default(StudentStatus.ACTIVE),
  remarks: z.string().trim().max(2000).nullable().optional(),
});

const studentSelect = {
  id: true, admissionNo: true, rollNo: true, gender: true, dateOfBirth: true, fatherName: true, motherName: true, branchId: true, batchId: true,
  className: true, parentMobile: true, address: true, academicSession: true, academicSessionId: true, admissionDate: true,
  bloodGroup: true, category: true, aadhaarNo: true, status: true, remarks: true, createdAt: true, updatedAt: true,
  user: { select: { id: true, name: true, email: true, phone: true, avatarUrl: true, isActive: true } },
  branch: { select: { id: true, branchName: true, branchCode: true } },
  batch: { select: { id: true, name: true, code: true, academicSession: true, academicSessionId: true, capacity: true, course: { select: { id: true, title: true, courseCode: true } }, _count: { select: { students: true } } } },
  _count: { select: { fees: true, testAttempts: true, certificates: true } },
} as const;

async function assignedBranches(req: AuthRequest, db: AcademicPlacementDb = prisma) {
  if (req.auth!.role !== Role.BRANCH_ADMIN) return null;
  return (await db.branchUser.findMany({ where: { organizationId: req.auth!.organizationId, userId: req.auth!.userId }, select: { branchId: true } })).map(row => row.branchId);
}
function assertBranchAccess(branchIds: string[] | null, branchId: string) {
  if (branchIds && !branchIds.includes(branchId)) throw new AppError(403, "BRANCH_FORBIDDEN", "Branch access denied");
}
async function access(req: AuthRequest, branchId: string) { assertBranchAccess(await assignedBranches(req), branchId); }

async function serializablePlacement<T>(req: AuthRequest, work: (tx: Prisma.TransactionClient, branchIds: string[] | null) => Promise<T>) {
  return runSerializableAcademicPlacement(prisma, tx => assignedBranches(req, tx), work);
}

function duplicateError(error: unknown) {
  const known = error as { code?: string; meta?: { target?: string[] } };
  if (known?.code !== "P2002") return null;
  const target = known.meta?.target;
  if (target?.includes("admissionNo")) return new AppError(409, "ADMISSION_NO_EXISTS", "Admission number already exists");
  if (target?.includes("email")) return new AppError(409, "EMAIL_EXISTS", "Email already exists");
  if (target?.includes("aadhaarNo")) return new AppError(409, "AADHAAR_EXISTS", "Aadhaar number already exists");
  return academicPlacementConflict(error) ?? new AppError(409, "DUPLICATE_STUDENT", "A unique student value already exists");
}

function requireStudentPhotoAccess(req: AuthRequest, photoUrl: string | null | undefined) {
  if (!photoUrl) return;
  let pathname = photoUrl;
  try { if (/^https?:\/\//i.test(photoUrl)) pathname = new URL(photoUrl).pathname; } catch { return; }
  if (pathname.startsWith(storedImagePublicPrefix) && !parseStoredImageLocation(pathname, req.auth!.organizationId, "student-photo")) throw new AppError(422, "INVALID_PHOTO_REFERENCE", "Student photo does not belong to this organization");
}
async function deleteUnusedStudentPhoto(organizationId: string, photoUrl: string | null) {
  if (!photoUrl) return;
  const location = parseStoredImageLocation(photoUrl, organizationId, "student-photo");
  if (location && !await prisma.user.count({ where: { organizationId, avatarUrl: photoUrl } })) await deleteObject(location.key);
}
const shaped = (student: any) => ({ ...student, branch: { ...student.branch, name: student.branch.branchName, code: student.branch.branchCode }, course: student.batch.course, currentStrength: student.batch._count.students });

async function assertCapacity(tx: Prisma.TransactionClient, batch: { id: string; capacity: number }, excludeStudentId?: string) {
  const current = await tx.studentProfile.count({ where: { batchId: batch.id, ...(excludeStudentId ? { id: { not: excludeStudentId } } : {}) } });
  if (current >= batch.capacity) throw new AppError(409, "BATCH_CAPACITY_REACHED", "The selected batch is at full capacity");
}
async function effectiveDate(tx: Prisma.TransactionClient, organizationId: string) {
  const organization = await tx.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
  if (!organization) throw new AppError(404, "ACADEMIC_PLACEMENT_INCONSISTENT", "Organization not found");
  return parseDateOnly(institutionCalendarDate(new Date(), organization.timezone));
}

async function createStudent(req: AuthRequest, data: z.infer<typeof input> & { password: string }, source: typeof StudentAcademicEnrollmentSource.ADMISSION | typeof StudentAcademicEnrollmentSource.IMPORT) {
  const passwordHash = await bcrypt.hash(data.password, 12);
  try {
    return await serializablePlacement(req, async (tx, branchIds) => {
      const batch = await resolveAuthoritativeBatchTuple(tx, { organizationId: req.auth!.organizationId, batchId: data.batchId, assertedBranchId: data.branchId, assertedAcademicSession: data.academicSession, requireCourse: true });
      assertBranchAccess(branchIds, batch.branchId);
      await assertCapacity(tx, batch);
      const rollNo = normalizeAcademicRollNumber(data.rollNo);
      const user = await tx.user.create({ data: { organizationId: req.auth!.organizationId, name: data.name, email: data.email, phone: data.mobile, avatarUrl: data.photoUrl ?? null, passwordHash, role: Role.STUDENT, isActive: data.status === StudentStatus.ACTIVE } });
      const profile = await tx.studentProfile.create({
        data: { organizationId: req.auth!.organizationId, userId: user.id, admissionNo: data.admissionNo, rollNo, gender: data.gender, dateOfBirth: data.dateOfBirth, fatherName: data.fatherName, motherName: data.motherName, className: batch.course!.title, parentMobile: data.parentMobile, address: data.address, branchId: batch.branchId, batchId: batch.id, academicSessionId: batch.academicSessionId, academicSession: batch.session.name, admissionDate: data.admissionDate, bloodGroup: data.bloodGroup ?? null, category: data.category ?? null, aadhaarNo: data.aadhaarNo ?? null, status: data.status, remarks: data.remarks ?? null },
        select: studentSelect,
      });
      const enrollment = await createActiveAcademicEnrollment(tx, { organizationId: req.auth!.organizationId, studentId: profile.id, branchId: batch.branchId, batchId: batch.id, courseId: batch.course!.id, academicSessionId: batch.academicSessionId, rollNo, source, effectiveFrom: data.admissionDate, createdById: req.auth!.userId });
      assertAcademicProjectionConsistent(profile, enrollment);
      await tx.auditLog.create({ data: { organizationId: req.auth!.organizationId, actorId: req.auth!.userId, action: source === StudentAcademicEnrollmentSource.IMPORT ? "STUDENT_IMPORTED" : "STUDENT_ADMITTED", entity: "StudentAcademicEnrollment", entityId: enrollment.id, metadata: { studentId: profile.id, branchId: batch.branchId, batchId: batch.id, courseId: batch.course!.id, academicSessionId: batch.academicSessionId, source } } });
      return { ...profile, currentEnrollment: enrollment };
    });
  } catch (error) { throw duplicateError(error) ?? error; }
}

router.get("/students", async (req: AuthRequest, res) => {
  const query = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(10), search: z.string().trim().optional(), branchId: z.string().cuid().optional(), courseId: z.string().cuid().optional(), batchId: z.string().cuid().optional(), academicSession: z.string().trim().optional(), gender: z.nativeEnum(Gender).optional(), category: z.string().trim().optional(), status: z.nativeEnum(StudentStatus).optional(), sortBy: z.enum(["admissionNo", "rollNo", "name", "admissionDate", "dateOfBirth", "status", "createdAt"]).default("createdAt"), sortOrder: z.enum(["asc", "desc"]).default("desc") }).parse(req.query);
  const branchIds = await assignedBranches(req);
  if (query.branchId) assertBranchAccess(branchIds, query.branchId);
  const where = { ...(branchIds ? { branchId: { in: branchIds } } : {}), ...(query.branchId ? { branchId: query.branchId } : {}), ...(query.batchId ? { batchId: query.batchId } : {}), ...(query.courseId ? { batch: { courseId: query.courseId } } : {}), ...(query.academicSession ? { academicSession: query.academicSession } : {}), ...(query.gender ? { gender: query.gender } : {}), ...(query.category ? { category: query.category } : {}), ...(query.status ? { status: query.status } : {}), ...(query.search ? { OR: [{ admissionNo: { contains: query.search, mode: "insensitive" as const } }, { rollNo: { contains: query.search, mode: "insensitive" as const } }, { fatherName: { contains: query.search, mode: "insensitive" as const } }, { parentMobile: { contains: query.search, mode: "insensitive" as const } }, { user: { name: { contains: query.search, mode: "insensitive" as const } } }, { user: { email: { contains: query.search, mode: "insensitive" as const } } }, { user: { phone: { contains: query.search, mode: "insensitive" as const } } }] } : {}) };
  const orderBy = query.sortBy === "name" ? { user: { name: query.sortOrder } } : { [query.sortBy]: query.sortOrder };
  const [total, data] = await prisma.$transaction([prisma.studentProfile.count({ where }), prisma.studentProfile.findMany({ where, select: studentSelect, skip: (query.page - 1) * query.limit, take: query.limit, orderBy })]);
  res.json({ data: data.map(shaped), meta: { total, page: query.page, limit: query.limit, totalPages: Math.max(1, Math.ceil(total / query.limit)) } });
});

router.get("/students/export", async (req: AuthRequest, res) => {
  const format = z.enum(["excel", "pdf"]).default("excel").parse(req.query.format);
  const branchIds = await assignedBranches(req);
  const data = await prisma.studentProfile.findMany({ where: branchIds ? { branchId: { in: branchIds } } : {}, select: studentSelect, orderBy: { admissionNo: "asc" } });
  if (format === "pdf") return studentPdf(res, data.map(shaped));
  const rows = [["Admission No", "Roll No", "Name", "Gender", "Branch", "Course", "Batch", "Session", "Mobile", "Parent Mobile", "Email", "Status"], ...data.map(student => [student.admissionNo, student.rollNo, student.user.name, student.gender, student.branch.branchName, student.batch.course?.title ?? "", student.batch.name, student.academicSession, student.user.phone, student.parentMobile, student.user.email, student.status])];
  const xml = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Students"><Table>${rows.map(row => `<Row>${row.map(value => `<Cell><Data ss:Type="String">${escapeXml(String(value ?? ""))}</Data></Cell>`).join("")}</Row>`).join("")}</Table></Worksheet></Workbook>`;
  res.set({ "Content-Type": "application/vnd.ms-excel", "Content-Disposition": "attachment; filename=students.xls" }).send(xml);
});

router.post("/students/import", async (req: AuthRequest, res) => {
  const rows = z.array(input.extend({ password: z.string().min(8).max(128).default("Student@123") })).min(1).max(500).parse(req.body.rows);
  const created: any[] = [];
  const errors: Array<{ row: number; message: string }> = [];
  for (let index = 0; index < rows.length; index += 1) {
    try { requireStudentPhotoAccess(req, rows[index].photoUrl); created.push(await createStudent(req, rows[index], StudentAcademicEnrollmentSource.IMPORT)); }
    catch (error) { const mapped = error instanceof AppError ? error : duplicateError(error); errors.push({ row: index + 2, message: mapped?.message ?? (error as Error).message }); }
  }
  res.status(errors.length ? 207 : 201).json({ data: { created: created.map(shaped), createdCount: created.length, errorCount: errors.length, errors } });
});

router.get("/students/:id/academic-history", async (req: AuthRequest, res) => {
  const query = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(20), academicSessionId: z.string().cuid().optional(), status: z.nativeEnum(StudentAcademicEnrollmentStatus).optional() }).parse(req.query);
  const studentId = String(req.params.id);
  if (!await prisma.studentProfile.findFirst({ where: { organizationId: req.auth!.organizationId, id: studentId }, select: { id: true } })) throw new AppError(404, "STUDENT_NOT_FOUND", "Student not found");
  const branchIds = await assignedBranches(req);
  const where = { organizationId: req.auth!.organizationId, studentId, ...(branchIds ? { branchId: { in: branchIds } } : {}), ...(query.academicSessionId ? { academicSessionId: query.academicSessionId } : {}), ...(query.status ? { status: query.status } : {}) };
  const [total, history] = await prisma.$transaction([prisma.studentAcademicEnrollment.count({ where }), prisma.studentAcademicEnrollment.findMany({ where, include: academicEnrollmentInclude, orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }], skip: (query.page - 1) * query.limit, take: query.limit })]);
  res.json({ data: history, meta: { total, page: query.page, limit: query.limit, totalPages: Math.max(1, Math.ceil(total / query.limit)) } });
});

const transitionInput = z.object({ type: z.enum(["PROMOTED", "RETAINED", "TRANSFERRED", "LEFT", "GRADUATED"]), effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), targetBatchId: z.string().cuid().optional(), rollNo: z.string().trim().toUpperCase().min(1).max(30).optional(), reason: z.string().trim().max(2000).nullable().optional() });

router.post("/students/academic-transitions/bulk", async (req: AuthRequest, res) => {
  const outcome = await processBulkAcademicTransitions(req.body, async item => {
    const result = await transitionStudentAcademicPlacement(prisma, {
      organizationId: req.auth!.organizationId,
      studentId: item.studentId,
      type: item.type,
      effectiveDate: parseDateOnly(item.effectiveDate),
      targetBatchId: item.targetBatchId,
      rollNo: item.rollNo,
      reason: item.reason,
      createdById: req.auth!.userId,
      authorizeBranchIds: tx => assignedBranches(req, tx),
    });
    return result.transition;
  }, context => logger.error({ err: context.error, organizationId: req.auth!.organizationId, userId: req.auth!.userId, studentId: context.studentId, index: context.index }, "Unexpected bulk academic transition failure"));
  res.status(outcome.status).json({ data: outcome.data });
});

router.post("/students/:id/academic-transitions", async (req: AuthRequest, res) => {
  const data = transitionInput.parse(req.body);
  const result = await transitionStudentAcademicPlacement(prisma, { organizationId: req.auth!.organizationId, studentId: String(req.params.id), type: data.type, effectiveDate: parseDateOnly(data.effectiveDate), targetBatchId: data.targetBatchId, rollNo: data.rollNo, reason: data.reason, createdById: req.auth!.userId, authorizeBranchIds: tx => assignedBranches(req, tx) });
  res.status(201).json({ data: result.transition });
});

router.get("/students/:id/academic-transitions", async (req: AuthRequest, res) => {
  const studentId = String(req.params.id);
  const branchIds = await assignedBranches(req);
  const student = await prisma.studentProfile.findFirst({ where: { organizationId: req.auth!.organizationId, id: studentId }, select: { id: true } });
  if (!student) throw new AppError(404, "STUDENT_NOT_FOUND", "Student not found");
  const where = {
    organizationId: req.auth!.organizationId,
    studentId,
    ...(branchIds ? {
      OR: [
        { type: { in: [StudentAcademicTransitionType.LEFT, StudentAcademicTransitionType.GRADUATED] }, fromEnrollment: { branchId: { in: branchIds } } },
        { type: { in: [StudentAcademicTransitionType.PROMOTED, StudentAcademicTransitionType.RETAINED, StudentAcademicTransitionType.TRANSFERRED] }, fromEnrollment: { branchId: { in: branchIds } }, toEnrollment: { branchId: { in: branchIds } } },
      ],
    } : {}),
  };
  const data = await prisma.studentAcademicTransition.findMany({ where, select: { id: true, type: true, effectiveDate: true, reason: true, createdAt: true, fromEnrollment: { select: { id: true, branchId: true, courseId: true, batchId: true, academicSessionId: true, rollNo: true, status: true } }, toEnrollment: { select: { id: true, branchId: true, courseId: true, batchId: true, academicSessionId: true, rollNo: true, status: true } }, createdBy: { select: { id: true, name: true } } }, orderBy: [{ effectiveDate: "asc" }, { createdAt: "asc" }] });
  res.json({ data });
});

router.get("/students/:id", async (req: AuthRequest, res) => {
  const data = await prisma.studentProfile.findFirst({ where: { id: String(req.params.id) }, select: studentSelect });
  if (!data) throw new AppError(404, "STUDENT_NOT_FOUND", "Student not found");
  await access(req, data.branch.id);
  const currentEnrollment = await getActiveAcademicEnrollment(prisma, req.auth!.organizationId, data.id);
  res.json({ data: shaped({ ...data, currentEnrollment }) });
});

router.post("/students", async (req: AuthRequest, res) => {
  const data = input.extend({ password: z.string().min(8).max(128) }).parse(req.body);
  requireStudentPhotoAccess(req, data.photoUrl);
  res.status(201).json({ data: shaped(await createStudent(req, data, StudentAcademicEnrollmentSource.ADMISSION)) });
});

router.patch("/students/:id", async (req: AuthRequest, res) => {
  const studentId = String(req.params.id);
  const data = input.partial().parse(req.body);
  requireStudentPhotoAccess(req, data.photoUrl);
  const passwordHash = data.password ? await bcrypt.hash(data.password, 12) : undefined;
  let replacedPhoto: string | null = null;
  try {
    const result = await serializablePlacement(req, async (tx, branchIds) => {
      const old = await tx.studentProfile.findFirst({ where: { organizationId: req.auth!.organizationId, id: studentId }, select: { id: true, userId: true, branchId: true, batchId: true, academicSessionId: true, rollNo: true, user: { select: { avatarUrl: true } } } });
      if (!old) throw new AppError(404, "STUDENT_NOT_FOUND", "Student not found");
      assertBranchAccess(branchIds, old.branchId);
      replacedPhoto = old.user.avatarUrl;
      const { name, email, mobile, photoUrl, password: _password, branchId: _branchId, batchId: _batchId, academicSession: _academicSession, rollNo: _rollNo, ...profileFields } = data;
      await tx.user.update({ where: { id: old.userId }, data: { ...(name ? { name } : {}), ...(email ? { email } : {}), ...(mobile ? { phone: mobile } : {}), ...(photoUrl !== undefined ? { avatarUrl: photoUrl } : {}), ...(passwordHash ? { passwordHash } : {}), ...(data.status ? { isActive: data.status === StudentStatus.ACTIVE } : {}) } });
      const placementRequested = data.batchId !== undefined || data.branchId !== undefined || data.academicSession !== undefined || data.rollNo !== undefined;
      let currentEnrollment = null;
      if (placementRequested) {
        const active = await getActiveAcademicEnrollment(tx, req.auth!.organizationId, old.id);
        if (!active) throw new AppError(409, "NO_ACTIVE_ACADEMIC_ENROLLMENT", "Student has no active academic enrollment");
        assertAcademicProjectionConsistent(old, active);
        const target = await resolveAuthoritativeBatchTuple(tx, { organizationId: req.auth!.organizationId, batchId: data.batchId ?? old.batchId, assertedBranchId: data.branchId, assertedAcademicSession: data.academicSession, requireCourse: true });
        assertBranchAccess(branchIds, target.branchId);
        const rollNo = normalizeAcademicRollNumber(data.rollNo ?? active.rollNo);
        if (target.id !== active.batchId) {
          await assertCapacity(tx, target, old.id);
          const changeDate = await effectiveDate(tx, req.auth!.organizationId);
          await closeActiveAcademicEnrollment(tx, active, changeDate);
          currentEnrollment = await createActiveAcademicEnrollment(tx, { organizationId: req.auth!.organizationId, studentId: old.id, branchId: target.branchId, batchId: target.id, courseId: target.course!.id, academicSessionId: target.academicSessionId, rollNo, source: StudentAcademicEnrollmentSource.ADMIN_CHANGE, effectiveFrom: changeDate, createdById: req.auth!.userId });
        } else if (rollNo !== normalizeAcademicRollNumber(active.rollNo)) currentEnrollment = await changeActiveEnrollmentRollNo(tx, active, rollNo);
        else currentEnrollment = active;
        const projection = await synchronizeStudentAcademicProjection(tx, { organizationId: req.auth!.organizationId, studentId: old.id, branchId: target.branchId, batchId: target.id, academicSessionId: target.academicSessionId, academicSession: target.session.name, courseTitle: target.course!.title, rollNo });
        assertAcademicProjectionConsistent(projection, currentEnrollment);
        await tx.auditLog.create({ data: { organizationId: req.auth!.organizationId, actorId: req.auth!.userId, action: "STUDENT_ACADEMIC_PLACEMENT_UPDATED", entity: "StudentAcademicEnrollment", entityId: currentEnrollment.id, metadata: { studentId: old.id, sourceBranchId: old.branchId, targetBranchId: target.branchId, sourceBatchId: active.batchId, targetBatchId: target.id, academicSessionId: target.academicSessionId } } });
      }
      if (Object.keys(profileFields).length) await tx.studentProfile.update({ where: { id: old.id }, data: profileFields });
      const updated = await tx.studentProfile.findFirst({ where: { id: old.id }, select: studentSelect });
      if (!updated) throw new AppError(404, "STUDENT_NOT_FOUND", "Student not found");
      return { ...updated, ...(placementRequested ? { currentEnrollment } : {}) };
    });
    if (data.photoUrl !== undefined && data.photoUrl !== replacedPhoto) await deleteUnusedStudentPhoto(req.auth!.organizationId, replacedPhoto).catch(error => logger.warn({ err: error, studentId }, "Unable to remove replaced student photo"));
    res.json({ data: shaped(result) });
  } catch (error) { throw duplicateError(error) ?? error; }
});

router.patch("/students/:id/status", async (req: AuthRequest, res) => {
  const { status } = z.object({ status: z.nativeEnum(StudentStatus) }).parse(req.body);
  const old = await prisma.studentProfile.findFirst({ where: { id: String(req.params.id) }, select: { id: true, userId: true, branchId: true } });
  if (!old) throw new AppError(404, "STUDENT_NOT_FOUND", "Student not found");
  await access(req, old.branchId);
  const data = await prisma.$transaction(async tx => { await tx.user.update({ where: { id: old.userId }, data: { isActive: status === StudentStatus.ACTIVE } }); return tx.studentProfile.update({ where: { id: old.id }, data: { status }, select: studentSelect }); });
  res.json({ data: shaped(data) });
});

router.delete("/students/:id", async (req: AuthRequest, res) => {
  const student = await prisma.studentProfile.findFirst({ where: { id: String(req.params.id) }, select: { id: true, userId: true, branchId: true, user: { select: { avatarUrl: true } }, _count: { select: { fees: true, testAttempts: true, certificates: true, academicEnrollments: true } } } });
  if (!student) throw new AppError(404, "STUDENT_NOT_FOUND", "Student not found");
  await access(req, student.branchId);
  const [attendance, exam, assignment] = await Promise.all([prisma.attendance.count({ where: { studentId: student.userId } }), prisma.examAttempt.count({ where: { studentId: student.userId } }), prisma.assignmentSubmission.count({ where: { studentId: student.userId } })]);
  if (attendance || student._count.fees || student._count.certificates || student._count.testAttempts || student._count.academicEnrollments || exam || assignment) throw new AppError(409, "STUDENT_HAS_ACADEMIC_RECORDS", "Archive this student; academic, attendance, fee, certificate or exam data prevents deletion");
  await prisma.$transaction([prisma.studentProfile.delete({ where: { id: student.id } }), prisma.user.delete({ where: { id: student.userId } })]);
  await deleteUnusedStudentPhoto(req.auth!.organizationId, student.user.avatarUrl).catch(error => logger.warn({ err: error, studentId: student.id }, "Unable to remove deleted student photo"));
  res.status(204).send();
});

function escapeXml(value: string) { return value.replace(/[<>&'\"]/g, character => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[character]!); }
function studentPdf(res: any, data: any[]) {
  const lines = ["BEING BRILLIANT ACADEMY - STUDENT DIRECTORY", ...data.slice(0, 45).map(student => `${student.admissionNo} | ${student.rollNo} | ${student.user.name} | ${student.branch.name} | ${student.batch.name} | ${student.status}`)];
  const content = lines.map((line, index) => `BT /F1 ${index ? 9 : 16} Tf 35 ${800 - index * 16} Td (${line.replace(/[()\\]/g, "\\$&")}) Tj ET`).join("\n");
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>", `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let pdf = "%PDF-1.4\n"; const addresses = [0];
  objects.forEach((object, index) => { addresses.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${addresses.slice(1).map(address => `${String(address).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  res.set({ "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename=students.pdf" }).send(Buffer.from(pdf));
}

export default router;
