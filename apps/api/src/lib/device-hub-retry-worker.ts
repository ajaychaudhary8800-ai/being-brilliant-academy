import { ConnectedDeviceCommandStatus, ConnectedDeviceEventStatus, DeviceRetryStatus, Prisma } from "@prisma/client";
import { nextRetryState } from "./device-hub-governance.js";
import { processConnectedDeviceEvent } from "./device-hub-processor.js";
import { systemPrisma } from "./prisma.js";

const json = (value: unknown) => value as Prisma.InputJsonValue;

export async function queueDeviceEventRetry(input: {
  organizationId: string;
  deviceId: string;
  eventId: string;
  errorCode?: string;
  errorMessage?: string;
}) {
  const dedupeKey = `event:${input.eventId}`;
  return systemPrisma.connectedDeviceRetryJob.upsert({
    where: { dedupeKey },
    create: {
      organizationId: input.organizationId,
      deviceId: input.deviceId,
      eventId: input.eventId,
      operation: "EVENT_PROCESS",
      dedupeKey,
      status: DeviceRetryStatus.QUEUED,
      maxAttempts: 8,
      nextAttemptAt: new Date(),
      lastErrorCode: input.errorCode ?? "EVENT_PROCESS_FAILED",
      lastErrorMessage: input.errorMessage?.slice(0, 5000) ?? "Device event processing failed",
    },
    update: {
      status: DeviceRetryStatus.QUEUED,
      nextAttemptAt: new Date(),
      lastErrorCode: input.errorCode ?? "EVENT_PROCESS_FAILED",
      lastErrorMessage: input.errorMessage?.slice(0, 5000) ?? "Device event processing failed",
    },
  });
}

async function failRetry(job: {
  id: string;
  attempts: number;
  maxAttempts: number;
}, error: unknown) {
  const state = nextRetryState({ attempts: job.attempts, maxAttempts: job.maxAttempts });
  const message = error instanceof Error ? error.message.slice(0, 5000) : "Device retry failed";
  await systemPrisma.connectedDeviceRetryJob.update({
    where: { id: job.id },
    data: {
      status: state.status,
      attempts: state.attempts,
      nextAttemptAt: state.nextAttemptAt ?? new Date(),
      lastAttemptAt: new Date(),
      lastErrorCode: "RETRY_EXECUTION_FAILED",
      lastErrorMessage: message,
    },
  });
  return state.status;
}

export async function processDueDeviceRetries(limit = 50) {
  const now = new Date();
  const jobs = await systemPrisma.connectedDeviceRetryJob.findMany({
    where: {
      status: DeviceRetryStatus.QUEUED,
      nextAttemptAt: { lte: now },
    },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
  });
  const results: Array<{ id: string; ok: boolean; status: string; operation: string; error?: string }> = [];

  for (const job of jobs) {
    const claimed = await systemPrisma.connectedDeviceRetryJob.updateMany({
      where: { id: job.id, status: DeviceRetryStatus.QUEUED, nextAttemptAt: { lte: now } },
      data: { status: DeviceRetryStatus.PROCESSING, lastAttemptAt: now },
    });
    if (!claimed.count) continue;

    try {
      if (job.operation === "EVENT_PROCESS" && job.eventId) {
        const event = await systemPrisma.connectedDeviceEvent.findFirst({
          where: { id: job.eventId, organizationId: job.organizationId, deviceId: job.deviceId },
          select: { id: true, status: true },
        });
        if (!event) throw new Error("Retry event no longer exists");
        if ([ConnectedDeviceEventStatus.PROCESSED, ConnectedDeviceEventStatus.REJECTED].includes(event.status)) {
          await systemPrisma.connectedDeviceRetryJob.update({
            where: { id: job.id },
            data: { status: DeviceRetryStatus.COMPLETED, lastErrorCode: null, lastErrorMessage: null },
          });
          results.push({ id: job.id, ok: true, status: "COMPLETED", operation: job.operation });
          continue;
        }
        const outcome = await processConnectedDeviceEvent(event.id);
        await systemPrisma.connectedDeviceRetryJob.update({
          where: { id: job.id },
          data: {
            status: DeviceRetryStatus.COMPLETED,
            attempts: { increment: 1 },
            lastErrorCode: null,
            lastErrorMessage: null,
            payload: json({ outcomeStatus: outcome.status }),
          },
        });
        results.push({ id: job.id, ok: true, status: "COMPLETED", operation: job.operation });
        continue;
      }

      if (job.operation === "COMMAND_DELIVERY" && job.commandId) {
        const command = await systemPrisma.connectedDeviceCommand.findFirst({
          where: { id: job.commandId, organizationId: job.organizationId, deviceId: job.deviceId },
          select: { id: true, status: true },
        });
        if (!command) throw new Error("Retry command no longer exists");
        if (command.status === ConnectedDeviceCommandStatus.ACKNOWLEDGED) {
          await systemPrisma.connectedDeviceRetryJob.update({
            where: { id: job.id },
            data: { status: DeviceRetryStatus.COMPLETED, lastErrorCode: null, lastErrorMessage: null },
          });
          results.push({ id: job.id, ok: true, status: "COMPLETED", operation: job.operation });
          continue;
        }
        await systemPrisma.connectedDeviceCommand.update({
          where: { id: command.id },
          data: {
            status: ConnectedDeviceCommandStatus.QUEUED,
            sentAt: null,
            failedAt: null,
          },
        });
        // Keep PROCESSING until the Edge Agent acknowledges or reports failure.
        results.push({ id: job.id, ok: true, status: "PROCESSING", operation: job.operation });
        continue;
      }

      throw new Error(`Unsupported Device Hub retry operation: ${job.operation}`);
    } catch (error) {
      const status = await failRetry(job, error);
      results.push({
        id: job.id,
        ok: false,
        status,
        operation: job.operation,
        error: error instanceof Error ? error.message : "Device retry failed",
      });
    }
  }

  return results;
}
