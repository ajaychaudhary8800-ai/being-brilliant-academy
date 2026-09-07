import { Role } from "@prisma/client";
import { AppError } from "./http.js";

export type ManagedUser = {
  id: string;
  role: Role;
  isActive: boolean;
  branchIds: readonly string[];
  hasStudentProfile: boolean;
  hasTeacherProfile: boolean;
  hasEmployeeProfile: boolean;
  hasParentLinks: boolean;
};

export type UserAdministrator = {
  id: string;
  role: Role;
  branchIds: readonly string[];
};

const branchAdministratorAssignableRoles = new Set<Role>([Role.STUDENT, Role.TEACHER, Role.PARENT, Role.EMPLOYEE]);

function assertCompatibleProfile(target: ManagedUser, role: Role) {
  const compatible = role === Role.STUDENT ? target.hasStudentProfile
    : role === Role.TEACHER ? target.hasTeacherProfile
      : role === Role.EMPLOYEE ? target.hasEmployeeProfile
        : role === Role.PARENT ? target.hasParentLinks
          : true;
  if (!compatible) throw new AppError(409, "ROLE_PROFILE_CONFLICT", "The user does not have the profile required for that role");
}

export function assertCanChangeUserRole(
  actor: UserAdministrator,
  target: ManagedUser,
  nextRole: Role,
  activeSuperAdministratorCount: number,
) {
  if (!target.isActive) throw new AppError(409, "INACTIVE_USER_ROLE_LOCKED", "Activate the user before changing their role");
  if (target.role === nextRole) return;

  if (actor.role === Role.BRANCH_ADMIN) {
    if (actor.id === target.id) throw new AppError(403, "SELF_PRIVILEGE_CHANGE_FORBIDDEN", "Branch administrators cannot change their own role");
    if (!branchAdministratorAssignableRoles.has(nextRole)) throw new AppError(403, "ROLE_GRANT_FORBIDDEN", "Branch administrators cannot grant administrator roles");
    if (target.role === Role.SUPER_ADMIN || target.role === Role.BRANCH_ADMIN) throw new AppError(403, "ADMIN_ROLE_CHANGE_FORBIDDEN", "Branch administrators cannot modify administrator accounts");
    if (!target.branchIds.length || target.branchIds.some(branchId => !actor.branchIds.includes(branchId))) {
      throw new AppError(403, "USER_BRANCH_FORBIDDEN", "The user is outside your assigned branch scope");
    }
  } else if (actor.role !== Role.SUPER_ADMIN) {
    throw new AppError(403, "USER_ADMIN_REQUIRED", "User administrator access is required");
  }

  if (target.role === Role.SUPER_ADMIN && nextRole !== Role.SUPER_ADMIN && activeSuperAdministratorCount <= 1) {
    throw new AppError(409, "LAST_SUPER_ADMIN_PROTECTED", "The last active Super Administrator cannot be demoted");
  }
  assertCompatibleProfile(target, nextRole);
}

export function managedUserBranchIds(target: {
  branchAssignments: readonly { branchId: string }[];
  studentProfile: { branchId: string } | null;
  teacherProfile: { branchId: string } | null;
  employee: { branchId: string } | null;
  parentChildren: readonly { student: { branchId: string } }[];
}) {
  return [...new Set([
    ...target.branchAssignments.map(item => item.branchId),
    ...(target.studentProfile ? [target.studentProfile.branchId] : []),
    ...(target.teacherProfile ? [target.teacherProfile.branchId] : []),
    ...(target.employee ? [target.employee.branchId] : []),
    ...target.parentChildren.map(item => item.student.branchId),
  ])];
}
