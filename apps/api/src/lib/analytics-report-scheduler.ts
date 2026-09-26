import { Role, type Prisma } from "@prisma/client";
import type { AuthRequest } from "../middleware/auth.js";
import { renderSavedAnalyticsReport } from "../routes/analytics.js";
import { logger } from "./logger.js";
import { providerStatus, sendEmail } from "./notifications.js";
import { systemPrisma } from "./prisma.js";
import { type DeliveryStatus, summarizeDelivery, type RecipientDeliveryResult } from "./report-delivery-results.js";
import { nextReportRun } from "./report-schedule-time.js";
import { assertFeatureEntitled } from "./saas-commercial.js";
import { tenantContext } from "./tenant-context.js";

type LoadedSchedule = Prisma.AnalyticsReportScheduleGetPayload<{ include: { report: { include: { owner: true } } } }>;
export type ReportDeliveryTrigger = "SCHEDULED" | "MANUAL" | "RETRY";

type DeliveryOutcome = {
  status: DeliveryStatus | "PROCESSING";
  recipientResults: RecipientDeliveryResult[];
  rows?: number;
  busy?: boolean;
};

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Report delivery failed";
}

async function recordDelivery(schedule: LoadedSchedule, trigger: ReportDeliveryTrigger, status: DeliveryStatus, recipientResults: RecipientDeliveryResult[], now: Date, rows?: number) {
  await systemPrisma.auditLog.create({
    data: {
      organizationId: schedule.organizationId,
      actorId: schedule.report.owner.id,
      action: "ANALYTICS_REPORT_DELIVERY",
      entity: "AnalyticsReportSchedule",
      entityId: schedule.id,
      metadata: {
        trigger,
        status,
        reportId: schedule.reportId,
        format: schedule.format,
        rows: rows ?? null,
        recipients: recipientResults.length,
        recipientResults,
        deliveredAt: now.toISOString(),
      },
    },
  });
}

async function deliverLoadedSchedule(schedule: LoadedSchedule, now: Date, trigger: ReportDeliveryTrigger, recipients: string[]): Promise<DeliveryOutcome> {
  let rows: number | undefined;
  try {
    const owner = schedule.report.owner;
    const organization = await systemPrisma.organization.findFirst({ where: { id: schedule.organizationId, isActive: true, deletedAt: null } });
    const subscriptionValid = organization &&
      (organization.subscriptionStatus === "ACTIVE" ||
        organization.subscriptionStatus === "TRIAL" && (!organization.trialEndsAt || organization.trialEndsAt > now)) &&
      (!organization.subscriptionEndsAt || organization.subscriptionEndsAt > now);
    if (!subscriptionValid || !owner.isActive || owner.organizationId !== schedule.organizationId || (owner.role !== Role.SUPER_ADMIN && owner.role !== Role.BRANCH_ADMIN)) {
      throw new Error("Report owner no longer has access");
    }
    await assertFeatureEntitled(schedule.organizationId, "analytics");
    if (!providerStatus().email) throw new Error("SMTP_NOT_CONFIGURED");

    const format = schedule.format.toLowerCase();
    if (format !== "csv" && format !== "excel" && format !== "pdf") throw new Error("Unsupported report format");

    const principal = { auth: { userId: owner.id, role: owner.role, organizationId: schedule.organizationId, homeOrganizationId: owner.organizationId } } as AuthRequest;
    const result = await tenantContext.run(
      { organizationId: schedule.organizationId, userId: owner.id, role: owner.role },
      () => renderSavedAnalyticsReport(principal, schedule.report, format),
    );
    rows = result.rows;
    if (result.content.byteLength > 5_000_000) throw new Error("Report attachment exceeds 5 MB");

    const attachment = { filename: `report-${schedule.reportId}.${result.extension}`, content: result.content, contentType: result.contentType };
    const recipientResults: RecipientDeliveryResult[] = [];
    for (const recipient of [...new Set(recipients)]) {
      try {
        const sent = await sendEmail(recipient, `Analytics report: ${schedule.report.name}`, `Your scheduled report is attached. Generated ${now.toISOString()}.`, attachment);
        if (sent.skipped) throw new Error(sent.reason);
        recipientResults.push({ recipient, status: "SENT", messageId: sent.messageId });
      } catch (error) {
        recipientResults.push({ recipient, status: "FAILED", error: errorText(error) });
      }
    }

    const status = summarizeDelivery(recipientResults);
    await systemPrisma.analyticsReportSchedule.updateMany({
      where: { id: schedule.id, organizationId: schedule.organizationId, lastRunAt: now },
      data: { lastStatus: status },
    });
    await recordDelivery(schedule, trigger, status, recipientResults, now, rows);
    if (status !== "SENT") logger.warn({ scheduleId: schedule.id, status, recipientResults }, "Analytics report delivery was not fully successful");
    return { status, recipientResults, rows };
  } catch (error) {
    const message = errorText(error);
    const recipientResults = [...new Set(recipients)].map(recipient => ({ recipient, status: "FAILED" as const, error: message }));
    await systemPrisma.analyticsReportSchedule.updateMany({
      where: { id: schedule.id, organizationId: schedule.organizationId, lastRunAt: now },
      data: { lastStatus: "FAILED" },
    });
    await recordDelivery(schedule, trigger, "FAILED", recipientResults, now, rows);
    logger.error({ err: error, scheduleId: schedule.id, trigger }, "Analytics report delivery failed");
    return { status: "FAILED", recipientResults, rows };
  }
}

