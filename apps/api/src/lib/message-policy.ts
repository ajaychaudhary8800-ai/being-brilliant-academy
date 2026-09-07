import { Role } from "@prisma/client";
import { activeTeacherBatchIds } from "./communication-authorization.js";
import { AppError } from "./http.js";
import { prisma } from "./prisma.js";

export type MessageParticipant = {
  id: string;
  organizationId: string;
  role: Role;
  isActive: boolean;
  teacherId: string | null;
  studentBatchId: string | null;
  childBatchIds: string[];
  branchIds?: string[];
};

export type MessageAuthorizationStore = {
  participant: (userId: string) => Promise<MessageParticipant | null>;
  teacherBatchIds: (teacherId: string) => Promise<string[]>;
};

const portalRoles: Role[] = [Role.PARENT, Role.STUDENT, Role.TEACHER];
const administratorRoles: Role[] = [Role.SUPER_ADMIN, Role.BRANCH_ADMIN];

const participant = async (userId: string): Promise<MessageParticipant | null> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      organizationId: true,
      role: true,
      isActive: true,
      branchAssignments: { select: { branchId: true } },
      teacherProfile: { select: { id: true, branchId: true } },
      studentProfile: { select: { batchId: true, branchId: true, status: true } },
      employee: { select: { branchId: true } },
      parentChildren: { select: { student: { select: { batchId: true, branchId: true, status: true, user: { select: { isActive: true } } } } } },
    },
  });
  if (!user) return null;
  const activeChildren = user.parentChildren.filter(link => link.student.status === "ACTIVE" && link.student.user.isActive);
  return {
    id: user.id,
    organizationId: user.organizationId,
    role: user.role,
    isActive: user.isActive,
    teacherId: user.teacherProfile?.id ?? null,
    studentBatchId: user.studentProfile?.status === "ACTIVE" ? user.studentProfile.batchId : null,
    childBatchIds: [...new Set(activeChildren.map(link => link.student.batchId))],
    branchIds: [...new Set([
      ...user.branchAssignments.map(item => item.branchId),
      ...(user.teacherProfile ? [user.teacherProfile.branchId] : []),
      ...(user.studentProfile?.status === "ACTIVE" ? [user.studentProfile.branchId] : []),
      ...(user.employee ? [user.employee.branchId] : []),
      ...activeChildren.map(link => link.student.branchId),
    ])],
  };
};

const defaultStore: MessageAuthorizationStore = { participant, teacherBatchIds: activeTeacherBatchIds };
const unavailableRecipient = () => new AppError(404, "RECIPIENT_NOT_AVAILABLE", "Recipient is not available");
const shares = (left: readonly string[], right: readonly string[]) => {
  const values = new Set(left);
  return right.some(value => values.has(value));
};

async function authorizeRecipient(
  sender: { userId: string; role: Role; organizationId: string },
  senderProfile: MessageParticipant | null,
  recipientId: string,
  store: MessageAuthorizationStore = defaultStore,
) {
  const recipient = await store.participant(recipientId);
  if (!senderProfile
    || !recipient
    || senderProfile.id === recipient.id
    || senderProfile.organizationId !== sender.organizationId
    || recipient.organizationId !== sender.organizationId
    || senderProfile.role !== sender.role
    || !senderProfile.isActive
    || !recipient.isActive) throw unavailableRecipient();

  if (sender.role === Role.SUPER_ADMIN) return recipient;
  if (sender.role === Role.BRANCH_ADMIN) {
    if (senderProfile.branchIds?.length && shares(senderProfile.branchIds, recipient.branchIds ?? [])) return recipient;
    throw unavailableRecipient();
  }
  if (!portalRoles.includes(sender.role) || !portalRoles.includes(recipient.role)) throw unavailableRecipient();

  let permitted = false;
  if (sender.role === Role.TEACHER && senderProfile.teacherId) {
    const batchIds = await store.teacherBatchIds(senderProfile.teacherId);
    permitted = recipient.role === Role.STUDENT
      ? Boolean(recipient.studentBatchId && batchIds.includes(recipient.studentBatchId))
      : recipient.role === Role.PARENT && shares(batchIds, recipient.childBatchIds);
  } else if (sender.role === Role.STUDENT && senderProfile.studentBatchId && recipient.role === Role.TEACHER && recipient.teacherId) {
    permitted = (await store.teacherBatchIds(recipient.teacherId)).includes(senderProfile.studentBatchId);
  } else if (sender.role === Role.PARENT && senderProfile.childBatchIds.length && recipient.role === Role.TEACHER && recipient.teacherId) {
    permitted = shares(senderProfile.childBatchIds, await store.teacherBatchIds(recipient.teacherId));
  }
  if (!permitted) throw unavailableRecipient();
  return recipient;
}

export async function assertMessageRecipientAuthorized(
  sender: { userId: string; role: Role; organizationId: string },
  recipientId: string,
  store: MessageAuthorizationStore = defaultStore,
) {
  return authorizeRecipient(sender, await store.participant(sender.userId), recipientId, store);
}

export async function assertMessageRecipientsAuthorized(
  sender: { userId: string; role: Role; organizationId: string },
  recipientIds: readonly string[],
  store: MessageAuthorizationStore = defaultStore,
) {
  const senderProfile = await store.participant(sender.userId);
  return Promise.all([...new Set(recipientIds)].map(recipientId => authorizeRecipient(sender, senderProfile, recipientId, store)));
}

export function assertThreadMember(member: { userId: string } | null, thread: { isArchived: boolean; deletedAt: Date | null } | null) {
  if (!member || !thread || thread.isArchived || thread.deletedAt) throw new AppError(404, "THREAD_NOT_FOUND", "Thread not found");
}

export { administratorRoles, portalRoles };
