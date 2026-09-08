import { Prisma, Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import {
  announcementRecipientConstraints,
  branchManagementConstraints,
  circularRecipientConstraints,
  communicationScope,
  eventRecipientConstraints,
  validateCommunicationTarget,
} from "../lib/communication-authorization.js";
import { AppError } from "../lib/http.js";
import { assertMessageRecipientAuthorized, assertMessageRecipientsAuthorized, assertThreadMember } from "../lib/message-policy.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);
const admins: Role[] = [Role.SUPER_ADMIN, Role.BRANCH_ADMIN];
const staff: Role[] = [...admins, Role.TEACHER];
const id = z.string().cuid();
const page = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(100).optional(),
  archived: z.enum(["true", "false"]).optional(),
});
const userId = (req: AuthRequest) => req.auth!.userId;
const sender = (req: AuthRequest) => ({ userId: userId(req), role: req.auth!.role, organizationId: req.auth!.organizationId });

function allow(req: AuthRequest, roles: readonly Role[]) {
  if (!roles.includes(req.auth!.role)) throw new AppError(403, "FORBIDDEN", "Communication permission denied");
}

function attachment(value: { name?: string; mimeType?: string; base64?: string }) {
  if (!value.base64) return {};
  const data = Buffer.from(value.base64, "base64");
  if (!data.length
    || data.length > 10 * 1024 * 1024
    || !value.name
    || !value.mimeType
    || ![/^application\/pdf$/, /^image\/(png|jpeg|webp)$/].some(pattern => pattern.test(value.mimeType!))) {
    throw new AppError(422, "INVALID_ATTACHMENT", "PDF or image attachment must be at most 10 MB");
  }
  return { attachmentName: value.name, attachmentMime: value.mimeType, attachmentData: data };
}

async function audit(req: AuthRequest, action: string, entity: string, entityId?: string, metadata?: unknown) {
  await prisma.auditLog.create({ data: { actorId: userId(req), action, entity, entityId, metadata: metadata as Prisma.InputJsonValue | undefined } });
}

async function managerAccess(req: AuthRequest) {
  const scope = await communicationScope(req);
  return { scope, access: admins.includes(req.auth!.role) ? branchManagementConstraints(scope) : null };
}

async function announcementAccess(req: AuthRequest) {
  const { scope, access } = await managerAccess(req);
  return access ?? announcementRecipientConstraints(scope);
}

async function circularAccess(req: AuthRequest) {
  const { scope, access } = await managerAccess(req);
  return access ?? circularRecipientConstraints(scope);
}

async function eventAccess(req: AuthRequest) {
  const { scope, access } = await managerAccess(req);
  return access ?? eventRecipientConstraints(scope);
}

async function requireAnnouncementManager(req: AuthRequest, announcementId: string) {
  allow(req, staff);
  const announcement = await prisma.announcement.findUnique({ where: { id: announcementId }, select: { id: true, authorId: true, branchId: true, batchId: true, scheduledAt: true, expiresAt: true } });
  if (!announcement) throw new AppError(404, "NOT_FOUND", "Announcement not found");
  if (req.auth!.role === Role.TEACHER) {
    const scope = await communicationScope(req);
    if (announcement.authorId !== userId(req) || !announcement.branchId || !scope.branchIds?.includes(announcement.branchId)) {
      throw new AppError(404, "NOT_FOUND", "Announcement not found");
    }
  } else if (req.auth!.role === Role.BRANCH_ADMIN) {
    const scope = await communicationScope(req);
    if (!announcement.branchId || !scope.branchIds?.includes(announcement.branchId)) throw new AppError(404, "NOT_FOUND", "Announcement not found");
  }
  return announcement;
}

async function requireCircularManager(req: AuthRequest, circularId: string) {
  allow(req, admins);
  const circular = await prisma.circular.findUnique({ where: { id: circularId } });
  if (!circular) throw new AppError(404, "NOT_FOUND", "Circular not found");
  if (req.auth!.role === Role.BRANCH_ADMIN) {
    const scope = await communicationScope(req);
    if (!circular.branchId || !scope.branchIds?.includes(circular.branchId)) throw new AppError(404, "NOT_FOUND", "Circular not found");
  }
  return circular;
}

