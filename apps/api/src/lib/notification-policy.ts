import type { Prisma } from "@prisma/client";

export function notificationLifecycleConstraints(now = new Date(), isArchived = false): Prisma.NotificationWhereInput {
  return {
    deletedAt: null,
    isArchived,
    AND: [
      { OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }] },
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    ],
  };
}

export function activeNotificationConstraints(now = new Date()): Prisma.NotificationWhereInput {
  return notificationLifecycleConstraints(now, false);
}

export function notificationIsActive(
  notification: { scheduledAt: Date | null; expiresAt: Date | null; isArchived: boolean; deletedAt: Date | null },
  now = new Date(),
) {
  return !notification.deletedAt
    && !notification.isArchived
    && (!notification.scheduledAt || notification.scheduledAt <= now)
    && (!notification.expiresAt || notification.expiresAt > now);
}
