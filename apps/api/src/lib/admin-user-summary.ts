import { Role } from "@prisma/client";

type BranchSummary = { id: string; branchCode: string; branchName: string };

export function summarizeAdminUser(user: any) {
  const branchCandidates = [
    ...(Array.isArray(user.branchAssignments) ? user.branchAssignments.map((item: any) => item?.branch) : []),
    user.studentProfile?.branch,
    user.teacherProfile?.branch,
    user.employee?.branch,
    ...(Array.isArray(user.parentChildren) ? user.parentChildren.map((item: any) => item?.student?.branch) : []),
  ].filter((branch): branch is BranchSummary => Boolean(branch?.id));

  const branches = [...new Map(branchCandidates.map(branch => [branch.id, branch])).values()];
  const parentChildren = user.role === Role.PARENT && Array.isArray(user.parentChildren)
    ? user.parentChildren.flatMap((item: any) => {
      const student = item?.student;
      if (!student?.id) return [];
      return [{
        id: student.id,
        name: student.user?.name ?? "Unknown student",
        admissionNo: student.admissionNo ?? "—",
        relationship: item.relationship ?? "Parent",
        status: student.status ?? null,
        branch: student.branch?.branchName ?? "Unassigned",
        batch: student.batch?.name ?? null,
        course: student.batch?.course?.title ?? null,
      }];
    })
    : [];

  return {
    ...user,
    branches,
    linkedProfile: user.studentProfile ? "STUDENT" : user.teacherProfile ? "TEACHER" : user.employee ? "EMPLOYEE" : user.role === Role.PARENT ? "PARENT" : null,
    parentChildren,
  };
}