async function requireEventManager(req: AuthRequest, eventId: string) {
  allow(req, admins);
  const eventRecord = await prisma.calendarEvent.findUnique({ where: { id: eventId } });
  if (!eventRecord) throw new AppError(404, "NOT_FOUND", "Event not found");
  if (req.auth!.role === Role.BRANCH_ADMIN) {
    const scope = await communicationScope(req);
    if (!eventRecord.branchId || !scope.branchIds?.includes(eventRecord.branchId)) throw new AppError(404, "NOT_FOUND", "Event not found");
  }
  return eventRecord;
}

async function assertAdministrativeRecipients(req: AuthRequest, requestedUserIds: readonly string[]) {
  allow(req, admins);
  const uniqueIds = [...new Set(requestedUserIds)];
  const scope = await communicationScope(req);
  const branchWhere: Prisma.UserWhereInput = req.auth!.role === Role.BRANCH_ADMIN ? {
    OR: [
      { branchAssignments: { some: { branchId: { in: scope.branchIds ?? [] } } } },
      { studentProfile: { branchId: { in: scope.branchIds ?? [] } } },
      { teacherProfile: { branchId: { in: scope.branchIds ?? [] } } },
      { employee: { branchId: { in: scope.branchIds ?? [] } } },
      { parentChildren: { some: { student: { branchId: { in: scope.branchIds ?? [] } } } } },
    ],
  } : {};
  const recipients = await prisma.user.findMany({ where: { id: { in: uniqueIds }, isActive: true, ...branchWhere }, select: { id: true } });
  if (recipients.length !== uniqueIds.length) throw new AppError(404, "RECIPIENT_NOT_AVAILABLE", "One or more recipients are not available");
  return uniqueIds;
}

router.get("/communication/dashboard", async (req: AuthRequest, res) => {
  allow(req, staff);
  const { scope, access } = await managerAccess(req);
  const announcementWhere = access ?? announcementRecipientConstraints(scope);
  const circularWhere = access ?? circularRecipientConstraints(scope);
  const eventWhere = access ?? eventRecipientConstraints(scope);
  const own = userId(req);
  const [announcements, unread, messages, circulars, events, queued] = await Promise.all([
    prisma.announcement.count({ where: { deletedAt: null, isArchived: false, ...announcementWhere } }),
    prisma.notification.count({ where: { userId: own, readAt: null, deletedAt: null } }),
    prisma.portalMessage.count({ where: { recipientId: own, readAt: null, deletedAt: null } }),
    prisma.circular.count({ where: { deletedAt: null, isArchived: false, ...circularWhere } }),
    prisma.calendarEvent.count({ where: { startsAt: { gte: new Date() }, deletedAt: null, isArchived: false, ...eventWhere } }),
    req.auth!.role === Role.SUPER_ADMIN ? prisma.notificationDelivery.count({ where: { status: "QUEUED" } }) : Promise.resolve(0),
  ]);
  res.json({ data: { announcements, unread, messages, circulars, events, queued } });
});

const announcementInput = z.object({
  title: z.string().min(2).max(160), body: z.string().min(1).max(100000), branchId: id.nullable().optional(), batchId: id.nullable().optional(), className: z.string().max(50).nullable().optional(), audience: z.nativeEnum(Role).nullable().optional(), priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"), scheduledAt: z.coerce.date().nullable().optional(), expiresAt: z.coerce.date().nullable().optional(), name: z.string().optional(), mimeType: z.string().optional(), base64: z.string().optional(),
});

