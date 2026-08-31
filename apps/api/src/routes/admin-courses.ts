import {
  AcademicBoard,
  AcademicPreparationType,
  AcademicStream,
  ClassLevel,
  CourseCategoryType,
  CourseMode,
  CourseStatus,
  CourseType,
  MasterReviewStatus,
  MasterStatus,
  Prisma,
  Role,
  ScienceCombination,
} from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { ensureDefaultCourseCategories } from "../lib/default-course-categories.js";
import { ensureEducationCatalogs } from "../lib/education-catalogs.js";
import { compatibleLegacyCourseType, courseTaxonomyError } from "../lib/education-taxonomy.js";
import { AppError } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { allow, requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN));

const nullableId = z.string().cuid().nullable().optional();
const input = z.object({
  title: z.string().trim().min(3),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/),
  courseCode: z.string().trim().min(2).max(30),
  shortDescription: z.string().trim().max(300).nullable().optional(),
  fullDescription: z.string().trim().min(10),
  categoryType: z.nativeEnum(CourseCategoryType),
  classLevel: z.nativeEnum(ClassLevel).nullable().optional(),
  academicBoard: z.nativeEnum(AcademicBoard).nullable().optional(),
  customBoardName: z.string().trim().max(120).nullable().optional(),
  academicStream: z.nativeEnum(AcademicStream).nullable().optional(),
  scienceCombination: z.nativeEnum(ScienceCombination).nullable().optional(),
  academicPreparation: z.nativeEnum(AcademicPreparationType).nullable().optional(),
  competitiveExamId: nullableId,
  skillCategoryId: nullableId,
  courseType: z.nativeEnum(CourseType).optional(),
  stream: z.string().trim().max(80).nullable().optional(),
  durationDays: z.number().int().positive().nullable().optional(),
  regularPricePaise: z.number().int().min(0),
  salePricePaise: z.number().int().min(0).nullable().optional(),
  registrationFeePaise: z.number().int().min(0).default(0),
  admissionFeePaise: z.number().int().min(0).default(0),
  thumbnailUrl: z.string().url().nullable().optional(),
  brochureUrl: z.string().url().nullable().optional(),
  eligibility: z.string().max(5000).nullable().optional(),
  learningOutcomes: z.string().max(5000).nullable().optional(),
  language: z.string().trim().min(2),
  mode: z.nativeEnum(CourseMode),
  status: z.nativeEnum(CourseStatus).default(CourseStatus.DRAFT),
  isFeatured: z.boolean().default(false),
  enrollmentOpen: z.boolean().default(true),
  startDate: z.coerce.date().nullable().optional(),
  endDate: z.coerce.date().nullable().optional(),
  branchId: nullableId,
  categoryId: nullableId,
});

const select = {
  id: true, title: true, slug: true, courseCode: true, shortDescription: true, fullDescription: true,
  courseType: true, classLevel: true, stream: true, categoryType: true, taxonomyReviewStatus: true,
  academicBoard: true, customBoardName: true, academicStream: true, scienceCombination: true,
  academicPreparation: true, competitiveExamId: true, skillCategoryId: true,
  durationDays: true, regularPricePaise: true, salePricePaise: true, registrationFeePaise: true,
  admissionFeePaise: true, thumbnailUrl: true, brochureUrl: true, eligibility: true,
  learningOutcomes: true, language: true, mode: true, status: true, isFeatured: true,
  enrollmentOpen: true, startDate: true, endDate: true, branchId: true, categoryId: true,
  createdAt: true, updatedAt: true,
  category: { select: { id: true, name: true } },
  competitiveExam: { select: { id: true, name: true, code: true, status: true } },
  skillCategory: { select: { id: true, name: true, code: true, status: true } },
  branch: { select: { id: true, branchName: true } },
  instructor: { select: { id: true, name: true } },
  subjects: { include: { subject: true, teacher: { select: { id: true, name: true } } } },
  _count: { select: { enrollments: true, batches: true, modules: true } },
} as const;

async function scope(req: AuthRequest, branchId?: string | null) {
  if (req.auth!.role !== Role.BRANCH_ADMIN) return undefined;
  const assigned = await prisma.branchUser.findMany({ where: { userId: req.auth!.userId }, select: { branchId: true } });
  const ids = assigned.map((item) => item.branchId);
  if (branchId && !ids.includes(branchId)) throw new AppError(403, "BRANCH_FORBIDDEN", "Branch access denied");
  return ids;
}

