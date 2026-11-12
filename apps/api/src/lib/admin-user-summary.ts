import { Role } from "@prisma/client";

type BranchSummary = { id: string; branchCode: string; branchName: string };

/**
 * A user may legitimately have records in several branches: shared teachers
 * and parents with children at different campuses. The users-list query
 * authorizes the top-level user, not the nested relations. Never serialize
 * unfiltered nested branch data to a BRANCH_ADMIN.
 */
export function summarizeAdminUser(user: any, visibleBranchIds: readonly string[] | null = null) {
  const visible = visibleBranchIds === null ? null : new Set(visibleBranchIds);
  const inScope = (branch: any) => visible === null || (Boolean(branch?.id) && visible.has(branch.id));

  const scoped = visible === null ? user : {
    ...user,
    branchAssignments: (Array.isArray(user.branchAssignments) ? user.branchAssignments : [])
      .filter((item: any) => inScope(item?.branch)),
    studentProfile: user.studentProfile && inScope(user.studentProfile.branch) ? user.studentProfile : null,
    teacherProfile: user.teacherProfile && inScope(user.teacherProfile.branch) ? user.teacherProfile : null,
    employee: user.employee && inScope(user.employee.branch) ? user.employee : null,
    parentChildren: (Array.isArray(user.parentChildren) ? user.parentChildren : [])
      .filter((item: any) => inScope(item?.student?.branch)),
  };

  const branchCandidates = [
    ...(Array.isArray(scoped.branchAssignments) ? scoped.branchAssignments.map((item: any) => item?.branch) : []),
    scoped.studentProfile?.branch,
    scoped.teacherProfile?.branch,
    scoped.employee?.branch,
    ...(Array.isArray(scoped.parentChildren) ? scoped.parentChildren.map((item: any) => item?.student?.branch) : []),
  ].filter((branch): branch is BranchSummary => Boolean(branch?.id) && inScope(branch));

  const branches = [...new Map(branchCandidates.map(branch => [branch.id, branch])).values()];
  const parentChildren = scoped.role === Role.PARENT && Array.isArray(scoped.parentChildren)
    ? scoped.parentChildren.flatMap((item: any) => {
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
    ...scoped,
    branches,
    // Linked role is safe identity metadata even if a cross-branch profile's
    // details are hidden in the above scoped response.
    linkedProfile: user.studentProfile ? "STUDENT" : user.teacherProfile ? "TEACHER" : user.employee ? "EMPLOYEE" : user.role === Role.PARENT ? "PARENT" : null,
    parentChildren,
  };
}