router.get("/communication/announcements", async (req: AuthRequest, res) => {
  const query = page.extend({ priority: z.string().optional(), branchId: id.optional(), batchId: id.optional() }).parse(req.query);
  const access = await announcementAccess(req);
  const where: Prisma.AnnouncementWhereInput = {
    deletedAt: null,
    isArchived: admins.includes(req.auth!.role) ? query.archived === "true" : false,
    ...access,
    ...(query.priority ? { priority: query.priority } : {}),
    ...(query.branchId ? { branchId: query.branchId } : {}),
    ...(query.batchId ? { batchId: query.batchId } : {}),
    ...(query.search ? { OR: [{ title: { contains: query.search, mode: "insensitive" } }, { body: { contains: query.search, mode: "insensitive" } }] } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.announcement.findMany({ where, include: { author: { select: { name: true } }, branch: true, batch: true, _count: { select: { reads: true } } }, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: [{ priority: "desc" }, { publishedAt: "desc" }] }),
    prisma.announcement.count({ where }),
  ]);
  res.json({ data, meta: { total, page: query.page, totalPages: Math.ceil(total / query.limit) } });
});

router.post("/communication/announcements", async (req: AuthRequest, res) => {
  allow(req, staff);
  const input = announcementInput.parse(req.body);
  if (req.auth!.role === Role.TEACHER && input.audience && input.audience !== Role.STUDENT && input.audience !== Role.PARENT) throw new AppError(403, "AUDIENCE_FORBIDDEN", "Teachers may announce only to students or parents");
  await validateCommunicationTarget(req, input, { teacherMayTarget: true });
  const publishedAt = input.scheduledAt ?? new Date();
  if (input.expiresAt && input.expiresAt <= publishedAt) throw new AppError(422, "INVALID_SCHEDULE", "Expiry must be after publication");
  const { name, mimeType, base64, ...data } = input;
  const created = await prisma.announcement.create({ data: { ...data, ...attachment({ name, mimeType, base64 }), authorId: userId(req), publishedAt } });
  await audit(req, "CREATE", "Announcement", created.id);
  res.status(201).json({ data: { ...created, attachmentData: undefined } });
});

router.patch("/communication/announcements/:id", async (req: AuthRequest, res) => {
  const existing = await requireAnnouncementManager(req, id.parse(req.params.id));
  const input = announcementInput.partial().parse(req.body);
  if (req.auth!.role === Role.TEACHER && input.audience && input.audience !== Role.STUDENT && input.audience !== Role.PARENT) throw new AppError(403, "AUDIENCE_FORBIDDEN", "Teachers may announce only to students or parents");
  const target = { branchId: input.branchId === undefined ? existing.branchId : input.branchId, batchId: input.batchId === undefined ? existing.batchId : input.batchId };
  await validateCommunicationTarget(req, target, { teacherMayTarget: true });
  const scheduledAt = input.scheduledAt === undefined ? existing.scheduledAt : input.scheduledAt;
  const expiresAt = input.expiresAt === undefined ? existing.expiresAt : input.expiresAt;
  if (expiresAt && scheduledAt && expiresAt <= scheduledAt) throw new AppError(422, "INVALID_SCHEDULE", "Expiry must be after schedule");
  const { name, mimeType, base64, ...data } = input;
  const updated = await prisma.announcement.update({ where: { id: existing.id }, data: { ...data, ...(input.scheduledAt ? { publishedAt: input.scheduledAt } : {}), ...attachment({ name, mimeType, base64 }) } });
  await audit(req, "UPDATE", "Announcement", updated.id);
  res.json({ data: { ...updated, attachmentData: undefined } });
});

router.post("/communication/announcements/:id/read", async (req: AuthRequest, res) => {
  const access = await announcementAccess(req);
  const announcement = await prisma.announcement.findFirst({ where: { id: id.parse(req.params.id), deletedAt: null, isArchived: false, ...access }, select: { id: true } });
  if (!announcement) throw new AppError(404, "NOT_FOUND", "Announcement not found");
  const record = await prisma.announcementRead.upsert({ where: { announcementId_userId: { announcementId: announcement.id, userId: userId(req) } }, update: {}, create: { announcementId: announcement.id, userId: userId(req) } });
  res.status(201).json({ data: record });
});

