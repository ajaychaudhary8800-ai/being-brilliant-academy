import { MeetingRecordingStatus } from "@prisma/client";
import { deleteLiveKitRecordingObject, headLiveKitRecordingObject, livekitRecordingConfigured } from "./livekit.js";
import { systemPrisma } from "./prisma.js";

async function recordingAvailableNotifications(input: {
  organizationId: string;
  meetingId: string;
  recordingId: string;
  title: string;
  userIds: string[];
}) {
  for (const userId of [...new Set(input.userIds)]) {
    const notification = await systemPrisma.notification.create({
      data: {
        organizationId: input.organizationId,
        userId,
        title: "Meeting recording available: " + input.title,
        body: "The meeting recording is now available in the private meeting archive.",
        category: "MEETINGS",
        sourceModule: "MEETINGS",
        sourceEntityId: input.recordingId,
        actionUrl: "/meetings/" + input.meetingId,
        priority: "NORMAL",
        channels: ["IN_APP", "EMAIL"],
      },
    });
    await systemPrisma.notificationDelivery.create({
      data: { organizationId: input.organizationId, notificationId: notification.id, channel: "EMAIL", status: "QUEUED" },
    });
  }
}

export async function reconcileMeetingLifecycle(now = new Date()) {
  if (!livekitRecordingConfigured()) return { configured: false, available: 0, deleted: 0, failed: 0 };
  let available = 0;
  let deleted = 0;
  let failed = 0;

  const processing = await systemPrisma.meetingRecording.findMany({
    where: { status: MeetingRecordingStatus.PROCESSING, objectKey: { not: null } },
    include: {
      meeting: {
        select: {
          id: true,
          title: true,
          participants: { where: { removedAt: null }, select: { userId: true } },
        },
      },
    },
    orderBy: { stoppedAt: "asc" },
    take: 25,
  });

  for (const recording of processing) {
    try {
      const metadata = recording.objectKey ? await headLiveKitRecordingObject(recording.objectKey) : null;
      if (!metadata) continue;
      const transitioned = await systemPrisma.meetingRecording.updateMany({
        where: { id: recording.id, status: MeetingRecordingStatus.PROCESSING },
        data: {
          status: MeetingRecordingStatus.AVAILABLE,
          sizeBytes: metadata.sizeBytes !== null ? BigInt(metadata.sizeBytes) : null,
        },
      });
      if (!transitioned.count) continue;
      await recordingAvailableNotifications({
        organizationId: recording.organizationId,
        meetingId: recording.meetingId,
        recordingId: recording.id,
        title: recording.meeting.title,
        userIds: recording.meeting.participants.map(participant => participant.userId),
      });
      available += 1;
    } catch {
      failed += 1;
    }
  }

  const expired = await systemPrisma.meetingRecording.findMany({
    where: {
      retentionUntil: { lte: now },
      status: { in: [MeetingRecordingStatus.AVAILABLE, MeetingRecordingStatus.FAILED] },
    },
    orderBy: { retentionUntil: "asc" },
    take: 25,
  });
  for (const recording of expired) {
    try {
      if (recording.objectKey) await deleteLiveKitRecordingObject(recording.objectKey);
      await systemPrisma.meetingRecording.update({
        where: { id: recording.id },
        data: { status: MeetingRecordingStatus.DELETED, objectKey: null, sizeBytes: null },
      });
      deleted += 1;
    } catch {
      failed += 1;
    }
  }

  return { configured: true, available, deleted, failed };
}