function validateCommon(data: { regularPricePaise?: number; salePricePaise?: number | null; startDate?: Date | null; endDate?: Date | null }) {
  if (data.regularPricePaise !== undefined && data.salePricePaise != null && data.salePricePaise > data.regularPricePaise) throw new AppError(422, "INVALID_PRICE", "Sale price cannot exceed regular price");
  if (data.startDate && data.endDate && data.endDate < data.startDate) throw new AppError(422, "INVALID_DATES", "End date must follow start date");
}

async function courseWrite<T>(operation: () => Promise<T>) {
  try { return await operation(); }
  catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const slugConflict = String(error.meta?.target ?? "").toLowerCase().includes("slug");
      throw new AppError(409, slugConflict ? "COURSE_SLUG_EXISTS" : "COURSE_CODE_EXISTS", slugConflict ? "A course already uses this slug" : "A course already uses this course code");
    }
    throw error;
  }
}

async function validateTaxonomy(data: z.infer<typeof input>) {
  const error = courseTaxonomyError(data);
  if (error) throw new AppError(422, "INVALID_COURSE_TAXONOMY", error);
  const [exam, skill] = await Promise.all([
    data.competitiveExamId ? prisma.competitiveExam.findUnique({ where: { id: data.competitiveExamId }, select: { code: true, status: true } }) : null,
    data.skillCategoryId ? prisma.skillCategory.findUnique({ where: { id: data.skillCategoryId }, select: { id: true, status: true } }) : null,
  ]);
  if (data.competitiveExamId && (!exam || exam.status !== MasterStatus.ACTIVE)) throw new AppError(422, "INVALID_COMPETITIVE_EXAM", "Select an active competitive exam in this organization");
  if (data.skillCategoryId && (!skill || skill.status !== MasterStatus.ACTIVE)) throw new AppError(422, "INVALID_SKILL_CATEGORY", "Select an active skill category in this organization");
  return compatibleLegacyCourseType(data.categoryType, exam?.code);
}

router.get("/course-categories", async (req: AuthRequest, res) => {
  if (!await prisma.category.count()) await ensureDefaultCourseCategories(prisma, req.auth!.organizationId);
  res.json({ data: await prisma.category.findMany({ orderBy: { name: "asc" } }) });
});

router.get("/course-taxonomy/options", async (req: AuthRequest, res) => {
  await ensureEducationCatalogs(prisma, req.auth!.organizationId);
  const [competitiveExams, skillCategories] = await Promise.all([
    prisma.competitiveExam.findMany({ where: { status: MasterStatus.ACTIVE }, orderBy: { name: "asc" } }),
    prisma.skillCategory.findMany({ where: { status: MasterStatus.ACTIVE }, orderBy: { name: "asc" } }),
  ]);
  res.json({ data: { competitiveExams, skillCategories } });
});

router.get("/course-subjects", async (_req, res) => res.json({ data: await prisma.subject.findMany({ where: { status: "ACTIVE", legacyReviewStatus: "CONFIRMED" }, orderBy: { name: "asc" } }) }));