router.delete("/communication/announcements/:id", async (req: AuthRequest, res) => {
  const existing = await requireAnnouncementManager(req, id.parse(req.params.id));
  const archive = req.query.archive !== "false";
  await prisma.announcement.update({ where: { id: existing.id }, data: archive ? { isArchived: true } : { deletedAt: new Date() } });
  await audit(req, archive ? "ARCHIVE" : "SOFT_DELETE", "Announcement", existing.id);
  res.status(204).end();
});

const channel = z.enum(["IN_APP", "EMAIL", "SMS", "WHATSAPP", "PUSH"]);
const notificationInput = z.object({
  userIds: z.array(id).min(1).max(1000), title: z.string().min(2).max(160), body: z.string().min(1).max(5000), category: z.string().min(2).max(50), sourceModule: z.string().max(50).optional(), sourceEntityId: z.string().optional(), actionUrl: z.string().max(500).optional(), priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"), channels: z.array(channel).min(1).default(["IN_APP"]), scheduledAt: z.coerce.date().optional(), expiresAt: z.coerce.date().optional(),
});

router.get("/communication/notifications", async (req: AuthRequest, res) => {
  const query = page.extend({ unread: z.enum(["true", "false"]).optional(), category: z.string().optional() }).parse(req.query);
  const where: Prisma.NotificationWhereInput = { userId: userId(req), deletedAt: null, isArchived: query.archived === "true", ...(query.unread === "true" ? { readAt: null } : {}), ...(query.category ? { category: query.category } : {}), ...(query.search ? { OR: [{ title: { contains: query.search, mode: "insensitive" } }, { body: { contains: query.search, mode: "insensitive" } }] } : {}) };
  const [data, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, include: { deliveries: true }, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: { createdAt: "desc" } }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: userId(req), readAt: null, deletedAt: null } }),
  ]);
  res.json({ data, meta: { total, unread, page: query.page, totalPages: Math.ceil(total / query.limit) } });
});

router.post("/communication/notifications", async (req: AuthRequest, res) => {
  const input = notificationInput.parse(req.body);
  const recipients = await assertAdministrativeRecipients(req, input.userIds);
  if (input.expiresAt && input.scheduledAt && input.expiresAt <= input.scheduledAt) throw new AppError(422, "INVALID_SCHEDULE", "Expiry must be after schedule");
  const created = await prisma.$transaction(recipients.map(recipientId => prisma.notification.create({ data: { userId: recipientId, title: input.title, body: input.body, category: input.category, sourceModule: input.sourceModule, sourceEntityId: input.sourceEntityId, actionUrl: input.actionUrl, priority: input.priority, channels: input.channels, scheduledAt: input.scheduledAt, expiresAt: input.expiresAt, deliveries: { create: input.channels.filter(value => value !== "IN_APP").map(value => ({ channel: value, status: "QUEUED" })) } } })));
  await audit(req, "SEND", "Notification", undefined, { count: created.length, category: input.category });
  res.status(201).json({ data: created });
});

router.patch("/communication/notifications/:id", async (req: AuthRequest, res) => {
  const input = z.object({ read: z.boolean().optional(), archived: z.boolean().optional(), deleted: z.boolean().optional() }).parse(req.body);
  const existing = await prisma.notification.findFirst({ where: { id: String(req.params.id), userId: userId(req) } });
  if (!existing) throw new AppError(404, "NOT_FOUND", "Notification not found");
  const data = await prisma.notification.update({ where: { id: existing.id }, data: { ...(input.read ? { readAt: new Date() } : {}), ...(input.archived !== undefined ? { isArchived: input.archived } : {}), ...(input.deleted ? { deletedAt: new Date() } : {}) } });
  res.json({ data });
});

