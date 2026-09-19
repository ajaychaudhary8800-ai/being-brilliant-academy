import type { Prisma } from "@prisma/client";

export const announcementListFields = {
  id: true,
  title: true,
  body: true,
  branchId: true,
  audience: true,
  authorId: true,
  isArchived: true,
  publishedAt: true,
  createdAt: true,
  batchId: true,
  className: true,
  priority: true,
  scheduledAt: true,
  expiresAt: true,
  attachmentName: true,
  attachmentMime: true,
  deletedAt: true,
  kind: true,
  category: true,
  isPinned: true,
  requiresAcknowledgement: true,
} satisfies Prisma.AnnouncementSelect;

export const messageListFields = {
  id: true,
  senderId: true,
  recipientId: true,
  subject: true,
  body: true,
  readAt: true,
  senderArchived: true,
  recipientArchived: true,
  createdAt: true,
  threadId: true,
  attachmentName: true,
  attachmentMime: true,
  deletedAt: true,
} satisfies Prisma.PortalMessageSelect;

export const circularVersionListFields = {
  id: true,
  circularId: true,
  version: true,
  body: true,
  attachmentName: true,
  attachmentMime: true,
  createdAt: true,
} satisfies Prisma.CircularVersionSelect;
