import { Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();

router.use(requireAuth);
router.use("/examinations/:id", async (req: AuthRequest, _res, next) => {
  if (req.auth!.role !== Role.BRANCH_ADMIN) return next();

  const id = z.string().cuid().safeParse(req.params.id);
  if (!id.success) return next();

  const examination = await prisma.examination.findUnique({
    where: { id: id.data },
    select: { branchId: true },
  });
  if (!examination) return next();

  const access = await prisma.branchUser.findFirst({
    where: { userId: req.auth!.userId, branchId: examination.branchId },
    select: { branchId: true },
  });
  if (!access) throw new AppError(403, "BRANCH_FORBIDDEN", "Branch access denied");
  next();
});

export default router;