router.get("/courses", async (req: AuthRequest, res) => {
  const query = z.object({
    page: z.coerce.number().positive().default(1), limit: z.coerce.number().min(1).max(100).default(10), search: z.string().optional(),
    status: z.nativeEnum(CourseStatus).optional(), courseType: z.nativeEnum(CourseType).optional(), categoryType: z.nativeEnum(CourseCategoryType).optional(),
    branchId: z.string().cuid().optional(), sortBy: z.enum(["title", "courseCode", "regularPricePaise", "durationDays", "startDate", "createdAt"]).default("createdAt"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
  }).parse(req.query);
  const ids = await scope(req, query.branchId);
  const branchFilter = query.branchId ? { OR: [{ branchId: query.branchId }, { branchId: null }] } : ids ? { OR: [{ branchId: { in: ids } }, { branchId: null }] } : {};
  const where = {
    ...branchFilter,
    ...(query.status ? { status: query.status } : {}),
    ...(query.courseType ? { courseType: query.courseType } : {}),
    ...(query.categoryType ? { categoryType: query.categoryType } : {}),
    ...(query.search ? { AND: [{ OR: [{ title: { contains: query.search, mode: "insensitive" as const } }, { courseCode: { contains: query.search, mode: "insensitive" as const } }, { slug: { contains: query.search, mode: "insensitive" as const } }, { fullDescription: { contains: query.search, mode: "insensitive" as const } }] }] } : {}),
  };
  const [total, data] = await prisma.$transaction([
    prisma.course.count({ where }),
    prisma.course.findMany({ where, select, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: { [query.sortBy]: query.sortOrder } }),
  ]);
  res.json({ data, meta: { total, page: query.page, limit: query.limit, totalPages: Math.max(1, Math.ceil(total / query.limit)) } });
});

router.get("/courses/:id", async (req: AuthRequest, res) => {
  const data = await prisma.course.findUnique({ where: { id: String(req.params.id) }, select });
  if (!data) throw new AppError(404, "COURSE_NOT_FOUND", "Course not found");
  await scope(req, data.branchId);
  res.json({ data });
});

router.post("/courses", async (req: AuthRequest, res) => {
  const data = input.parse(req.body);
  validateCommon(data);
  await scope(req, data.branchId);
  const legacyCourseType = await validateTaxonomy(data);
  const [duplicate, category] = await Promise.all([
    prisma.course.findFirst({ where: { OR: [{ slug: data.slug }, { courseCode: data.courseCode }] }, select: { slug: true, courseCode: true } }),
    data.categoryId ? prisma.category.findUnique({ where: { id: data.categoryId }, select: { id: true } }) : null,
  ]);
  if (duplicate) throw new AppError(409, duplicate.slug === data.slug ? "COURSE_SLUG_EXISTS" : "COURSE_CODE_EXISTS", duplicate.slug === data.slug ? "A course already uses this slug" : "A course already uses this course code");
  if (data.categoryId && !category) throw new AppError(422, "CATEGORY_NOT_FOUND", "Select a valid legacy course category");
  const { courseType: _ignored, ...createData } = data;
  res.status(201).json({ data: await courseWrite(() => prisma.course.create({ data: { ...createData, courseType: legacyCourseType, taxonomyReviewStatus: MasterReviewStatus.CONFIRMED, createdById: req.auth!.userId }, select })) });
});

router.patch("/courses/:id", async (req: AuthRequest, res) => {
  const old = await prisma.course.findUnique({ where: { id: String(req.params.id) } });
  if (!old) throw new AppError(404, "COURSE_NOT_FOUND", "Course not found");
  await scope(req, old.branchId);
  const patch = input.partial().parse(req.body);
  if (patch.branchId !== undefined) await scope(req, patch.branchId);
  if (patch.categoryId) {
    const category = await prisma.category.findUnique({ where: { id: patch.categoryId }, select: { id: true } });
    if (!category) throw new AppError(422, "CATEGORY_NOT_FOUND", "Select a valid legacy course category");
  }
  validateCommon({ regularPricePaise: patch.regularPricePaise ?? old.regularPricePaise, salePricePaise: patch.salePricePaise === undefined ? old.salePricePaise : patch.salePricePaise, startDate: patch.startDate === undefined ? old.startDate : patch.startDate, endDate: patch.endDate === undefined ? old.endDate : patch.endDate });
  let courseType = patch.courseType;
  let taxonomyReviewStatus = old.taxonomyReviewStatus;
  if (patch.categoryType !== undefined || old.categoryType !== null) {
    const merged = input.parse({ ...old, ...patch, categoryType: patch.categoryType ?? old.categoryType });
    courseType = await validateTaxonomy(merged);
    taxonomyReviewStatus = MasterReviewStatus.CONFIRMED;
  }
  if (patch.slug || patch.courseCode) {
    const duplicate = await prisma.course.findFirst({ where: { id: { not: old.id }, OR: [...(patch.slug ? [{ slug: patch.slug }] : []), ...(patch.courseCode ? [{ courseCode: patch.courseCode }] : [])] }, select: { slug: true, courseCode: true } });
    if (duplicate) throw new AppError(409, duplicate.slug === patch.slug ? "COURSE_SLUG_EXISTS" : "COURSE_CODE_EXISTS", duplicate.slug === patch.slug ? "A course already uses this slug" : "A course already uses this course code");
  }
  const { courseType: _ignored, ...updateData } = patch;
  res.json({ data: await courseWrite(() => prisma.course.update({ where: { id: old.id }, data: { ...updateData, ...(courseType ? { courseType } : {}), taxonomyReviewStatus }, select })) });
});

router.patch("/courses/:id/status", async (req: AuthRequest, res) => {
  const existing = await prisma.course.findUnique({ where: { id: String(req.params.id) }, select: { id: true, branchId: true } });
  if (!existing) throw new AppError(404, "COURSE_NOT_FOUND", "Course not found");
  await scope(req, existing.branchId);
  res.json({ data: await prisma.course.update({ where: { id: existing.id }, data: { status: z.object({ status: z.nativeEnum(CourseStatus) }).parse(req.body).status }, select }) });
});

router.patch("/courses/:id/featured", async (req: AuthRequest, res) => {
  const existing = await prisma.course.findUnique({ where: { id: String(req.params.id) }, select: { id: true, branchId: true } });
  if (!existing) throw new AppError(404, "COURSE_NOT_FOUND", "Course not found");
  await scope(req, existing.branchId);
  res.json({ data: await prisma.course.update({ where: { id: existing.id }, data: { isFeatured: z.object({ isFeatured: z.boolean() }).parse(req.body).isFeatured }, select }) });
});

router.delete("/courses/:id", async (req: AuthRequest, res) => {
  const course = await prisma.course.findUnique({ where: { id: String(req.params.id) }, include: { _count: { select: { enrollments: true, batches: true, modules: true, teacherAllocations: true } } } });
  if (!course) throw new AppError(404, "COURSE_NOT_FOUND", "Course not found");
  await scope(req, course.branchId);
  if (course._count.enrollments || course._count.batches || course._count.modules || course._count.teacherAllocations) throw new AppError(409, "COURSE_IN_USE", "Archive this course; it has active dependencies");
  await prisma.course.delete({ where: { id: course.id } });
  res.status(204).send();
});

router.post("/courses/:id/subjects", async (req: AuthRequest, res) => {
  const courseId = z.string().cuid().parse(req.params.id);
  const data = z.object({ subjectId: z.string().cuid(), teacherId: z.string().cuid().nullable().optional(), position: z.number().int().min(0).default(0), isActive: z.boolean().default(true) }).parse(req.body);
  const [course, subject] = await Promise.all([
    prisma.course.findUnique({ where: { id: courseId }, select: { branchId: true } }),
    prisma.subject.findUnique({ where: { id: data.subjectId }, select: { status: true, legacyReviewStatus: true } }),
  ]);
  if (!course) throw new AppError(404, "COURSE_NOT_FOUND", "Course not found");
  await scope(req, course.branchId);
  if (!subject || subject.status !== "ACTIVE" || subject.legacyReviewStatus !== "CONFIRMED") throw new AppError(422, "INVALID_SUBJECT", "Select an active, confirmed subject from this organization");
  res.status(201).json({ data: await prisma.courseSubject.upsert({ where: { courseId_subjectId: { courseId, subjectId: data.subjectId } }, update: data, create: { ...data, courseId } }) });
});

router.delete("/courses/:id/subjects/:subjectId", async (req: AuthRequest, res) => {
  const courseId = z.string().cuid().parse(req.params.id), subjectId = z.string().cuid().parse(req.params.subjectId);
  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { branchId: true } });
  if (!course) throw new AppError(404, "COURSE_NOT_FOUND", "Course not found");
  await scope(req, course.branchId);
  const references = await Promise.all([
    prisma.teacherAllocation.count({ where: { courseId, subjectId } }), prisma.timetable.count({ where: { courseId, subjectId } }),
    prisma.homework.count({ where: { courseId, subjectId } }), prisma.examination.count({ where: { courseId, subjectId } }),
  ]);
  if (references.some(Boolean)) throw new AppError(409, "COURSE_SUBJECT_IN_USE", "Deactivate this course subject; academic history references it");
  await prisma.courseSubject.delete({ where: { courseId_subjectId: { courseId, subjectId } } });
  res.status(204).send();
});

export default router;