export async function deliverAnalyticsReportScheduleNow(
  scheduleId: string,
  organizationId: string,
  trigger: Exclude<ReportDeliveryTrigger, "SCHEDULED">,
  recipients?: string[],
  now = new Date(),
): Promise<DeliveryOutcome | null> {
  const schedule = await systemPrisma.analyticsReportSchedule.findFirst({
    where: { id: scheduleId, organizationId, report: { isArchived: false, deletedAt: null } },
    include: { report: { include: { owner: true } } },
  });
  if (!schedule) return null;

  const staleBefore = new Date(now.getTime() - 10 * 60_000);
  const claimed = await systemPrisma.analyticsReportSchedule.updateMany({
    where: {
      id: schedule.id,
      organizationId,
      OR: [
        { lastStatus: { not: "PROCESSING" } },
        { lastStatus: null },
        { lastRunAt: { lt: staleBefore } },
      ],
    },
    data: { lastRunAt: now, lastStatus: "PROCESSING" },
  });
  if (!claimed.count) return { status: "PROCESSING", recipientResults: [], busy: true };

  const targets = recipients?.length ? recipients : schedule.recipients;
  return deliverLoadedSchedule(schedule, now, trigger, targets);
}

export async function deliverScheduledAnalyticsReports(now = new Date()) {
  const due = await systemPrisma.analyticsReportSchedule.findMany({
    where: { active: true, nextRunAt: { lte: now }, report: { isArchived: false, deletedAt: null } },
    include: { report: { include: { owner: true } } },
    orderBy: { nextRunAt: "asc" },
    take: 10,
  });

  for (const schedule of due) {
    try {
      const advanceTo = nextReportRun(schedule, now);
      const claimed = await systemPrisma.analyticsReportSchedule.updateMany({
        where: { id: schedule.id, organizationId: schedule.organizationId, active: true, nextRunAt: schedule.nextRunAt },
        data: { nextRunAt: advanceTo, lastRunAt: now, lastStatus: "PROCESSING" },
      });
      if (!claimed.count) continue;
      await deliverLoadedSchedule(schedule, now, "SCHEDULED", schedule.recipients);
    } catch (error) {
      await systemPrisma.analyticsReportSchedule.updateMany({
        where: { id: schedule.id, organizationId: schedule.organizationId, lastRunAt: now },
        data: { lastStatus: "FAILED" },
      });
      logger.error({ err: error, scheduleId: schedule.id }, "Scheduled analytics report delivery failed");
    }
  }
  return due.length;
}
