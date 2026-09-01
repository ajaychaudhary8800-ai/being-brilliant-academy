import type { Prisma, PrismaClient } from "@prisma/client";

type DependencyClient = PrismaClient | Prisma.TransactionClient;

export const subjectDependencyLabels = {
  courses: "course mappings",
  teachers: "teacher mappings",
  teacherAllocations: "teacher allocations",
  timetables: "timetable entries",
  homeworks: "homework records",
  examinations: "examinations",
  substitutions: "teacher substitutions",
  tests: "tests",
  lessons: "LMS lessons",
  doubtThreads: "doubt threads",
  questionBankItems: "question-bank items",
  learningTests: "learning tests",
  studyMaterials: "study materials",
  liveClasses: "live classes",
} as const;

export type SubjectDependencyKey = keyof typeof subjectDependencyLabels;
export type SubjectDependencyCounts = Record<SubjectDependencyKey, number>;

export async function countSubjectDependencies(client: DependencyClient, organizationId: string, subjectId: string): Promise<SubjectDependencyCounts> {
  const where = { organizationId, subjectId };
  const [courses, teachers, teacherAllocations, timetables, homeworks, examinations, substitutions, tests, lessons, doubtThreads, questionBankItems, learningTests, studyMaterials, liveClasses] = await Promise.all([
    client.courseSubject.count({ where }),
    client.teacherSubject.count({ where }),
    client.teacherAllocation.count({ where }),
    client.timetable.count({ where }),
    client.homework.count({ where }),
    client.examination.count({ where }),
    client.teacherSubstitution.count({ where }),
    client.test.count({ where }),
    client.lesson.count({ where }),
    client.doubtThread.count({ where }),
    client.questionBankItem.count({ where }),
    client.learningTest.count({ where }),
    client.studyMaterial.count({ where }),
    client.liveClass.count({ where }),
  ]);
  return { courses, teachers, teacherAllocations, timetables, homeworks, examinations, substitutions, tests, lessons, doubtThreads, questionBankItems, learningTests, studyMaterials, liveClasses };
}

export function usedSubjectDependencies(counts: SubjectDependencyCounts) {
  return (Object.entries(counts) as Array<[SubjectDependencyKey, number]>).filter(([, count]) => count > 0);
}

export function describeSubjectDependencies(counts: SubjectDependencyCounts) {
  return usedSubjectDependencies(counts).map(([key, count]) => `${count} ${subjectDependencyLabels[key]}`).join(", ");
}

const operationalDependencyKeys: SubjectDependencyKey[] = [
  "teacherAllocations", "timetables", "homeworks", "examinations", "substitutions", "tests", "lessons",
  "doubtThreads", "questionBankItems", "learningTests", "studyMaterials", "liveClasses",
];

export async function buildSubjectMergePlan(client: DependencyClient, organizationId: string, sourceSubjectId: string, replacementSubjectId: string) {
  const [dependencies, sourceCourses, replacementCourses, sourceTeachers, replacementTeachers] = await Promise.all([
    countSubjectDependencies(client, organizationId, sourceSubjectId),
    client.courseSubject.findMany({ where: { organizationId, subjectId: sourceSubjectId }, select: { courseId: true } }),
    client.courseSubject.findMany({ where: { organizationId, subjectId: replacementSubjectId, isActive: true }, select: { courseId: true } }),
    client.teacherSubject.findMany({ where: { organizationId, subjectId: sourceSubjectId }, select: { teacherId: true } }),
    client.teacherSubject.findMany({ where: { organizationId, subjectId: replacementSubjectId }, select: { teacherId: true } }),
  ]);
  const replacementCourseIds = new Set(replacementCourses.map(row => row.courseId));
  const replacementTeacherIds = new Set(replacementTeachers.map(row => row.teacherId));
  const duplicateCourseIds = sourceCourses.filter(row => replacementCourseIds.has(row.courseId)).map(row => row.courseId);
  const duplicateTeacherIds = sourceTeachers.filter(row => replacementTeacherIds.has(row.teacherId)).map(row => row.teacherId);
  const unmatchedCourseIds = sourceCourses.filter(row => !replacementCourseIds.has(row.courseId)).map(row => row.courseId);
  const unmatchedTeacherIds = sourceTeachers.filter(row => !replacementTeacherIds.has(row.teacherId)).map(row => row.teacherId);
  const blockingDependencies = operationalDependencyKeys.filter(key => dependencies[key] > 0).map(key => ({ key, label: subjectDependencyLabels[key], count: dependencies[key] }));
  return {
    dependencies,
    duplicateCourseIds,
    duplicateTeacherIds,
    unmatchedCourseIds,
    unmatchedTeacherIds,
    blockingDependencies,
    canMerge: !blockingDependencies.length && !unmatchedCourseIds.length && !unmatchedTeacherIds.length,
  };
}
