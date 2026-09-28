import crypto from "node:crypto";
import { MeetingAttendanceStatus, MeetingStatus } from "@prisma/client";
import { Router } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { env } from "../config.js";
import { AppError } from "../lib/http.js";
import { systemPrisma } from "../lib/prisma.js";

const router = Router();

type LiveKitWebhookEvent = {
  id?: string;
  event?: string;
  createdAt?: number;
  room?: { name?: string };
  participant?: { identity?: string };
};

function verifyWebhook(body: Buffer, authorization?: string) {
  if (!env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
    throw new AppError(503, "LIVEKIT_NOT_CONFIGURED", "LiveKit is not configured");
  }
  const token = authorization?.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new AppError(401, "LIVEKIT_WEBHOOK_AUTH_REQUIRED", "LiveKit webhook authorization is required");
  let claims: JwtPayload & { sha256?: string };
  try {
    claims = jwt.verify(token, env.LIVEKIT_API_SECRET, { algorithms: ["HS256"] }) as JwtPayload & { sha256?: string };
  } catch {
    throw new AppError(401, "LIVEKIT_WEBHOOK_AUTH_INVALID", "LiveKit webhook signature is invalid");
  }
  if (claims.iss !== env.LIVEKIT_API_KEY) throw new AppError(401, "LIVEKIT_WEBHOOK_ISSUER_INVALID", "LiveKit webhook issuer is invalid");
  const expected = crypto.createHash("sha256").update(body).digest("base64");
  const supplied = claims.sha256 ?? "";
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  if (expectedBuffer.length !== suppliedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)) {
    throw new AppError(401, "LIVEKIT_WEBHOOK_HASH_INVALID", "LiveKit webhook payload hash is invalid");
  }
}

async function closeAttendanceSession(attendanceId: string, now: Date) {
  const session = await systemPrisma.meetingAttendanceSession.findFirst({
    where: { attendanceId, leftAt: null },
    orderBy: { joinedAt: "desc" },
  });
  if (!session) return false;
  const seconds = Math.max(0, Math.floor((now.getTime() - session.joinedAt.getTime()) / 1000));
  await systemPrisma.$transaction([
    systemPrisma.meetingAttendanceSession.update({ where: { id: session.id }, data: { leftAt: now, durationSeconds: seconds } }),
    systemPrisma.meetingAttendance.update({
      where: { id: attendanceId },
      data: { lastLeftAt: now, totalDurationSeconds: { increment: seconds }, status: MeetingAttendanceStatus.PARTIAL },
    }),
  ]);
  return true;
}

async function finalizeMeeting(meetingId: string, now: Date) {
  const meeting = await systemPrisma.meeting.findUnique({
    where: { id: meetingId },
    include: { attendances: { include: { sessions: { where: { leftAt: null } } } } },
  });
  if (!meeting) return;
  for (const attendance of meeting.attendances) {
    for (const session of attendance.sessions) {
      const seconds = Math.max(0, Math.floor((now.getTime() - session.joinedAt.getTime()) / 1000));
      await systemPrisma.meetingAttendanceSession.update({ where: { id: session.id }, data: { leftAt: now, durationSeconds: seconds } });
      await systemPrisma.meetingAttendance.update({
        where: { id: attendance.id },
        data: { lastLeftAt: now, totalDurationSeconds: { increment: seconds } },
      });
    }
  }
  const durationSeconds = Math.max(1, Math.floor((meeting.endsAt.getTime() - meeting.startsAt.getTime()) / 1000));
  const attendanceRows = await systemPrisma.meetingAttendance.findMany({ where: { meetingId } });
  for (const attendance of attendanceRows) {
    const status = attendance.totalDurationSeconds >= durationSeconds * 0.8
      ? MeetingAttendanceStatus.PRESENT
      : attendance.totalDurationSeconds > 0
        ? MeetingAttendanceStatus.PARTIAL
        : MeetingAttendanceStatus.ABSENT;
    await systemPrisma.meetingAttendance.update({ where: { id: attendance.id }, data: { status } });
  }
  if ([MeetingStatus.LIVE, MeetingStatus.OPEN_FOR_JOIN].includes(meeting.status)) {
    await systemPrisma.meeting.update({
      where: { id: meeting.id },
      data: { status: MeetingStatus.MINUTES_PENDING, roomStatus: "ENDED", endedAt: meeting.endedAt ?? now, roomLocked: true },
    });
  }
}

