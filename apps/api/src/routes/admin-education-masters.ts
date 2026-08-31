import { MasterReviewStatus, MasterStatus, Prisma, Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { ensureEducationCatalogs } from "../lib/education-catalogs.js";
import { AppError } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { allow, requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN));
const id = z.string().cuid();
const masterInput = z.object({ name: z.string().trim().min(2).max(120), code: z.string().trim().toUpperCase().min(2).max(50).regex(/^[A-Z0-9_-]+$/), status: z.nativeEnum(MasterStatus).default(MasterStatus.ACTIVE) });
const duplicate = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
const audit = (req: AuthRequest, action: string, entity: string, entityId: string, metadata?: object) => prisma.auditLog.create({ data: { actorId: req.auth!.userId, action, entity, entityId, metadata } });

router.get("/education-masters", async (req: AuthRequest, res) => {
  await ensureEducationCatalogs(prisma, req.auth!.organizationId);
  const includeInactive = z.enum(["true", "false"]).default("false").transform((value) => value === "true").parse(req.query.includeInactive), where = includeInactive ? {} : { status: MasterStatus.ACTIVE };
  const [competitiveExams, skillCategories, specializations] = await Promise.all([
    prisma.competitiveExam.findMany({ where, orderBy: { name: "asc" } }),
    prisma.skillCategory.findMany({ where, orderBy: { name: "asc" } }),
    prisma.specialization.findMany({ where: { ...where, legacyReviewStatus: MasterReviewStatus.CONFIRMED }, orderBy: { name: "asc" } }),
  ]);
  res.json({ data: { competitiveExams, skillCategories, specializations } });
});

router.post("/education-masters/competitive-exams", async (req: AuthRequest, res) => {
  const input = masterInput.parse(req.body);
  try { const data = await prisma.competitiveExam.create({ data: { ...input, organizationId: req.auth!.organizationId } }); await audit(req, "CREATE", "CompetitiveExam", data.id, input); res.status(201).json({ data }); }
  catch (error) { if (duplicate(error)) throw new AppError(409, "MASTER_DUPLICATE", "An exam with this name or code already exists"); throw error; }
});
router.patch("/education-masters/competitive-exams/:id", async (req: AuthRequest, res) => {
  const input = masterInput.partial().parse(req.body), examId = id.parse(req.params.id), existing = await prisma.competitiveExam.findUnique({ where: { id: examId }, select: { id: true } });
  if (!existing) throw new AppError(404, "MASTER_NOT_FOUND", "Competitive exam not found");
  if (input.status === MasterStatus.INACTIVE && await prisma.course.count({ where: { competitiveExamId: examId } })) throw new AppError(409, "MASTER_IN_USE", "Reclassify courses using this exam before deactivating it");
  try { const data = await prisma.competitiveExam.update({ where: { id: examId }, data: input }); await audit(req, "UPDATE", "CompetitiveExam", data.id, input); res.json({ data }); }
  catch (error) { if (duplicate(error)) throw new AppError(409, "MASTER_DUPLICATE", "An exam with this name or code already exists"); throw error; }
});

router.post("/education-masters/skill-categories", async (req: AuthRequest, res) => {
  const input = masterInput.extend({ parentId: id.nullable().optional() }).parse(req.body);
  if (input.parentId && !await prisma.skillCategory.findUnique({ where: { id: input.parentId }, select: { id: true } })) throw new AppError(422, "INVALID_PARENT", "Parent skill category must belong to this organization");
  try { const data = await prisma.skillCategory.create({ data: { ...input, organizationId: req.auth!.organizationId } }); await audit(req, "CREATE", "SkillCategory", data.id, input); res.status(201).json({ data }); }
  catch (error) { if (duplicate(error)) throw new AppError(409, "MASTER_DUPLICATE", "A skill category with this name or code already exists"); throw error; }
});
router.patch("/education-masters/skill-categories/:id", async (req: AuthRequest, res) => {
  const input = masterInput.partial().extend({ parentId: id.nullable().optional() }).parse(req.body), skillId = id.parse(req.params.id), existing = await prisma.skillCategory.findUnique({ where: { id: skillId }, select: { id: true } });
  if (!existing) throw new AppError(404, "MASTER_NOT_FOUND", "Skill category not found");
  if (input.parentId === skillId || input.parentId && !await prisma.skillCategory.findUnique({ where: { id: input.parentId }, select: { id: true } })) throw new AppError(422, "INVALID_PARENT", "Select another skill category in this organization");
  if (input.status === MasterStatus.INACTIVE && await prisma.course.count({ where: { skillCategoryId: skillId } })) throw new AppError(409, "MASTER_IN_USE", "Reclassify courses using this skill category before deactivating it");
  try { const data = await prisma.skillCategory.update({ where: { id: skillId }, data: input }); await audit(req, "UPDATE", "SkillCategory", data.id, input); res.json({ data }); }
  catch (error) { if (duplicate(error)) throw new AppError(409, "MASTER_DUPLICATE", "A skill category with this name or code already exists"); throw error; }
});

router.post("/education-masters/specializations", async (req: AuthRequest, res) => {
  const input = masterInput.extend({ description: z.string().trim().max(2000).nullable().optional() }).parse(req.body);
  try { const data = await prisma.specialization.create({ data: { ...input, organizationId: req.auth!.organizationId, legacyReviewStatus: MasterReviewStatus.CONFIRMED } }); await audit(req, "CREATE", "Specialization", data.id, input); res.status(201).json({ data }); }
  catch (error) { if (duplicate(error)) throw new AppError(409, "MASTER_DUPLICATE", "A specialization with this name or code already exists"); throw error; }
});
router.patch("/education-masters/specializations/:id", async (req: AuthRequest, res) => {
  const input = masterInput.partial().extend({ description: z.string().trim().max(2000).nullable().optional(), legacyReviewStatus: z.nativeEnum(MasterReviewStatus).optional() }).parse(req.body), specializationId = id.parse(req.params.id), existing = await prisma.specialization.findUnique({ where: { id: specializationId }, select: { id: true } });
  if (!existing) throw new AppError(404, "MASTER_NOT_FOUND", "Specialization not found");
  try { const data = await prisma.specialization.update({ where: { id: specializationId }, data: input }); await audit(req, "UPDATE", "Specialization", data.id, input); res.json({ data }); }
  catch (error) { if (duplicate(error)) throw new AppError(409, "MASTER_DUPLICATE", "A specialization with this name or code already exists"); throw error; }
});

export default router;
