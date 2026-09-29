import {
  MeetingParticipantRole,
  MeetingRecordingStatus,
  MeetingStatus,
} from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config.js";
import { AppError } from "../lib/http.js";
import {
  createLiveKitToken,
  deleteLiveKitRecordingObject,
  getLiveKitRecordingObject,
  livekitClientUrl,
  livekitConfigured,
  livekitEgress,
  livekitRecordingConfigured,
  livekitRecordingStorage,
  livekitRoomService,
} from "../lib/livekit.js";
import { prisma } from "../lib/prisma.js";
import { assertFeatureEntitled } from "../lib/saas-commercial.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { requireCommercialFeature } from "../middleware/commercial-entitlement.js";

const router = Router();
router.use(requireAuth, requireCommercialFeature("meetings"));

const org = (req: AuthRequest) => req.auth!.organizationId;
const actor = (req: AuthRequest) => req.auth!.userId;
const roomParam = z.string().min(10).max(160);

async function meetingForRoom(req: AuthRequest, room: string) {
  const meeting = await prisma.meeting.findFirst({
    where: { organizationId: org(req), livekitRoomName: room },
    include: {
      participants: { where: { removedAt: null } },
      recordings: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!meeting) throw new AppError(404, "MEETING_NOT_FOUND", "Meeting not found");
  const participant = meeting.participants.find(p => p.userId === actor(req));
  if (!participant) throw new AppError(403, "MEETING_INVITE_REQUIRED", "You are not a participant in this meeting");
  return { meeting, participant };
}

function managerRole(role: MeetingParticipantRole) {
  return role === MeetingParticipantRole.HOST || role === MeetingParticipantRole.CO_HOST;
}

function assertActiveMeeting(meeting: { status: MeetingStatus }) {
  if (![MeetingStatus.SCHEDULED, MeetingStatus.OPEN_FOR_JOIN, MeetingStatus.LIVE].includes(meeting.status)) {
    throw new AppError(409, "MEETING_NOT_ACTIVE", "This meeting is no longer active");
  }
}

function assertJoinable(meeting: { status: MeetingStatus; startsAt: Date; endsAt: Date; joinBeforeMinutes: number; roomLocked: boolean }, manager: boolean) {
  if (![MeetingStatus.SCHEDULED, MeetingStatus.OPEN_FOR_JOIN, MeetingStatus.LIVE].includes(meeting.status)) {
    throw new AppError(409, "MEETING_NOT_JOINABLE", "This meeting is no longer joinable");
  }
  const now = Date.now();
  const opensAt = meeting.startsAt.getTime() - (manager ? 24 * 60 : meeting.joinBeforeMinutes) * 60_000;
  const closesAt = meeting.endsAt.getTime() + 4 * 60 * 60_000;
  if (now < opensAt) throw new AppError(425, "MEETING_NOT_OPEN", "Meeting room is not open yet");
  if (now > closesAt) throw new AppError(410, "MEETING_JOIN_WINDOW_CLOSED", "Meeting join window has closed");
  if (meeting.roomLocked && !manager) throw new AppError(423, "MEETING_LOCKED", "The host has locked this meeting");
}

async function meetingAudit(req: AuthRequest, meetingId: string, action: string, metadata?: unknown) {
  await prisma.meetingAuditLog.create({ data: {
    organizationId: org(req), meetingId, actorUserId: actor(req), action, entityType: "Meeting",
    entityId: meetingId, metadata: metadata as object | undefined, ipAddress: req.ip, userAgent: req.header("user-agent"),
  }});
}

async function closeOpenAttendance(meetingId: string, participantId?: string) {
  const now = new Date();
  const rows = await prisma.meetingAttendanceSession.findMany({
    where: { meetingId, leftAt: null, ...(participantId ? { participantId } : {}) },
    select: { id: true, joinedAt: true },
  });
  for (const row of rows) {
    await prisma.meetingAttendanceSession.update({
      where: { id: row.id },
      data: { leftAt: now, durationSeconds: Math.max(0, Math.round((now.getTime() - row.joinedAt.getTime()) / 1000)) },
    });
  }
}

router.post("/meetings/native/:room/session", async (req: AuthRequest, res) => {
  const room = roomParam.parse(req.params.room);
  const { meeting, participant } = await meetingForRoom(req, room);
  const manager = managerRole(participant.meetingRole);
  assertJoinable(meeting, manager);
  if (!livekitConfigured()) throw new AppError(503, "MEETING_LIVEKIT_NOT_CONFIGURED", "Native meeting infrastructure is not configured");
  const user = await prisma.user.findFirst({ where: { organizationId: org(req), id: actor(req), isActive: true }, select: { name: true } });
  if (!user) throw new AppError(404, "USER_NOT_FOUND", "User account not found");

  const observer = participant.meetingRole === MeetingParticipantRole.OBSERVER;
  const sources = manager
    ? ["camera", "microphone", "screen_share", "screen_share_audio"]
    : [
        ...(meeting.allowParticipantCamera ? ["camera"] : []),
        ...(meeting.allowParticipantMic ? ["microphone"] : []),
        ...(meeting.allowScreenShare ? ["screen_share", "screen_share_audio"] : []),
      ];
  const token = createLiveKitToken({
    identity: actor(req),
    name: user.name,
    room,
    role: participant.meetingRole,
    ttlSeconds: 4 * 60 * 60,
    grant: {
      room,
      roomJoin: true,
      roomAdmin: manager,
      canSubscribe: true,
      canPublish: !observer && sources.length > 0,
      canPublishData: !observer,
      canUpdateOwnMetadata: !observer,
      ...(!observer ? { canPublishSources: sources } : {}),
    },
  });
  res.status(201).json({ data: {
    serverUrl: livekitClientUrl(),
    participantToken: token,
    meeting: {
      id: meeting.id, title: meeting.title, description: meeting.description, startsAt: meeting.startsAt, endsAt: meeting.endsAt,
      type: meeting.type, recordingStatus: meeting.recordings[0]?.status ?? null,
    },
    meetingRole: participant.meetingRole,
    manager,
    locked: meeting.roomLocked,
    settings: {
      allowChat: meeting.allowChat, allowWhiteboard: meeting.allowWhiteboard, allowAnnotation: meeting.allowAnnotation,
      allowScreenShare: meeting.allowScreenShare, allowParticipantMic: meeting.allowParticipantMic, allowParticipantCamera: meeting.allowParticipantCamera,
    },
    recordingConfigured: meeting.allowRecording && livekitRecordingConfigured(),
    recordingAvailable: meeting.recordings.some(r => r.status !== MeetingRecordingStatus.DELETED && Boolean(r.storageKey)),
    recordings: meeting.recordings.filter(r => r.status !== MeetingRecordingStatus.DELETED).map(r => ({
      id: r.id, status: r.status, startedAt: r.startedAt, stoppedAt: r.stoppedAt,
      durationSeconds: r.durationSeconds, available: Boolean(r.storageKey),
    })),
    whiteboardData: meeting.whiteboardData ?? [],
  }});
});

router.post("/meetings/native/:room/join", async (req: AuthRequest, res) => {
  const room = roomParam.parse(req.params.room);
  const { meeting, participant } = await meetingForRoom(req, room);
  const manager = managerRole(participant.meetingRole);
  assertJoinable(meeting, manager);
  if (meeting.status !== MeetingStatus.LIVE) {
    const policy = await assertFeatureEntitled(org(req), "meetings");
    const limit = policy.enforcementEnabled ? policy.plan?.limits["meeting.concurrentRooms"] : null;
    if (typeof limit === "number") {
      const liveRooms = await prisma.meeting.count({ where: { organizationId: org(req), status: MeetingStatus.LIVE, id: { not: meeting.id } } });
      if (liveRooms >= limit) throw new AppError(409, "MEETING_CONCURRENT_ROOM_LIMIT", `Your plan allows ${limit} concurrent meeting rooms`);
    }
  }
  const existing = await prisma.meetingAttendanceSession.findFirst({
    where: { organizationId: org(req), meetingId: meeting.id, participantId: participant.id, leftAt: null },
    orderBy: { joinedAt: "desc" },
  });
  const attendance = existing ?? await prisma.meetingAttendanceSession.create({
    data: { organizationId: org(req), meetingId: meeting.id, participantId: participant.id, source: "LIVEKIT" },
  });
  const now = new Date();
  const targetStatus = now < meeting.startsAt ? MeetingStatus.OPEN_FOR_JOIN : MeetingStatus.LIVE;
  if (meeting.status === MeetingStatus.SCHEDULED || meeting.status === MeetingStatus.OPEN_FOR_JOIN) {
    await prisma.meeting.update({ where: { id: meeting.id }, data: { status: targetStatus } });
  }
  await meetingAudit(req, meeting.id, "JOIN", { attendanceSessionId: attendance.id });
  res.status(existing ? 200 : 201).json({ data: attendance });
});

router.post("/meetings/native/:room/leave", async (req: AuthRequest, res) => {
  const room = roomParam.parse(req.params.room);
  const { meeting, participant } = await meetingForRoom(req, room);
  await closeOpenAttendance(meeting.id, participant.id);
  await meetingAudit(req, meeting.id, "LEAVE");
  res.status(204).send();
});

router.post("/meetings/native/:room/end", async (req: AuthRequest, res) => {
  const room = roomParam.parse(req.params.room);
  const { meeting, participant } = await meetingForRoom(req, room);
  if (!managerRole(participant.meetingRole)) throw new AppError(403, "MEETING_MODERATION_FORBIDDEN", "Host or co-host permission is required");
  assertActiveMeeting(meeting);
  const now = new Date();
  const activeRecordings = meeting.recordings.filter(r => (r.status === MeetingRecordingStatus.STARTING || r.status === MeetingRecordingStatus.RECORDING) && r.providerRecordingId);
  for (const recording of activeRecordings) {
    await livekitEgress("StopEgress", { egress_id: recording.providerRecordingId! }).catch(() => null);
    await prisma.meetingRecording.update({
      where: { id: recording.id },
      data: {
        status: MeetingRecordingStatus.PROCESSING,
        stoppedAt: now,
        durationSeconds: Math.max(0, Math.round((now.getTime() - (recording.startedAt ?? now).getTime()) / 1000)),
      },
    });
  }
  await livekitRoomService("DeleteRoom", { room }, room).catch(() => null);
  await closeOpenAttendance(meeting.id);
  const row = await prisma.meeting.update({ where: { id: meeting.id }, data: { status: MeetingStatus.ENDED, endedAt: now, roomLocked: true } });
  await meetingAudit(req, meeting.id, "END", { stoppedRecordings: activeRecordings.length });
  res.json({ data: row });
});

router.post("/meetings/native/:room/control", async (req: AuthRequest, res) => {
  const room = roomParam.parse(req.params.room);
  const { meeting, participant } = await meetingForRoom(req, room);
  if (!managerRole(participant.meetingRole)) throw new AppError(403, "MEETING_MODERATION_FORBIDDEN", "Host or co-host permission is required");
  assertActiveMeeting(meeting);
  const data = z.object({
    action: z.enum(["LOCK", "UNLOCK", "MUTE_TRACK", "REMOVE_PARTICIPANT", "ALLOW_SCREEN_SHARE", "REVOKE_SCREEN_SHARE"]),
    identity: z.string().min(1).max(160).optional(),
    trackSid: z.string().min(1).max(160).optional(),
  }).parse(req.body);
  if (data.action === "LOCK" || data.action === "UNLOCK") {
    const locked = data.action === "LOCK";
    await prisma.meeting.update({ where: { id: meeting.id }, data: { roomLocked: locked } });
    await meetingAudit(req, meeting.id, data.action);
    return res.json({ data: { locked } });
  }
  if (!data.identity) throw new AppError(422, "PARTICIPANT_REQUIRED", "Participant identity is required");
  const target = meeting.participants.find(p => p.userId === data.identity);
  if (!target) throw new AppError(422, "MEETING_PARTICIPANT_INVALID", "Target is not a meeting participant");
  if (target.meetingRole === MeetingParticipantRole.HOST && target.userId !== actor(req)) throw new AppError(403, "MEETING_HOST_PROTECTED", "The host cannot be removed or restricted by a co-host");
  if (data.action === "MUTE_TRACK") {
    if (!data.trackSid) throw new AppError(422, "TRACK_REQUIRED", "Track ID is required");
    const result = await livekitRoomService("MutePublishedTrack", { room, identity: data.identity, track_sid: data.trackSid, muted: true }, room);
    await meetingAudit(req, meeting.id, "MUTE_PARTICIPANT", { identity: data.identity, trackSid: data.trackSid });
    return res.json({ data: result });
  }
  if (data.action === "REMOVE_PARTICIPANT") {
    const result = await livekitRoomService("RemoveParticipant", { room, identity: data.identity }, room);
    await closeOpenAttendance(meeting.id, target.id);
    await meetingAudit(req, meeting.id, "REMOVE_FROM_ROOM", { identity: data.identity });
    return res.json({ data: result ?? { removed: true } });
  }
  const allowShare = data.action === "ALLOW_SCREEN_SHARE";
  const canCamera = meeting.allowParticipantCamera;
  const canMic = meeting.allowParticipantMic;
  const sources = [
    ...(canCamera ? ["camera"] : []), ...(canMic ? ["microphone"] : []),
    ...(allowShare ? ["screen_share", "screen_share_audio"] : []),
  ];
  const result = await livekitRoomService("UpdateParticipant", {
    room, identity: data.identity,
    permission: { can_subscribe: true, can_publish: sources.length > 0, can_publish_data: true, can_publish_sources: sources },
  }, room);
  await meetingAudit(req, meeting.id, data.action, { identity: data.identity });
  res.json({ data: result });
});

router.post("/meetings/native/:room/interactions", async (req: AuthRequest, res) => {
  const room = roomParam.parse(req.params.room);
  const { meeting } = await meetingForRoom(req, room);
  assertActiveMeeting(meeting);
  const data = z.object({
    type: z.enum(["CHAT", "RAISE_HAND", "REACTION", "POLL", "POLL_RESPONSE"]),
    content: z.record(z.string(), z.unknown()).optional(),
  }).parse(req.body);
  if (data.type === "CHAT" && !meeting.allowChat) throw new AppError(403, "MEETING_CHAT_DISABLED", "Chat is disabled for this meeting");
  const row = await prisma.meetingInteraction.create({ data: {
    organizationId: org(req), meetingId: meeting.id, userId: actor(req), type: data.type, content: data.content as object | undefined,
  }});
  res.status(201).json({ data: row });
});

router.put("/meetings/native/:room/whiteboard", async (req: AuthRequest, res) => {
  const room = roomParam.parse(req.params.room);
  const { meeting, participant } = await meetingForRoom(req, room);
  assertActiveMeeting(meeting);
  if (!managerRole(participant.meetingRole)) throw new AppError(403, "MEETING_WHITEBOARD_SAVE_FORBIDDEN", "Host or co-host permission is required to save the whiteboard");
  if (!meeting.allowWhiteboard) throw new AppError(403, "MEETING_WHITEBOARD_DISABLED", "Whiteboard is disabled for this meeting");
  const data = z.object({ strokes: z.array(z.record(z.string(), z.unknown())).max(10000) }).parse(req.body);
  const row = await prisma.meeting.update({ where: { id: meeting.id }, data: { whiteboardData: data.strokes as any } });
  await meetingAudit(req, meeting.id, "SAVE_WHITEBOARD", { strokes: data.strokes.length });
  res.json({ data: { saved: true, updatedAt: row.updatedAt } });
});

router.post("/meetings/native/:room/recording/start", async (req: AuthRequest, res) => {
  const room = roomParam.parse(req.params.room);
  const { meeting, participant } = await meetingForRoom(req, room);
  if (!managerRole(participant.meetingRole)) throw new AppError(403, "MEETING_RECORDING_FORBIDDEN", "Host or co-host permission is required");
  assertActiveMeeting(meeting);
  if (!meeting.allowRecording) throw new AppError(403, "MEETING_RECORDING_DISABLED", "Recording is disabled for this meeting");
  const policy = await assertFeatureEntitled(org(req), "meetings_recording");
  if (policy.enforcementEnabled) {
    const monthlyLimit = policy.plan?.limits["meeting.monthlyRecordingMinutes"];
    if (typeof monthlyLimit === "number") {
      const now = new Date(), monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const used = await prisma.meetingRecording.aggregate({
        where: { organizationId: org(req), createdAt: { gte: monthStart }, status: { not: MeetingRecordingStatus.DELETED } },
        _sum: { durationSeconds: true },
      });
      if (Math.ceil((used._sum.durationSeconds ?? 0) / 60) >= monthlyLimit) throw new AppError(409, "MEETING_RECORDING_LIMIT", `Your monthly meeting recording allowance of ${monthlyLimit} minutes has been reached`);
    }
  }
  if (!livekitRecordingConfigured()) throw new AppError(503, "MEETING_RECORDING_NOT_CONFIGURED", "Meeting recording storage is not configured");
  const active = meeting.recordings.find(r => r.status === MeetingRecordingStatus.STARTING || r.status === MeetingRecordingStatus.RECORDING);
  if (active) throw new AppError(409, "MEETING_RECORDING_ACTIVE", "A recording is already active");
  const key = `meeting-recordings/${org(req)}/${meeting.id}/${Date.now()}.mp4`;
  const storage = livekitRecordingStorage();
  const s3: Record<string, unknown> = { access_key: storage.accessKeyId, secret: storage.secretAccessKey, region: storage.region, bucket: storage.bucket };
  if (storage.endpoint) { s3.endpoint = storage.endpoint; s3.force_path_style = true; }
  const result: any = await livekitEgress("StartEgress", {
    room_name: room,
    template: { layout: "grid" },
    outputs: [{ file: { file_type: "MP4", filepath: key } }],
    storage: { s3 },
  });
  const egressId = result.egress_id ?? result.egressId;
  const retentionDays = policy.enforcementEnabled && typeof policy.plan?.limits["meeting.retentionDays"] === "number"
    ? policy.plan.limits["meeting.retentionDays"]!
    : 90;
  const row = await prisma.meetingRecording.create({ data: {
    organizationId: org(req), meetingId: meeting.id, provider: "LIVEKIT", providerRecordingId: egressId,
    status: MeetingRecordingStatus.STARTING, startedAt: new Date(), storageKey: key, initiatedById: actor(req),
    retentionUntil: new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000),
  }});
  await meetingAudit(req, meeting.id, "START_RECORDING", { recordingId: row.id, egressId });
  res.status(201).json({ data: row });
});

router.post("/meetings/native/:room/recording/stop", async (req: AuthRequest, res) => {
  const room = roomParam.parse(req.params.room);
  const { meeting, participant } = await meetingForRoom(req, room);
  if (!managerRole(participant.meetingRole)) throw new AppError(403, "MEETING_RECORDING_FORBIDDEN", "Host or co-host permission is required");
  const active = meeting.recordings.find(r => (r.status === MeetingRecordingStatus.STARTING || r.status === MeetingRecordingStatus.RECORDING) && r.providerRecordingId);
  if (!active?.providerRecordingId) throw new AppError(409, "MEETING_RECORDING_NOT_ACTIVE", "No active meeting recording was found");
  await livekitEgress("StopEgress", { egress_id: active.providerRecordingId });
  const now = new Date();
  const row = await prisma.meetingRecording.update({ where: { id: active.id }, data: {
    status: MeetingRecordingStatus.PROCESSING, stoppedAt: now,
    durationSeconds: active.startedAt ? Math.max(0, Math.round((now.getTime() - active.startedAt.getTime()) / 1000)) : 0,
  }});
  await meetingAudit(req, meeting.id, "STOP_RECORDING", { recordingId: row.id, egressId: active.providerRecordingId });
  res.json({ data: row });
});

router.get("/meetings/native/:room/recordings/:recordingId", async (req: AuthRequest, res) => {
  const room = roomParam.parse(req.params.room);
  const { meeting } = await meetingForRoom(req, room);
  const recording = await prisma.meetingRecording.findFirst({
    where: { organizationId: org(req), id: String(req.params.recordingId), meetingId: meeting.id, status: { not: MeetingRecordingStatus.DELETED } },
  });
  if (!recording?.storageKey) throw new AppError(404, "MEETING_RECORDING_NOT_FOUND", "Meeting recording is not available");
  const object = await getLiveKitRecordingObject(recording.storageKey);
  if (!object || !(Symbol.asyncIterator in Object(object))) throw new AppError(404, "MEETING_RECORDING_PROCESSING", "Meeting recording is still processing");
  if (recording.status !== MeetingRecordingStatus.AVAILABLE) await prisma.meetingRecording.update({ where: { id: recording.id }, data: { status: MeetingRecordingStatus.AVAILABLE } });
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Disposition", `attachment; filename="meeting-${meeting.id}.mp4"`);
  for await (const chunk of object as AsyncIterable<Uint8Array | string>) res.write(chunk);
  res.end();
});


router.delete("/meetings/native/:room/recordings/:recordingId", async (req: AuthRequest, res) => {
  const room = roomParam.parse(req.params.room);
  const { meeting, participant } = await meetingForRoom(req, room);
  if (!managerRole(participant.meetingRole)) throw new AppError(403, "MEETING_RECORDING_DELETE_FORBIDDEN", "Host or co-host permission is required");
  const recording = await prisma.meetingRecording.findFirst({
    where: { organizationId: org(req), id: String(req.params.recordingId), meetingId: meeting.id, status: { not: MeetingRecordingStatus.DELETED } },
  });
  if (!recording) throw new AppError(404, "MEETING_RECORDING_NOT_FOUND", "Meeting recording not found");
  if (recording.storageKey) await deleteLiveKitRecordingObject(recording.storageKey).catch(() => undefined);
  await prisma.meetingRecording.update({ where: { id: recording.id }, data: { status: MeetingRecordingStatus.DELETED, storageKey: null } });
  await meetingAudit(req, meeting.id, "DELETE_RECORDING", { recordingId: recording.id });
  res.status(204).send();
});

export default router;
