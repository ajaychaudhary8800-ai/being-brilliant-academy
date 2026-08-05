import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
const router = Router(); router.use(requireAuth);
router.get("/me", async (req: AuthRequest, res) => { const enrollments = await prisma.enrollment.findMany({ where: { userId: req.auth!.userId }, include: { course: { include: { instructor: { select: { name: true } } } } }, orderBy: { enrolledAt: "desc" } }); res.json({ data: enrollments }); });
router.patch("/lessons/:lessonId/progress", async (req: AuthRequest, res) => { const input = z.object({ watchedSeconds: z.number().int().nonnegative(), completed: z.boolean().optional() }).parse(req.body); const lessonId = String(req.params.lessonId); const progress = await prisma.lessonProgress.upsert({ where: { userId_lessonId: { userId: req.auth!.userId, lessonId } }, update: input, create: { userId: req.auth!.userId, lessonId, ...input } }); res.json({ data: progress }); });
export default router;
