import {
  BatchStatus,
  Role,
  StudentStatus,
  TeacherAllocationStatus,
} from "@prisma/client";
import type { AuthRequest } from "../middleware/auth.js";
import { AppError } from "./http.js";
import { prisma } from "./prisma.js";

export type LearningContext = {
  branchId: string;
  courseId: string;
  batchId: string;
  subjectId?: string;
};

export type LearningLearner = LearningContext & {
  profileId: string;
  userId: string;
};

export type LearningActor = {
  role: Role;
  userId: string;
  branchIds: string[];
  courseIds: string[];
  teacherProfileId?: string;
  allocations: LearningContext[];
  learners: LearningLearner[];
};

export type LearningResource = {
  branchId?: string | null;
  courseId: string;
  batchId?: string | null;
  subjectId?: string | null;
  teacherId?: string | null;
  status?: string;
};

const denied = () => new AppError(403, "LEARNING_FORBIDDEN", "Learning content is not available to this account");

export function assertAcademicLearningRole(role: Role) {
  const academicRoles: Role[] = [Role.SUPER_ADMIN, Role.BRANCH_ADMIN, Role.TEACHER, Role.STUDENT, Role.PARENT];
  if (!academicRoles.includes(role)) throw denied();
}

export async function learningActorForRequest(req: AuthRequest): Promise<LearningActor> {
  const role = req.auth!.role;
  const userId = req.auth!.userId;
  assertAcademicLearningRole(role);

  if (role === Role.BRANCH_ADMIN) {
    const branches = await prisma.branchUser.findMany({ where: { userId }, select: { branchId: true } });
    const branchIds = branches.map(row => row.branchId);
    const courses = branchIds.length
      ? await prisma.course.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } })
      : [];
    return { role, userId, branchIds, courseIds: courses.map(row => row.id), allocations: [], learners: [] };
  }

  if (role === Role.TEACHER) {
    const teacher = await prisma.teacherProfile.findUnique({ where: { userId }, select: { id: true, branchId: true } });
    const allocations = teacher ? await prisma.teacherAllocation.findMany({
      where: {
        teacherId: teacher.id,
        status: TeacherAllocationStatus.ACTIVE,
        effectiveFrom: { lte: new Date() },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
      },
      select: { branchId: true, courseId: true, batchId: true, subjectId: true },
    }) : [];
    return {
      role,
      userId,
      branchIds: [...new Set(allocations.map(row => row.branchId))],
      courseIds: [...new Set(allocations.map(row => row.courseId))],
      teacherProfileId: teacher?.id,
      allocations,
      learners: [],
    };
  }

  if (role === Role.STUDENT) {
    const student = await prisma.studentProfile.findUnique({
      where: { userId },
      select: {
        id: true,
        userId: true,
        branchId: true,
        batchId: true,
        status: true,
        batch: { select: { status: true, courseId: true } },
      },
    });
    const learners = student?.status === StudentStatus.ACTIVE
      && student.batch.status === BatchStatus.ACTIVE
      && student.batch.courseId
      ? [{ profileId: student.id, userId: student.userId, branchId: student.branchId, batchId: student.batchId, courseId: student.batch.courseId }]
      : [];
    return { role, userId, branchIds: learners.map(row => row.branchId), courseIds: learners.map(row => row.courseId), allocations: [], learners };
  }

  if (role === Role.PARENT) {
    const links = await prisma.parentStudent.findMany({
      where: {
        parentId: userId,
        student: {
          status: StudentStatus.ACTIVE,
          user: { isActive: true },
          batch: { status: BatchStatus.ACTIVE },
        },
      },
      select: {
        student: {
          select: {
            id: true,
            userId: true,
            branchId: true,
            batchId: true,
            batch: { select: { courseId: true } },
          },
        },
      },
    });
    const learners = links.flatMap(({ student }) => student.batch.courseId
      ? [{ profileId: student.id, userId: student.userId, branchId: student.branchId, batchId: student.batchId, courseId: student.batch.courseId }]
      : []);
    return {
      role,
      userId,
      branchIds: [...new Set(learners.map(row => row.branchId))],
      courseIds: [...new Set(learners.map(row => row.courseId))],
      allocations: [],
      learners,
    };
  }

  return { role, userId, branchIds: [], courseIds: [], allocations: [], learners: [] };
}

function allocationClause(context: LearningContext): Record<string, any> {
  return {
    branchId: context.branchId,
    courseId: context.courseId,
    AND: [
      { OR: [{ batchId: null }, { batchId: context.batchId }] },
      { OR: [{ subjectId: null }, { subjectId: context.subjectId }] },
    ],
  };
}

function learnerClause(context: LearningLearner): Record<string, any> {
  return {
    status: "PUBLISHED",
    courseId: context.courseId,
    AND: [
      { OR: [{ branchId: null }, { branchId: context.branchId }] },
      { OR: [{ batchId: null }, { batchId: context.batchId }] },
    ],
  };
}

export function learningResourceWhere(actor: LearningActor, options: { teacherOwned?: boolean } = {}): Record<string, any> {
  if (actor.role === Role.SUPER_ADMIN) return {};
  if (actor.role === Role.BRANCH_ADMIN) return { branchId: { in: actor.branchIds } };
  if (actor.role === Role.TEACHER) return {
    ...(options.teacherOwned ? { teacherId: actor.teacherProfileId ?? { in: [] as string[] } } : {}),
    OR: actor.allocations.map(allocationClause),
  };
  if (actor.role === Role.STUDENT || actor.role === Role.PARENT) return { OR: actor.learners.map(learnerClause) };
  throw denied();
}