router.post("/", async (req, res) => {
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}));
  verifyWebhook(body, req.get("authorization") ?? undefined);
  let event: LiveKitWebhookEvent;
  try {
    event = JSON.parse(body.toString("utf8")) as LiveKitWebhookEvent;
  } catch {
    throw new AppError(400, "LIVEKIT_WEBHOOK_JSON_INVALID", "LiveKit webhook payload is invalid JSON");
  }
  const roomName = event.room?.name;
  if (!roomName?.startsWith("mtg-")) return res.status(204).send();
  const meeting = await systemPrisma.meeting.findFirst({ where: { livekitRoomName: roomName }, select: { id: true, organizationId: true, status: true } });
  if (!meeting) return res.status(204).send();

  const now = event.createdAt ? new Date(event.createdAt * 1000) : new Date();
  const identity = event.participant?.identity;
  if (event.event === "participant_joined" && identity) {
    const participant = await systemPrisma.meetingParticipant.findFirst({
      where: { organizationId: meeting.organizationId, meetingId: meeting.id, userId: identity, removedAt: null },
      include: { attendance: true },
    });
    if (participant?.attendance) {
      const open = await systemPrisma.meetingAttendanceSession.findFirst({ where: { attendanceId: participant.attendance.id, leftAt: null } });
      if (!open) {
        await systemPrisma.$transaction([
          systemPrisma.meetingAttendanceSession.create({
            data: { organizationId: meeting.organizationId, attendanceId: participant.attendance.id, joinedAt: now, source: "LIVEKIT_WEBHOOK" },
          }),
          systemPrisma.meetingAttendance.update({
            where: { id: participant.attendance.id },
            data: { firstJoinedAt: participant.attendance.firstJoinedAt ?? now, joinCount: { increment: 1 }, status: MeetingAttendanceStatus.PARTIAL },
          }),
        ]);
      }
      await systemPrisma.meetingAuditLog.create({
        data: { organizationId: meeting.organizationId, meetingId: meeting.id, actorUserId: identity, action: "LIVEKIT_PARTICIPANT_JOINED", entityType: "MeetingParticipant", entityId: participant.id, metadata: { providerEventId: event.id } },
      });
    }
  } else if (event.event === "participant_left" && identity) {
    const participant = await systemPrisma.meetingParticipant.findFirst({
      where: { organizationId: meeting.organizationId, meetingId: meeting.id, userId: identity },
      include: { attendance: true },
    });
    if (participant?.attendance) {
      const closed = await closeAttendanceSession(participant.attendance.id, now);
      if (closed) await systemPrisma.meetingAuditLog.create({
        data: { organizationId: meeting.organizationId, meetingId: meeting.id, actorUserId: identity, action: "LIVEKIT_PARTICIPANT_LEFT", entityType: "MeetingParticipant", entityId: participant.id, metadata: { providerEventId: event.id } },
      });
    }
  } else if (event.event === "room_finished") {
    await finalizeMeeting(meeting.id, now);
    await systemPrisma.meetingAuditLog.create({
      data: { organizationId: meeting.organizationId, meetingId: meeting.id, actorUserId: "livekit-provider", action: "LIVEKIT_ROOM_FINISHED", entityType: "Meeting", entityId: meeting.id, metadata: { providerEventId: event.id } },
    });
  }
  res.status(204).send();
});

export default router;
