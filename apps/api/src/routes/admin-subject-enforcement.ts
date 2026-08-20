import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { effectiveDateForSession, requireAllocatedSubject } from "../lib/subject-resolution.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

const allocationInput = z.object({
  branchId: z.string().cuid(),
  courseId: z.string().cuid(),
  batchId: z.string().cuid(),
  teacherId: z.string().cuid(),
  subjectId: z.string().cuid(),
  effectiveAt: z.coerce.date().optional(),
});

type Resource = "timetable" | "homework" | "examination";

function resourceFor(path: string, method: string): Resource | null {
  if (method === "POST" && path === "/timetables") return "timetable";
  if (method === "POST" && path === "/homeworks") return "homework";
  if (method === "POST" && path === "/examinations") return "examination";
  if (method !== "PATCH") return null;
  if (/^\/timetables\/[^/]+$/.test(path)) return "timetable";
  if (/^\/homeworks\/[^/]+$/.test(path)) return "homework";
  if (/^\/examinations\/[^/]+$/.test(path)) return "examination";
  return null;
}

router.use(async (req: AuthRequest, _res, next) => {
  const resource = resourceFor(req.path, req.method);
  if (!resource) return next();

  let existing: Record<string, unknown> = {};
  if (req.method === "PATCH") {
    const id = req.path.split("/")[2];
    const select = { branchId: true, courseId: true, batchId: true, teacherId: true, subjectId: true } as const;
    existing = resource === "timetable"
      ? await prisma.timetable.findUnique({ where: { id }, select }) ?? {}
      : resource === "homework"
        ? await prisma.homework.findUnique({ where: { id }, select: { ...select, assignedDate: true } }) ?? {}
        : await prisma.examination.findUnique({ where: { id }, select: { ...select, examDate: true } }) ?? {};
    if (!Object.keys(existing).length) return next();
  }

  const body = { ...existing, ...req.body } as Record<string, unknown>;
  const parsed = allocationInput.parse({
    ...body,
    effectiveAt: resource === "homework" ? body.assignedDate : resource === "examination" ? body.examDate : undefined,
  });
  const batch = await prisma.batch.findUnique({
    where: { id: parsed.batchId },
    select: { branchId: true, courseId: true, academicSessionId: true, session: { select: { startsAt: true, endsAt: true } } },
  });
  if (!batch || batch.branchId !== parsed.branchId || batch.courseId !== parsed.courseId) {
    throw new AppError(422, "INVALID_BATCH_CONTEXT", "Batch must match the selected branch and course");
  }
  await requireAllocatedSubject({
    ...parsed,
    academicSessionId: batch.academicSessionId,
    ...(resource === "timetable" ? { effectiveAt: effectiveDateForSession(batch.session.startsAt, batch.session.endsAt) } : {}),
  });
  next();
});

export default router;