export function learningQuestionWhere(actor: LearningActor): Record<string, any> {
  if (actor.role === Role.SUPER_ADMIN) return {};
  if (actor.role === Role.BRANCH_ADMIN) return { courseId: { in: actor.courseIds } };
  if (actor.role === Role.TEACHER) return {
    OR: actor.allocations.map(context => ({ courseId: context.courseId, subjectId: context.subjectId })),
  };
  throw denied();
}

export function learningDoubtWhere(actor: LearningActor): Record<string, any> {
  if (actor.role === Role.SUPER_ADMIN) return {};
  if (actor.role === Role.BRANCH_ADMIN) return {
    student: { studentProfile: { is: { branchId: { in: actor.branchIds }, status: StudentStatus.ACTIVE } } },
  };
  if (actor.role === Role.TEACHER) return {
    OR: [
      { assignedTeacherId: actor.userId },
      ...actor.allocations.map(context => ({
        subjectId: context.subjectId,
        student: { studentProfile: { is: { batchId: context.batchId, status: StudentStatus.ACTIVE } } },
      })),
    ],
  };
  if (actor.role === Role.STUDENT) return { studentId: actor.userId };
  throw denied();
}

export function assertManagerResourceAccess(actor: LearningActor, target: LearningResource, options: { teacherOwned?: boolean } = {}) {
  if (actor.role === Role.SUPER_ADMIN) return;
  if (actor.role === Role.BRANCH_ADMIN && target.branchId && actor.branchIds.includes(target.branchId)) return;
  if (actor.role === Role.TEACHER
    && (!options.teacherOwned || Boolean(actor.teacherProfileId) && target.teacherId === actor.teacherProfileId)
    && target.branchId
    && target.batchId
    && target.subjectId
    && actor.allocations.some(context => context.branchId === target.branchId
      && context.courseId === target.courseId
      && context.batchId === target.batchId
      && context.subjectId === target.subjectId)) return;
  throw denied();
}

export function assertManagerQuestionAccess(actor: LearningActor, target: { courseId?: string | null; subjectId: string }) {
  if (actor.role === Role.SUPER_ADMIN) return;
  if (actor.role === Role.BRANCH_ADMIN && target.courseId && actor.courseIds.includes(target.courseId)) return;
  if (actor.role === Role.TEACHER && target.courseId && actor.allocations.some(context => context.courseId === target.courseId && context.subjectId === target.subjectId)) return;
  throw denied();
}

export function assertLearnerContentAccess(actor: LearningActor, target: LearningResource) {
  if ((actor.role === Role.STUDENT || actor.role === Role.PARENT)
    && target.status === "PUBLISHED"
    && actor.learners.some(context => context.courseId === target.courseId
      && (!target.branchId || context.branchId === target.branchId)
      && (!target.batchId || context.batchId === target.batchId))) return;
  throw denied();
}

export async function assertStudentTargetAccess(actor: LearningActor, studentUserId: string) {
  if (actor.role === Role.STUDENT && actor.userId === studentUserId && actor.learners.length) return;
  if (actor.role === Role.PARENT && actor.learners.some(row => row.userId === studentUserId)) return;
  if (actor.role === Role.SUPER_ADMIN) {
    const student = await prisma.studentProfile.findFirst({ where: { userId: studentUserId, status: StudentStatus.ACTIVE }, select: { id: true } });
    if (student) return;
    throw denied();
  }
  const student = await prisma.studentProfile.findFirst({
    where: { userId: studentUserId, status: StudentStatus.ACTIVE, batch: { status: BatchStatus.ACTIVE } },
    select: { branchId: true, batchId: true },
  });
  if (actor.role === Role.BRANCH_ADMIN && student && actor.branchIds.includes(student.branchId)) return;
  if (actor.role === Role.TEACHER && student && actor.allocations.some(row => row.batchId === student.batchId)) return;
  throw denied();
}

export function learningAttemptStudentWhere(actor: LearningActor): Record<string, any> {
  if (actor.role === Role.STUDENT) return { studentId: actor.userId };
  if (actor.role === Role.PARENT) return { studentId: { in: actor.learners.map(row => row.userId) } };
  if (actor.role === Role.BRANCH_ADMIN) return { student: { studentProfile: { is: { branchId: { in: actor.branchIds } } } } };
  if (actor.role === Role.TEACHER) return { student: { studentProfile: { is: { batchId: { in: [...new Set(actor.allocations.map(row => row.batchId))] } } } } };
  if (actor.role === Role.SUPER_ADMIN) return {};
  throw denied();
}

export async function assertStudentHasSubject(actor: LearningActor, courseId: string, subjectId: string) {
  if (actor.role !== Role.STUDENT || !actor.learners.some(row => row.courseId === courseId)) throw denied();
  const relation = await prisma.courseSubject.findFirst({ where: { courseId, subjectId, isActive: true }, select: { courseId: true } });
  if (!relation) throw denied();
}

export { denied as learningDenied };
