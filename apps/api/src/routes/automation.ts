import {
  EnquiryStatus,
  FeeStatus,
  HomeworkStatus,
  Prisma,
  Role,
  StudentStatus,
} from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { erpBranchScope } from "../lib/erp-branch-access.js";
import { AppError } from "../lib/http.js";
import {
  automationTriggerType,
  feeOutstanding,
  notificationActionConfig,
  parseTriggerConfig,
  type AutomationTriggerType,
} from "../lib/automation-rule.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { requireCommercialFeature } from "../middleware/commercial-entitlement.js";

const router = Router();
router.use(requireAuth);
router.use(requireCommercialFeature("communication"));

const adminRoles: Role[] = [Role.SUPER_ADMIN, Role.BRANCH_ADMIN];
const id = z.string().cuid();

function requireAdmin(req: AuthRequest) {
  if (!adminRoles.includes(req.auth!.role)) throw new AppError(403, "FORBIDDEN", "Automation management requires an administrator");
}

const createRuleInput = z.object({
  name: z.string().trim().min(2).max(100),
  triggerType: automationTriggerType,
  triggerConfig: z.unknown().optional(),
  actionType: z.literal("NOTIFICATION").default("NOTIFICATION"),
  actionConfig: notificationActionConfig,
  active: z.boolean().default(false),
}).strict();

const updateRuleInput = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  triggerType: automationTriggerType.optional(),
  triggerConfig: z.unknown().optional(),
  actionConfig: notificationActionConfig.optional(),
  active: z.boolean().optional(),
}).strict();