router.get("/communication/preferences", async (req: AuthRequest, res) => res.json({ data: await prisma.notificationPreference.findUnique({ where: { userId: userId(req) } }) }));
router.put("/communication/preferences", async (req: AuthRequest, res) => {
  const input = z.object({ inApp: z.boolean(), email: z.boolean(), sms: z.boolean(), whatsapp: z.boolean(), push: z.boolean(), quietStart: z.string().regex(/^\d\d:\d\d$/).nullable().optional(), quietEnd: z.string().regex(/^\d\d:\d\d$/).nullable().optional(), categories: z.record(z.boolean()).optional() }).parse(req.body);
  res.json({ data: await prisma.notificationPreference.upsert({ where: { userId: userId(req) }, update: input, create: { userId: userId(req), ...input } }) });
});
router.post("/communication/deliveries/process", async (req: AuthRequest, res) => {
  allow(req, [Role.SUPER_ADMIN]);
  const queued = await prisma.notificationDelivery.findMany({ where: { status: "QUEUED" }, take: 100 });
  await prisma.notificationDelivery.updateMany({ where: { id: { in: queued.map(item => item.id) } }, data: { status: "READY", attempts: { increment: 1 } } });
  res.json({ data: { processed: queued.length, note: "READY records are consumed by configured email/SMS/WhatsApp/push providers" } });
});

const messageInput = z.object({ recipientId: id, subject: z.string().min(2).max(160), body: z.string().min(1).max(10000), name: z.string().optional(), mimeType: z.string().optional(), base64: z.string().optional() });
router.get("/communication/messages", async (req: AuthRequest, res) => {
  const query = page.parse(req.query);
  const where: Prisma.PortalMessageWhereInput = { deletedAt: null, OR: [{ senderId: userId(req), senderArchived: query.archived === "true" }, { recipientId: userId(req), recipientArchived: query.archived === "true" }], ...(query.search ? { AND: { OR: [{ subject: { contains: query.search, mode: "insensitive" } }, { body: { contains: query.search, mode: "insensitive" } }] } } : {}) };
  const [data, total, unread] = await Promise.all([
    prisma.portalMessage.findMany({ where, include: { sender: { select: { id: true, name: true, role: true } }, recipient: { select: { id: true, name: true, role: true } }, thread: true }, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: { createdAt: "desc" } }),
    prisma.portalMessage.count({ where }),
    prisma.portalMessage.count({ where: { recipientId: userId(req), readAt: null, deletedAt: null, recipientArchived: false } }),
  ]);
  res.json({ data, meta: { total, unread, page: query.page, totalPages: Math.ceil(total / query.limit) } });
});

router.post("/communication/messages", async (req: AuthRequest, res) => {
  const input = messageInput.parse(req.body);
  await assertMessageRecipientAuthorized(sender(req), input.recipientId);
  const { name, mimeType, base64, ...data } = input;
  res.status(201).json({ data: await prisma.portalMessage.create({ data: { ...data, ...attachment({ name, mimeType, base64 }), senderId: userId(req) } }) });
});

router.patch("/communication/messages/:id", async (req: AuthRequest, res) => {
  const input = z.object({ read: z.boolean().optional(), archive: z.boolean().optional(), deleted: z.boolean().optional() }).parse(req.body);
  const message = await prisma.portalMessage.findUnique({ where: { id: String(req.params.id) } });
  if (!message || message.senderId !== userId(req) && message.recipientId !== userId(req)) throw new AppError(404, "NOT_FOUND", "Message not found");
  const data = await prisma.portalMessage.update({ where: { id: message.id }, data: { ...(input.read && message.recipientId === userId(req) ? { readAt: new Date() } : {}), ...(input.archive !== undefined ? message.senderId === userId(req) ? { senderArchived: input.archive } : { recipientArchived: input.archive } : {}), ...(input.deleted ? { deletedAt: new Date() } : {}) } });
  res.json({ data });
});

