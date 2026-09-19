import assert from "node:assert/strict";
import test from "node:test";
import { Role } from "@prisma/client";
import { branchManagementConstraints, circularRecipientConstraints } from "./communication-authorization.js";
import { announcementListFields, circularVersionListFields, messageListFields } from "./communication-projections.js";
import { participantMessageUpdate } from "./message-policy.js";
import { activeNotificationConstraints, notificationIsActive, notificationLifecycleConstraints } from "./notification-policy.js";
import { noticeArchivedState } from "./notice-policy.js";
import { deliverNotification } from "./notifications.js";
import { systemPrisma } from "./prisma.js";

const now = new Date("2026-09-19T10:00:00.000Z");
const notification = (values: Partial<{ scheduledAt: Date | null; expiresAt: Date | null; isArchived: boolean; deletedAt: Date | null }> = {}) => ({
  scheduledAt: null,
  expiresAt: null,
  isArchived: false,
  deletedAt: null,
  ...values,
});

test("recipient notification lifecycle hides future, expired, archived and deleted records", () => {
  assert.equal(notificationIsActive(notification(), now), true);
  assert.equal(notificationIsActive(notification({ scheduledAt: new Date("2026-09-19T10:00:01.000Z") }), now), false);
  assert.equal(notificationIsActive(notification({ scheduledAt: now }), now), true);
  assert.equal(notificationIsActive(notification({ expiresAt: now }), now), false);
  assert.equal(notificationIsActive(notification({ expiresAt: new Date("2026-09-19T10:00:01.000Z") }), now), true);
  assert.equal(notificationIsActive(notification({ isArchived: true }), now), false);
  assert.equal(notificationIsActive(notification({ deletedAt: new Date("2026-09-19T09:00:00.000Z") }), now), false);
  assert.deepEqual(activeNotificationConstraints(now), {
    deletedAt: null,
    isArchived: false,
    AND: [
      { OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }] },
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    ],
  });
  assert.deepEqual(notificationLifecycleConstraints(now, true), {
    deletedAt: null,
    isArchived: true,
    AND: [
      { OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }] },
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    ],
  });
});

test("provider delivery refuses future, expired, archived and deleted notifications", async () => {
  const deliveryModel = (systemPrisma as any).notificationDelivery;
  const originalFind = deliveryModel.findUnique;
  const originalUpdate = deliveryModel.update;
  let current = notification();
  let updates = 0;
  deliveryModel.findUnique = async () => ({ id: "delivery-a", status: "QUEUED", channel: "EMAIL", notification: { ...current, user: { email: "recipient@example.test", phone: null } } });
  deliveryModel.update = async () => { updates += 1; return {}; };
  try {
    for (current of [
      notification({ scheduledAt: new Date("2026-09-19T10:00:01.000Z") }),
      notification({ expiresAt: now }),
      notification({ isArchived: true }),
      notification({ deletedAt: new Date("2026-09-19T09:00:00.000Z") }),
    ]) await deliverNotification("delivery-a", now);
    assert.equal(updates, 0);
  } finally {
    deliveryModel.findUnique = originalFind;
    deliveryModel.update = originalUpdate;
  }
});

function matches(value: any, constraint: any): boolean {
  if (constraint === null || typeof constraint !== "object" || constraint instanceof Date) return value === constraint;
  if (Array.isArray(constraint.OR)) return constraint.OR.some((item: any) => matches(value, item));
  if (Array.isArray(constraint.AND)) return constraint.AND.every((item: any) => matches(value, item));
  if (Array.isArray(constraint.in)) return constraint.in.includes(value);
  if ("not" in constraint && matches(value, constraint.not)) return false;
  if ("lte" in constraint && !(value <= constraint.lte)) return false;
  if ("gt" in constraint && !(value > constraint.gt)) return false;
  return Object.entries(constraint).filter(([key]) => !["in", "not", "lte", "gt"].includes(key)).every(([key, expected]) => matches(value?.[key], expected));
}

test("circular recipients require a reached publication time while managers retain draft access", () => {
  const recipient = circularRecipientConstraints({ role: Role.STUDENT, branchIds: ["branch-a"], batchIds: ["batch-a"] }, now);
  const base = { audience: Role.STUDENT, branchId: "branch-a", expiresAt: null };
  assert.equal(matches({ ...base, publishedAt: null }, recipient), false);
  assert.equal(matches({ ...base, publishedAt: new Date("2026-09-19T10:00:01.000Z") }, recipient), false);
  assert.equal(matches({ ...base, publishedAt: now }, recipient), true);
  assert.deepEqual(branchManagementConstraints({ role: Role.SUPER_ADMIN, branchIds: null, batchIds: null }), {});
  assert.doesNotMatch(JSON.stringify(branchManagementConstraints({ role: Role.BRANCH_ADMIN, branchIds: ["branch-a"], batchIds: null })), /publishedAt/);
});

test("archived notices are available only to managers", () => {
  assert.equal(noticeArchivedState(Role.STUDENT, "true"), false);
  assert.equal(noticeArchivedState(Role.PARENT, "true"), false);
  assert.equal(noticeArchivedState(Role.TEACHER, "true"), false);
  assert.equal(noticeArchivedState(Role.BRANCH_ADMIN, "true"), true);
  assert.equal(noticeArchivedState(Role.SUPER_ADMIN, "true"), true);
  assert.equal(noticeArchivedState(Role.SUPER_ADMIN, "false"), false);
});

test("message participant updates are private to that participant and never delete shared history", () => {
  const message = { senderId: "sender", recipientId: "recipient" };
  assert.deepEqual(participantMessageUpdate(message, "sender", { archived: true }, now), { senderArchived: true });
  assert.deepEqual(participantMessageUpdate(message, "recipient", { archived: true, read: true }, now), { recipientArchived: true, readAt: now });
  assert.equal("deletedAt" in participantMessageUpdate(message, "sender", { archived: true }, now), false);
  assert.throws(() => participantMessageUpdate(message, "other", { archived: true }, now), (error: any) => error?.status === 404);
});

test("communication list projections retain attachment metadata without binary payloads", () => {
  assert.equal(announcementListFields.attachmentName, true);
  assert.equal(announcementListFields.attachmentMime, true);
  assert.equal("attachmentData" in announcementListFields, false);
  assert.equal(messageListFields.attachmentName, true);
  assert.equal(messageListFields.attachmentMime, true);
  assert.equal("attachmentData" in messageListFields, false);
  assert.equal(circularVersionListFields.attachmentName, true);
  assert.equal(circularVersionListFields.attachmentMime, true);
  assert.equal("attachmentData" in circularVersionListFields, false);
  assert.equal("pdfData" in circularVersionListFields, false);
});
