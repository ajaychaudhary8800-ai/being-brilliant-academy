import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
const router = Router(); router.use(requireAuth);
router.get("/me", async (req: AuthRequest, res) => { const enrollments = await prisma.enrollment.findMany({ where: { userId: req.auth!.userId }, include: { course: { include: { instructor: { select: { name: true } } } } }, orderBy: { enrolledAt: "desc" } }); res.json({ data: enrollments }); });
export default router;