router.post("/communication/threads", async (req: AuthRequest, res) => {
  const input = z.object({ name: z.string().min(2).max(100), memberIds: z.array(id).min(1).max(99) }).parse(req.body);
  const recipients = [...new Set(input.memberIds.filter(memberId => memberId !== userId(req)))];
  if (!recipients.length) throw new AppError(422, "THREAD_MEMBERS_REQUIRED", "Select at least one other member");
  await assertMessageRecipientsAuthorized(sender(req), recipients);
  const members = [userId(req), ...recipients];
  const thread = await prisma.messageThread.create({ data: { name: input.name, isGroup: members.length > 2, createdById: userId(req), members: { create: members.map(memberId => ({ userId: memberId, role: memberId === userId(req) ? "OWNER" : "MEMBER" })) } } });
  res.status(201).json({ data: thread });
});

router.post("/communication/threads/:id/messages", async (req: AuthRequest, res) => {
  const input = z.object({ body: z.string().min(1).max(10000), name: z.string().optional(), mimeType: z.string().optional(), base64: z.string().optional() }).parse(req.body);
  const threadId = id.parse(req.params.id);
  const member = await prisma.messageThreadMember.findUnique({ where: { threadId_userId: { threadId, userId: userId(req) } }, include: { thread: true } });
  assertThreadMember(member, member?.thread ?? null);
  const others = await prisma.messageThreadMember.findMany({ where: { threadId, userId: { not: userId(req) } }, select: { userId: true } });
  await assertMessageRecipientsAuthorized(sender(req), others.map(item => item.userId));
  const { name, mimeType, base64, ...data } = input;
  const file = attachment({ name, mimeType, base64 });
  const created = await prisma.$transaction(others.map(other => prisma.portalMessage.create({ data: { ...data, ...file, threadId, senderId: userId(req), recipientId: other.userId, subject: "Group message" } })));
  res.status(201).json({ data: created });
});

const circularInput = z.object({ branchId: id.nullable().optional(), number: z.string().min(2).max(50), title: z.string().min(2).max(160), audience: z.nativeEnum(Role).nullable().optional(), body: z.string().min(1).max(100000), requiresAcknowledgement: z.boolean().default(false), publishedAt: z.coerce.date().optional(), expiresAt: z.coerce.date().optional(), name: z.string().optional(), mimeType: z.string().optional(), base64: z.string().optional() });
router.get("/communication/circulars", async (req: AuthRequest, res) => {
  const query = page.parse(req.query);
  const access = await circularAccess(req);
  const where: Prisma.CircularWhereInput = { deletedAt: null, isArchived: admins.includes(req.auth!.role) ? query.archived === "true" : false, ...access, ...(query.search ? { OR: [{ number: { contains: query.search, mode: "insensitive" } }, { title: { contains: query.search, mode: "insensitive" } }] } : {}) };
  const [data, total] = await Promise.all([
    prisma.circular.findMany({ where, include: { branch: { select: { branchName: true, branchCode: true } }, versions: { orderBy: { version: "desc" }, take: 1 }, _count: { select: { acknowledgements: true, downloads: true } } }, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: { createdAt: "desc" } }),
    prisma.circular.count({ where }),
  ]);
  res.json({ data, meta: { total, page: query.page, totalPages: Math.ceil(total / query.limit) } });
});

router.post("/communication/circulars", async (req: AuthRequest, res) => {
  allow(req, admins);
  const input = circularInput.parse(req.body);
  await validateCommunicationTarget(req, input);
  if (input.expiresAt && input.publishedAt && input.expiresAt <= input.publishedAt) throw new AppError(422, "INVALID_SCHEDULE", "Expiry must be after publication");
  const { body, name, mimeType, base64, ...head } = input;
  const created = await prisma.circular.create({ data: { ...head, versions: { create: { version: 1, body, ...attachment({ name, mimeType, base64 }) } } } });
  await audit(req, "CREATE", "Circular", created.id);
  res.status(201).json({ data: created });
});

