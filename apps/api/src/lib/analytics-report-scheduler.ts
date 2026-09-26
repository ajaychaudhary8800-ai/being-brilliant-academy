import { Role } from "@prisma/client";
import type { AuthRequest } from "../middleware/auth.js";
import { renderSavedAnalyticsReport } from "../routes/analytics.js";
import { logger } from "./logger.js";
import { providerStatus, sendEmail } from "./notifications.js";
import { systemPrisma } from "./prisma.js";
import { tenantContext } from "./tenant-context.js";
import { nextReportRun } from "./report-schedule-time.js";
import { assertFeatureEntitled } from "./saas-commercial.js";

export async function deliverScheduledAnalyticsReports(now = new Date()) {
  const due = await systemPrisma.analyticsReportSchedule.findMany({
    where: { active: true, nextRunAt: { lte: now }, report: { isArchived: false, deletedAt: null } },
    include: { report: { include: { owner: true } } },
    orderBy: { nextRunAt: "asc" }, take: 10,
  });
  for (const schedule of due) {
    try {
      const advanceTo = nextReportRun(schedule, now);
      const claimed = await systemPrisma.analyticsReportSchedule.updateMany({
        where: { id: schedule.id, organizationId: schedule.organizationId, active: true, nextRunAt: schedule.nextRunAt },
        data: { nextRunAt: advanceTo, lastRunAt: now, lastStatus: "PROCESSING" },
      });
      if (!claimed.count) continue;
      const owner = schedule.report.owner;
      const organization = await systemPrisma.organization.findFirst({ where: { id: schedule.organizationId, isActive: true, deletedAt: null } });
      const subscriptionValid = organization && (organization.subscriptionStatus === "ACTIVE" || organization.subscriptionStatus === "TRIAL" && (!organization.trialEndsAt || organization.trialEndsAt > now)) && (!organization.subscriptionEndsAt || organization.subscriptionEndsAt > now);
      if (!subscriptionValid || !owner.isActive || owner.organizationId !== schedule.organizationId || (owner.role !== Role.SUPER_ADMIN && owner.role !== Role.BRANCH_ADMIN)) throw new Error("Report owner no longer has access");
      await assertFeatureEntitled(schedule.organizationId, "analytics");
      if (!providerStatus().email) throw new Error("SMTP_NOT_CONFIGURED");
      const format = schedule.format.toLowerCase();
      if (format !== "csv" && format !== "excel" && format !== "pdf") throw new Error("Unsupported report format");
      const principal = { auth: { userId: owner.id, role: owner.role, organizationId: schedule.organizationId, homeOrganizationId: owner.organizationId } } as AuthRequest;
      const result = await tenantContext.run({ organizationId: schedule.organizationId, userId: owner.id, role: owner.role }, () => renderSavedAnalyticsReport(principal, schedule.report, format));
      if (result.content.byteLength > 5_000_000) throw new Error("Report attachment exceeds 5 MB");
      const attachment = { filename: `report-${schedule.reportId}.${result.extension}`, content: result.content, contentType: result.contentType };
      for (const recipient of schedule.recipients) {
        const sent = await sendEmail(recipient, `Analytics report: ${schedule.report.name}`, `Your scheduled report is attached. Generated ${now.toISOString()}.`, attachment);
        if (sent.skipped) throw new Error(sent.reason);
      }
      await systemPrisma.analyticsReportSchedule.updateMany({ where: { id: schedule.id, organizationId: schedule.organizationId, lastRunAt: now }, data: { lastStatus: "SENT" } });
      await systemPrisma.auditLog.create({ data: { organizationId: schedule.organizationId, actorId: owner.id, action: "SCHEDULED_EXPORT", entity: "AnalyticsSavedReport", entityId: schedule.reportId, metadata: { format, recipients: schedule.recipients.length, rows: result.rows } } });
    } catch (error) {
      await systemPrisma.analyticsReportSchedule.updateMany({ where: { id: schedule.id, organizationId: schedule.organizationId, lastRunAt: now }, data: { lastStatus: "FAILED" } });
      logger.error({ err: error, scheduleId: schedule.id }, "Scheduled analytics report delivery failed");
    }
  }
  return due.length;
}
