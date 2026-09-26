import {
  EnquiryStatus,
  FeeStatus,
  HomeworkStatus,
  Prisma,
  Role,
  StudentStatus,
  type AutomationRule,
} from "@prisma/client";
import { notificationActionConfig, parseTriggerConfig, feeOutstanding, automationTriggerType, type AutomationTriggerType } from "./automation-rule.js";
import { assertFeatureEntitled } from "./saas-commercial.js";
import { systemPrisma } from "./prisma.js";

export type AutomationMatch = {
  entityId: string;
  label: string;
  branchId: string;
  dueAt?: Date | null;
  balancePaise?: number;
  recipients: string[];
};

type Preference = {
  inApp: boolean;
  email: boolean;
};

export function effectiveAutomationChannels(channels: string[], preference?: Preference | null) {
  return channels.filter(channel => {
    if (channel === "IN_APP") return preference?.inApp !== false;
    if (channel === "EMAIL") return preference?.email !== false;
    return false;
  });
}

export function nextAutomationEligibility(now: Date, cooldownMinutes: number) {
  return new Date(now.getTime() + cooldownMinutes * 60_000);
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

export async function automationBranchScopeForOwner(organizationId: string, createdById: string) {
  const owner = await systemPrisma.user.findFirst({
    where: { organizationId, id: createdById, isActive: true },
    select: { role: true },
  });
  if (!owner || (owner.role !== Role.SUPER_ADMIN && owner.role !== Role.BRANCH_ADMIN)) return [];
  if (owner.role === Role.SUPER_ADMIN) {
    const branches = await systemPrisma.branch.findMany({
      where: { organizationId, isActive: true },
      select: { id: true },
    });
    return branches.map(branch => branch.id);
  }
  const assignments = await systemPrisma.branchUser.findMany({
    where: {
      organizationId,
      userId: createdById,
      branch: { organizationId, isActive: true },
    },
    select: { branchId: true },
  });
  return unique(assignments.map(item => item.branchId));
}

export async function collectAutomationMatches(
  organizationId: string,
  branchIds: string[],
  triggerType: AutomationTriggerType,
  triggerConfig: unknown,
  now: Date,
): Promise<AutomationMatch[]> {
  if (!branchIds.length) return [];

  if (triggerType === "FEE_OVERDUE") {
    const config = parseTriggerConfig(triggerType, triggerConfig);
    const cutoff = new Date(now.getTime() - config.daysOverdue * 86_400_000);
    const fees = await systemPrisma.fee.findMany({
      where: {
        organizationId,
        branchId: { in: branchIds },
        dueDate: { lte: cutoff },
        status: { in: [FeeStatus.PENDING, FeeStatus.PARTIAL, FeeStatus.OVERDUE] },
      },
      include: {
        student: {
          include: {
            user: { select: { id: true, name: true, isActive: true } },
            parents: { include: { parent: { select: { id: true, isActive: true } } } },
          },
        },
      },
      orderBy: { dueDate: "asc" },
      take: 500,
    });
    return fees.map(fee => {
      const balancePaise = feeOutstanding(fee.totalPaise, fee.discountPaise, fee.finePaise, fee.amountPaidPaise);
      return {
        entityId: fee.id,
        label: fee.student.user.name,
        branchId: fee.branchId,
        dueAt: fee.dueDate,
        balancePaise,
        recipients: unique([
          ...(fee.student.user.isActive ? [fee.student.user.id] : []),
          ...fee.student.parents.filter(link => link.parent.isActive).map(link => link.parent.id),
        ]),
      };
    }).filter(item => item.balancePaise >= config.minBalancePaise && item.balancePaise > 0);
  }

  if (triggerType === "HOMEWORK_DUE_SOON") {
    const config = parseTriggerConfig(triggerType, triggerConfig);
    const upper = new Date(now.getTime() + config.dueWithinHours * 3_600_000);
    const homeworks = await systemPrisma.homework.findMany({
      where: {
        organizationId,
        branchId: { in: branchIds },
        status: HomeworkStatus.PUBLISHED,
        dueDate: { gte: now, lte: upper },
      },
      select: { id: true, title: true, batchId: true, branchId: true, dueDate: true },
      orderBy: { dueDate: "asc" },
      take: 200,
    });
    const batchIds = unique(homeworks.map(item => item.batchId));
    const students = batchIds.length ? await systemPrisma.studentProfile.findMany({
      where: { organizationId, batchId: { in: batchIds }, status: StudentStatus.ACTIVE },
      include: {
        user: { select: { id: true, isActive: true } },
        parents: { include: { parent: { select: { id: true, isActive: true } } } },
      },
    }) : [];
    const byBatch = new Map<string, string[]>();
    for (const student of students) {
      const recipients = unique([
        ...(student.user.isActive ? [student.user.id] : []),
        ...student.parents.filter(link => link.parent.isActive).map(link => link.parent.id),
      ]);
      byBatch.set(student.batchId, unique([...(byBatch.get(student.batchId) ?? []), ...recipients]));
    }
    return homeworks.map(item => ({
      entityId: item.id,
      label: item.title,
      branchId: item.branchId,
      dueAt: item.dueDate,
      recipients: byBatch.get(item.batchId) ?? [],
    }));
  }

  const config = parseTriggerConfig(triggerType, triggerConfig);
  const cutoff = new Date(now.getTime() - config.overdueHours * 3_600_000);
  const enquiries = await systemPrisma.enquiry.findMany({
    where: {
      organizationId,
      branchId: { in: branchIds },
      nextFollowUpAt: { lte: cutoff },
      status: { in: [EnquiryStatus.NEW, EnquiryStatus.CONTACTED, EnquiryStatus.FOLLOW_UP, EnquiryStatus.INTERESTED] },
    },
    select: { id: true, studentName: true, branchId: true, counsellorId: true, nextFollowUpAt: true },
    orderBy: { nextFollowUpAt: "asc" },
    take: 500,
  });
  return enquiries.map(item => ({
    entityId: item.id,
    label: item.studentName,
    branchId: item.branchId,
    dueAt: item.nextFollowUpAt,
    recipients: item.counsellorId ? [item.counsellorId] : [],
  }));
}

function notificationPriority(triggerType: AutomationTriggerType) {
  return triggerType === "FEE_OVERDUE" ? "HIGH" : "NORMAL";
}

async function dispatchRecipient(
  rule: AutomationRule,
  match: AutomationMatch,
  recipientId: string,
  channels: string[],
  title: string,
  body: string,
  now: Date,
) {
  const nextEligibleAt = nextAutomationEligibility(now, rule.cooldownMinutes);
  try {
    return await systemPrisma.$transaction(async tx => {
      const key = {
        organizationId: rule.organizationId,
        ruleId: rule.id,
        entityId: match.entityId,
        recipientId,
      };
      const existing = await tx.automationDispatch.findUnique({
        where: { organizationId_ruleId_entityId_recipientId: key },
      });

      if (existing && existing.nextEligibleAt > now) return { sent: false, reason: "COOLDOWN" as const };

      if (existing) {
        const claim = await tx.automationDispatch.updateMany({
          where: { id: existing.id, organizationId: rule.organizationId, nextEligibleAt: { lte: now } },
          data: { nextEligibleAt, lastSentAt: now },
        });
        if (!claim.count) return { sent: false, reason: "COOLDOWN" as const };
      } else {
        await tx.automationDispatch.create({
          data: {
            organizationId: rule.organizationId,
            ruleId: rule.id,
            entityId: match.entityId,
            recipientId,
            nextEligibleAt,
            lastSentAt: now,
          },
        });
      }

      const notification = await tx.notification.create({
        data: {
          organizationId: rule.organizationId,
          userId: recipientId,
          title,
          body,
          category: "WORKFLOW_AUTOMATION",
          sourceModule: "AUTOMATION",
          sourceEntityId: match.entityId,
          priority: notificationPriority(automationTriggerType.parse(rule.triggerType)),
          channels,
        },
      });
      const deliveries = channels.filter(channel => channel !== "IN_APP");
      if (deliveries.length) {
        await tx.notificationDelivery.createMany({
          data: deliveries.map(channel => ({
            organizationId: rule.organizationId,
            notificationId: notification.id,
            channel,
            status: "QUEUED",
          })),
        });
      }
      await tx.automationDispatch.update({
        where: { organizationId_ruleId_entityId_recipientId: key },
        data: { notificationId: notification.id },
      });
      return { sent: true, notificationId: notification.id };
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return { sent: false, reason: "DEDUPED" as const };
    throw error;
  }
}

export type AutomationExecutionResult = {
  runId: string | null;
  status: "SUCCESS" | "PARTIAL" | "FAILED";
  matchedCount: number;
  actionCount: number;
  recipientCount: number;
  cooldownSkipped: number;
  preferenceSkipped: number;
  errorCount: number;
};

export async function executeAutomationRule(
  ruleId: string,
  now = new Date(),
  options: { actorId?: string | null; mode?: "MANUAL" | "EXECUTION" } = {},
): Promise<AutomationExecutionResult> {
  const rule = await systemPrisma.automationRule.findUnique({ where: { id: ruleId } });
  if (!rule) throw new Error("Automation rule not found");
  if (!rule.active) throw new Error("Automation rule is paused");

  await assertFeatureEntitled(rule.organizationId, "communication");

  const branchIds = await automationBranchScopeForOwner(rule.organizationId, rule.createdById);
  if (!branchIds.length) throw new Error("Automation owner no longer has access to an active branch");

  const triggerType = automationTriggerType.parse(rule.triggerType);
  const action = notificationActionConfig.parse(rule.actionConfig);
  const matches = await collectAutomationMatches(rule.organizationId, branchIds, triggerType, rule.triggerConfig, now);
  const allRecipientIds = unique(matches.flatMap(match => match.recipients));

  const [users, preferences] = await Promise.all([
    allRecipientIds.length ? systemPrisma.user.findMany({
      where: { organizationId: rule.organizationId, id: { in: allRecipientIds }, isActive: true },
      select: { id: true },
    }) : Promise.resolve([]),
    allRecipientIds.length ? systemPrisma.notificationPreference.findMany({
      where: { organizationId: rule.organizationId, userId: { in: allRecipientIds } },
      select: { userId: true, inApp: true, email: true },
    }) : Promise.resolve([]),
  ]);
  const activeUsers = new Set(users.map(user => user.id));
  const preferenceByUser = new Map(preferences.map(preference => [preference.userId, preference]));

  let actionCount = 0;
  let cooldownSkipped = 0;
  let preferenceSkipped = 0;
  const errors: string[] = [];

  for (const match of matches) {
    for (const recipientId of unique(match.recipients)) {
      if (!activeUsers.has(recipientId)) {
        preferenceSkipped += 1;
        continue;
      }
      const channels = effectiveAutomationChannels(action.channels, preferenceByUser.get(recipientId));
      if (!channels.length) {
        preferenceSkipped += 1;
        continue;
      }
      try {
        const result = await dispatchRecipient(rule, match, recipientId, channels, action.title, action.body, now);
        if (result.sent) actionCount += 1;
        else cooldownSkipped += 1;
      } catch (error) {
        errors.push(error instanceof Error ? error.message.slice(0, 300) : "Notification creation failed");
      }
    }
  }

  const status: AutomationExecutionResult["status"] = errors.length
    ? actionCount > 0 ? "PARTIAL" : "FAILED"
    : "SUCCESS";
  const finishedAt = new Date();

  if ((options.mode ?? "EXECUTION") === "EXECUTION" && actionCount === 0 && errors.length === 0) {
    await systemPrisma.automationRule.update({
      where: { id: rule.id },
      data: { lastRunAt: finishedAt },
    });
    return {
      runId: null,
      status,
      matchedCount: matches.length,
      actionCount,
      recipientCount: allRecipientIds.length,
      cooldownSkipped,
      preferenceSkipped,
      errorCount: 0,
    };
  }

  const run = await systemPrisma.automationRun.create({
    data: {
      organizationId: rule.organizationId,
      ruleId: rule.id,
      mode: options.mode ?? "EXECUTION",
      status,
      matchedCount: matches.length,
      actionCount,
      details: {
        recipientCount: allRecipientIds.length,
        cooldownSkipped,
        preferenceSkipped,
        errorCount: errors.length,
        errors: errors.slice(0, 10),
        sample: matches.slice(0, 10).map(match => ({
          entityId: match.entityId,
          label: match.label,
          branchId: match.branchId,
          dueAt: match.dueAt,
          balancePaise: match.balancePaise,
          recipientCount: match.recipients.length,
        })),
      } as Prisma.InputJsonValue,
      error: errors.length ? errors[0] : null,
      startedAt: now,
      finishedAt,
    },
  });
  await systemPrisma.automationRule.update({
    where: { id: rule.id },
    data: { lastRunAt: finishedAt },
  });
  await systemPrisma.auditLog.create({
    data: {
      organizationId: rule.organizationId,
      actorId: options.actorId ?? null,
      action: "AUTOMATION_EXECUTION",
      entity: "AutomationRule",
      entityId: rule.id,
      metadata: {
        mode: options.mode ?? "EXECUTION",
        status,
        matchedCount: matches.length,
        actionCount,
        cooldownSkipped,
        preferenceSkipped,
        errorCount: errors.length,
        runId: run.id,
      },
    },
  });

  return {
    runId: run.id,
    status,
    matchedCount: matches.length,
    actionCount,
    recipientCount: allRecipientIds.length,
    cooldownSkipped,
    preferenceSkipped,
    errorCount: errors.length,
  };
}

export async function executeActiveAutomations(now = new Date()) {
  const rules = await systemPrisma.automationRule.findMany({
    where: { active: true },
    select: { id: true },
    orderBy: { updatedAt: "asc" },
    take: 250,
  });
  const results: Array<{ ruleId: string; ok: boolean; result?: AutomationExecutionResult; error?: string }> = [];
  for (const rule of rules) {
    try {
      results.push({ ruleId: rule.id, ok: true, result: await executeAutomationRule(rule.id, now, { mode: "EXECUTION" }) });
    } catch (error) {
      results.push({ ruleId: rule.id, ok: false, error: error instanceof Error ? error.message.slice(0, 300) : "Automation execution failed" });
    }
  }
  return results;
}