router.post("/communication/circulars/:id/versions", async (req: AuthRequest, res) => {
  const circular = await requireCircularManager(req, id.parse(req.params.id));
  const input = z.object({ body: z.string().min(1).max(100000), name: z.string().optional(), mimeType: z.string().optional(), base64: z.string().optional() }).parse(req.body);
  const { name, mimeType, base64, ...data } = input;
  const result = await prisma.$transaction([
    prisma.circularVersion.create({ data: { circularId: circular.id, version: circular.currentVersion + 1, ...data, ...attachment({ name, mimeType, base64 }) } }),
    prisma.circular.update({ where: { id: circular.id }, data: { currentVersion: { increment: 1 } } }),
  ]);
  await audit(req, "CREATE_VERSION", "Circular", circular.id, { version: result[0].version });
  res.status(201).json({ data: result[0] });
});

router.post("/communication/circulars/:id/acknowledge", async (req: AuthRequest, res) => {
  const access = await circularAccess(req);
  const circular = await prisma.circular.findFirst({ where: { id: id.parse(req.params.id), deletedAt: null, isArchived: false, requiresAcknowledgement: true, ...access }, select: { id: true } });
  if (!circular) throw new AppError(404, "NOT_FOUND", "Circular not found");
  const record = await prisma.circularAcknowledgement.upsert({ where: { circularId_userId: { circularId: circular.id, userId: userId(req) } }, update: {}, create: { circularId: circular.id, userId: userId(req) } });
  res.status(201).json({ data: record });
});

router.get("/communication/circulars/:id/pdf", async (req: AuthRequest, res) => {
  const access = await circularAccess(req);
  const circular = await prisma.circular.findFirst({ where: { id: id.parse(req.params.id), deletedAt: null, isArchived: false, ...access }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
  if (!circular) throw new AppError(404, "NOT_FOUND", "Circular not found");
  await prisma.circularDownload.create({ data: { circularId: circular.id, userId: userId(req), ipAddress: req.ip } });
  const filename = circular.number.replace(/[^A-Za-z0-9_-]/g, "_");
  res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}.pdf"` }).send(circular.versions[0]?.pdfData ?? Buffer.from(`%PDF-1.4\n${circular.title}\n${circular.versions[0]?.body ?? ""}\n%%EOF`));
});

const eventInput = z.object({ branchId: id.nullable().optional(), batchId: id.nullable().optional(), title: z.string().min(2).max(160), description: z.string().max(10000).optional(), type: z.enum(["SCHOOL", "HOLIDAY", "EXAM", "PTM", "MEETING", "REMINDER"]), startsAt: z.coerce.date(), endsAt: z.coerce.date(), location: z.string().max(200).optional(), audience: z.nativeEnum(Role).nullable().optional(), reminders: z.array(z.number().int().min(0)).default([]), status: z.enum(["SCHEDULED", "CANCELLED", "COMPLETED"]).default("SCHEDULED") });
router.get("/communication/events", async (req: AuthRequest, res) => {
  const query = page.extend({ type: z.string().optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional() }).parse(req.query);
  const access = await eventAccess(req);
  const where: Prisma.CalendarEventWhereInput = { deletedAt: null, isArchived: admins.includes(req.auth!.role) ? query.archived === "true" : false, ...access, ...(query.type ? { type: query.type } : {}), ...(query.from || query.to ? { startsAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } } : {}), ...(query.search ? { title: { contains: query.search, mode: "insensitive" } } : {}) };
  const [data, total] = await Promise.all([
    prisma.calendarEvent.findMany({ where, include: { branch: { select: { branchName: true, branchCode: true } }, batch: { select: { name: true, code: true } }, _count: { select: { rsvps: true } } }, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: { startsAt: "asc" } }),
    prisma.calendarEvent.count({ where }),
  ]);
  res.json({ data, meta: { total, page: query.page, totalPages: Math.ceil(total / query.limit) } });
});