async function getOwnedRule(req: AuthRequest, ruleId: string) {
  const rule = await prisma.automationRule.findFirst({
    where: { id: ruleId, organizationId: req.auth!.organizationId },
  });
  if (!rule) throw new AppError(404, "NOT_FOUND", "Automation rule not found");
  return rule;
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

async function previewRule(req: AuthRequest, triggerType: AutomationTriggerType, triggerConfig: unknown, now: Date) {
  const organizationId = req.auth!.organizationId;
  const branchIds = await erpBranchScope(req);

  if (triggerType === "FEE_OVERDUE") {
    const config = parseTriggerConfig(triggerType, triggerConfig);
    const cutoff = new Date(now.getTime() - config.daysOverdue * 86_400_000);
    const fees = await prisma.fee.findMany({
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
    const matched = fees.map(fee => {
      const balancePaise = feeOutstanding(fee.totalPaise, fee.discountPaise, fee.finePaise, fee.amountPaidPaise);
      const recipients = unique([
        ...(fee.student.user.isActive ? [fee.student.user.id] : []),
        ...fee.student.parents.filter(link => link.parent.isActive).map(link => link.parent.id),
      ]);
      return { fee, balancePaise, recipients };
    }).filter(item => item.balancePaise >= config.minBalancePaise && item.balancePaise > 0);
    return {
      matchedCount: matched.length,
      recipientCount: unique(matched.flatMap(item => item.recipients)).length,
      sample: matched.slice(0, 10).map(item => ({
        entityId: item.fee.id,
        label: item.fee.student.user.name,
        branchId: item.fee.branchId,
        dueAt: item.fee.dueDate,
        balancePaise: item.balancePaise,
        recipientCount: item.recipients.length,
      })),
    };
  }

  if (triggerType === "HOMEWORK_DUE_SOON") {
    const config = parseTriggerConfig(triggerType, triggerConfig);
    const upper = new Date(now.getTime() + config.dueWithinHours * 3_600_000);
    const homeworks = await prisma.homework.findMany({
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
    const students = batchIds.length ? await prisma.studentProfile.findMany({
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
    return {
      matchedCount: homeworks.length,
      recipientCount: unique(homeworks.flatMap(item => byBatch.get(item.batchId) ?? [])).length,
      sample: homeworks.slice(0, 10).map(item => ({
        entityId: item.id,
        label: item.title,
        branchId: item.branchId,
        dueAt: item.dueDate,
        recipientCount: (byBatch.get(item.batchId) ?? []).length,
      })),
    };
  }

  const config = parseTriggerConfig(triggerType, triggerConfig);
  const cutoff = new Date(now.getTime() - config.overdueHours * 3_600_000);
  const enquiries = await prisma.enquiry.findMany({
    where: {
      organizationId,
      branchId: { in: branchIds },
      nextFollowUpAt: { lte: cutoff },
      status: { in: [EnquiryStatus.NEW, EnquiryStatus.CONTACTED, EnquiryStatus.FOLLOW_UP, EnquiryStatus.INTERESTED] },
    },
    select: { id: true, studentName: true, branchId: true, counsellorId: true, nextFollowUpAt: true, priority: true },
    orderBy: { nextFollowUpAt: "asc" },
    take: 500,
  });
  return {
    matchedCount: enquiries.length,
    recipientCount: unique(enquiries.flatMap(item => item.counsellorId ? [item.counsellorId] : [])).length,
    sample: enquiries.slice(0, 10).map(item => ({
      entityId: item.id,
      label: item.studentName,
      branchId: item.branchId,
      dueAt: item.nextFollowUpAt,
      priority: item.priority,
      recipientCount: item.counsellorId ? 1 : 0,
    })),
  };
}

router.get("/automations", async (req: AuthRequest, res) => {
  requireAdmin(req);
  const data = await prisma.automationRule.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: [{ active: "desc" }, { updatedAt: "desc" }],
  });
  res.json({ data });
});

router.post("/automations", async (req: AuthRequest, res) => {
  requireAdmin(req);
  const input = createRuleInput.parse(req.body);
  const triggerConfig = parseTriggerConfig(input.triggerType, input.triggerConfig);
  const created = await prisma.automationRule.create({
    data: {
      organizationId: req.auth!.organizationId,
      createdById: req.auth!.userId,
      name: input.name,
      triggerType: input.triggerType,
      triggerConfig: triggerConfig as Prisma.InputJsonValue,
      actionType: input.actionType,
      actionConfig: input.actionConfig as Prisma.InputJsonValue,
      active: input.active,
    },
  });
  await prisma.auditLog.create({
    data: {
      organizationId: req.auth!.organizationId,
      actorId: req.auth!.userId,
      action: "CREATE",
      entity: "AutomationRule",
      entityId: created.id,
      metadata: { triggerType: created.triggerType, active: created.active },
    },
  });
  res.status(201).json({ data: created });
});

router.patch("/automations/:id", async (req: AuthRequest, res) => {
  requireAdmin(req);
  const existing = await getOwnedRule(req, id.parse(req.params.id));
  const input = updateRuleInput.parse(req.body);
  const triggerType = (input.triggerType ?? existing.triggerType) as AutomationTriggerType;
  const triggerConfig = input.triggerConfig !== undefined || input.triggerType
    ? parseTriggerConfig(triggerType, input.triggerConfig ?? (input.triggerType ? {} : existing.triggerConfig))
    : existing.triggerConfig;
  const updated = await prisma.automationRule.update({
    where: { id: existing.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.triggerType !== undefined ? { triggerType: input.triggerType } : {}),
      ...(triggerConfig !== existing.triggerConfig ? { triggerConfig: triggerConfig as Prisma.InputJsonValue } : {}),
      ...(input.actionConfig !== undefined ? { actionConfig: input.actionConfig as Prisma.InputJsonValue } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
  });
  await prisma.auditLog.create({
    data: {
      organizationId: req.auth!.organizationId,
      actorId: req.auth!.userId,
      action: "UPDATE",
      entity: "AutomationRule",
      entityId: updated.id,
      metadata: { triggerType: updated.triggerType, active: updated.active },
    },
  });
  res.json({ data: updated });
});

router.post("/automations/:id/preview", async (req: AuthRequest, res) => {
  requireAdmin(req);
  const rule = await getOwnedRule(req, id.parse(req.params.id));
  const startedAt = new Date();
  try {
    const preview = await previewRule(req, automationTriggerType.parse(rule.triggerType), rule.triggerConfig, startedAt);
    const finishedAt = new Date();
    const run = await prisma.automationRun.create({
      data: {
        organizationId: req.auth!.organizationId,
        ruleId: rule.id,
        mode: "PREVIEW",
        status: "SUCCESS",
        matchedCount: preview.matchedCount,
        actionCount: 0,
        details: { recipientCount: preview.recipientCount, sample: preview.sample } as Prisma.InputJsonValue,
        startedAt,
        finishedAt,
      },
    });
    await prisma.automationRule.update({ where: { id: rule.id }, data: { lastPreviewAt: finishedAt } });
    await prisma.auditLog.create({
      data: {
        organizationId: req.auth!.organizationId,
        actorId: req.auth!.userId,
        action: "PREVIEW",
        entity: "AutomationRule",
        entityId: rule.id,
        metadata: { matchedCount: preview.matchedCount, recipientCount: preview.recipientCount, runId: run.id },
      },
    });
    res.json({ data: { ...preview, runId: run.id, previewedAt: finishedAt } });
  } catch (error) {
    const finishedAt = new Date();
    await prisma.automationRun.create({
      data: {
        organizationId: req.auth!.organizationId,
        ruleId: rule.id,
        mode: "PREVIEW",
        status: "FAILED",
        error: error instanceof Error ? error.message : "Preview failed",
        startedAt,
        finishedAt,
      },
    });
    throw error;
  }
});

router.get("/automations/:id/runs", async (req: AuthRequest, res) => {
  requireAdmin(req);
  const rule = await getOwnedRule(req, id.parse(req.params.id));
  const data = await prisma.automationRun.findMany({
    where: { organizationId: req.auth!.organizationId, ruleId: rule.id },
    orderBy: { startedAt: "desc" },
    take: 20,
  });
  res.json({ data });
});

export default router;