router.post("/communication/events", async (req: AuthRequest, res) => {
  allow(req, staff);
  const input = eventInput.parse(req.body);
  await validateCommunicationTarget(req, input, { teacherMayTarget: true });
  if (input.endsAt <= input.startsAt) throw new AppError(422, "INVALID_TIME", "Event end must follow start");
  const created = await prisma.calendarEvent.create({ data: input });
  await audit(req, "CREATE", "CalendarEvent", created.id);
  res.status(201).json({ data: created });
});

router.patch("/communication/events/:id", async (req: AuthRequest, res) => {
  const existing = await requireEventManager(req, id.parse(req.params.id));
  const input = eventInput.partial().parse(req.body);
  const target = { branchId: input.branchId === undefined ? existing.branchId : input.branchId, batchId: input.batchId === undefined ? existing.batchId : input.batchId };
  await validateCommunicationTarget(req, target);
  const startsAt = input.startsAt ?? existing.startsAt;
  const endsAt = input.endsAt ?? existing.endsAt;
  if (endsAt <= startsAt) throw new AppError(422, "INVALID_TIME", "Event end must follow start");
  const updated = await prisma.calendarEvent.update({ where: { id: existing.id }, data: input });
  await audit(req, "UPDATE", "CalendarEvent", updated.id);
  res.json({ data: updated });
});

router.post("/communication/events/:id/rsvp", async (req: AuthRequest, res) => {
  const input = z.object({ response: z.enum(["YES", "NO", "MAYBE"]) }).parse(req.body);
  const access = await eventAccess(req);
  const eventRecord = await prisma.calendarEvent.findFirst({ where: { id: id.parse(req.params.id), deletedAt: null, isArchived: false, status: "SCHEDULED", endsAt: { gte: new Date() }, ...access }, select: { id: true } });
  if (!eventRecord) throw new AppError(404, "NOT_FOUND", "Event not found");
  const record = await prisma.calendarEventRsvp.upsert({ where: { eventId_userId: { eventId: eventRecord.id, userId: userId(req) } }, update: input, create: { eventId: eventRecord.id, userId: userId(req), ...input } });
  res.json({ data: record });
});

router.delete("/communication/events/:id", async (req: AuthRequest, res) => {
  const existing = await requireEventManager(req, id.parse(req.params.id));
  const archive = req.query.archive !== "false";
  await prisma.calendarEvent.update({ where: { id: existing.id }, data: archive ? { isArchived: true } : { deletedAt: new Date() } });
  await audit(req, archive ? "ARCHIVE" : "SOFT_DELETE", "CalendarEvent", existing.id);
  res.status(204).end();
});

const automaticType = z.enum(["HOMEWORK_ASSIGNED", "FEES_DUE", "FEE_RECEIVED", "ATTENDANCE_ALERT", "EXAMINATION_SCHEDULE", "RESULT_PUBLISHED", "LIBRARY_DUE", "TRANSPORT_UPDATE", "HOSTEL_UPDATE", "LEAVE_APPROVAL", "PAYROLL_NOTIFICATION"]);
router.post("/communication/automatic", async (req: AuthRequest, res) => {
  const input = z.object({ type: automaticType, userIds: z.array(id).min(1).max(1000), entityId: z.string(), title: z.string().min(2), body: z.string().min(1), actionUrl: z.string().optional() }).parse(req.body);
  const recipients = await assertAdministrativeRecipients(req, input.userIds);
  const created = await prisma.$transaction(recipients.map(recipientId => prisma.notification.create({ data: { userId: recipientId, title: input.title, body: input.body, category: input.type, sourceModule: input.type.split("_")[0], sourceEntityId: input.entityId, actionUrl: input.actionUrl, priority: input.type === "ATTENDANCE_ALERT" || input.type === "FEES_DUE" ? "HIGH" : "NORMAL", channels: ["IN_APP", "EMAIL"], deliveries: { create: { channel: "EMAIL", status: "QUEUED" } } } })));
  await audit(req, "AUTOMATIC_NOTIFICATION", input.type, input.entityId, { recipients: created.length });
  res.status(201).json({ data: { created: created.length } });
});

export default router;
