import { Prisma, Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/http.js";
import {
  automationTriggerType,
  automationCooldownMinutes,
  notificationActionConfig,
  parseTriggerConfig,
  type AutomationTriggerType,
} from "../lib/automation-rule.js";
import { prisma } from "../lib/prisma.js";
import { automationBranchScopeForOwner, collectAutomationMatches, executeAutomationRule } from "../lib/automation-executor.js";
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
  cooldownMinutes: automationCooldownMinutes.default(1440),
  active: z.boolean().default(false),
}).strict();

const updateRuleInput = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  triggerType: automationTriggerType.optional(),
  triggerConfig: z.unknown().optional(),
  actionConfig: notificationActionConfig.optional(),
  cooldownMinutes: automationCooldownMinutes.optional(),
  active: z.boolean().optional(),
}).strict();

async function getOwnedRule(req: AuthRequest, ruleId: string) {
  const rule = await prisma.automationRule.findFirst({
    where: {
      id: ruleId,
      organizationId: req.auth!.organizationId,
      ...(req.auth!.role === Role.BRANCH_ADMIN ? { createdById: req.auth!.userId } : {}),
    },
  });
  if (!rule) throw new AppError(404, "NOT_FOUND", "Automation rule not found");
  return rule;
}

router.get("/automations", async (req: AuthRequest, res) => {
  requireAdmin(req);
  const data = await prisma.automationRule.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      ...(req.auth!.role === Role.BRANCH_ADMIN ? { createdById: req.auth!.userId } : {}),
    },
    orderBy: [{ active: "desc" }, { updatedAt: "desc" }],
  });
  res.json({ data });
});

const deliveryAuditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(100).optional(),
  channel: z.enum(["IN_APP", "EMAIL"]).optional(),
  status: z.enum(["CREATED", "QUEUED", "PROCESSING", "SENT", "FAILED", "DEAD_LETTER", "SKIPPED"]).optional(),
});

router.get("/automations/deliveries", async (req: AuthRequest, res) => {
  requireAdmin(req);
  const query = deliveryAuditQuery.parse(req.query);
  const dispatches = await prisma.automationDispatch.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      notificationId: { not: null },
      ...(req.auth!.role === Role.BRANCH_ADMIN ? { rule: { createdById: req.auth!.userId } } : {}),
    },
    include: {
      rule: { select: { id: true, name: true, triggerType: true } },
    },
    orderBy: [{ lastSentAt: "desc" }, { createdAt: "desc" }],
    take: 500,
  });

  const notificationIds = [...new Set(dispatches.flatMap(item => item.notificationId ? [item.notificationId] : []))];
  const notifications = notificationIds.length ? await prisma.notification.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      id: { in: notificationIds },
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
      deliveries: { orderBy: { createdAt: "asc" } },
    },
  }) : [];
  const notificationById = new Map(notifications.map(item => [item.id, item]));
  const search = query.search?.toLowerCase();

  const data = dispatches.flatMap(dispatch => {
    const notification = dispatch.notificationId ? notificationById.get(dispatch.notificationId) : undefined;
    if (!notification) return [];
    const statuses = [
      ...(notification.channels.includes("IN_APP") ? ["CREATED"] : []),
      ...notification.deliveries.map(delivery => delivery.status),
    ];
    if (query.channel && !notification.channels.includes(query.channel)) return [];
    if (query.status && !statuses.includes(query.status)) return [];
    if (search) {
      const haystack = [
        dispatch.rule.name,
        dispatch.rule.triggerType,
        dispatch.entityId,
        notification.user.name,
        notification.user.email,
        notification.title,
        notification.body,
      ].join(" ").toLowerCase();
      if (!haystack.includes(search)) return [];
    }
    return [{
      dispatchId: dispatch.id,
      ruleId: dispatch.rule.id,
      ruleName: dispatch.rule.name,
      triggerType: dispatch.rule.triggerType,
      entityId: dispatch.entityId,
      recipient: notification.user,
      title: notification.title,
      body: notification.body,
      createdAt: notification.createdAt,
      lastSentAt: dispatch.lastSentAt,
      nextEligibleAt: dispatch.nextEligibleAt,
      channels: notification.channels,
      inAppStatus: notification.channels.includes("IN_APP") ? "CREATED" : null,
      deliveries: notification.deliveries.map(delivery => ({
        id: delivery.id,
        channel: delivery.channel,
        status: delivery.status,
        attempts: delivery.attempts,
        provider: delivery.provider,
        lastError: delivery.lastError,
        deliveredAt: delivery.deliveredAt,
        createdAt: delivery.createdAt,
      })),
    }];
  }).slice(0, query.limit);

  res.json({ data, meta: { returned: data.length, scanned: dispatches.length } });
});

router.post("/automations", async (req: AuthRequest, res) => {
  requireAdmin(req);
  const input = createRuleInput.parse(req.body);
  if (input.active) throw new AppError(409, "AUTOMATION_PREVIEW_REQUIRED", "New automation rules must be saved as drafts and previewed before enabling");
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
      cooldownMinutes: input.cooldownMinutes,
      active: false,
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
  const configurationChanged = input.triggerType !== undefined || input.triggerConfig !== undefined || input.actionConfig !== undefined;
  if (existing.active && configurationChanged) {
    throw new AppError(409, "AUTOMATION_PAUSE_REQUIRED", "Pause this automation before changing its trigger or notification");
  }
  if (input.active === true && (configurationChanged || !existing.lastPreviewAt)) {
    throw new AppError(409, "AUTOMATION_PREVIEW_REQUIRED", "Preview the current automation configuration before enabling execution");
  }
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
      ...(input.cooldownMinutes !== undefined ? { cooldownMinutes: input.cooldownMinutes } : {}),
      ...(configurationChanged ? { lastPreviewAt: null } : {}),
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
    const branchIds = await automationBranchScopeForOwner(rule.organizationId, rule.createdById);
    const matches = await collectAutomationMatches(
      rule.organizationId,
      branchIds,
      automationTriggerType.parse(rule.triggerType),
      rule.triggerConfig,
      startedAt,
    );
    const preview = {
      matchedCount: matches.length,
      recipientCount: [...new Set(matches.flatMap(item => item.recipients))].length,
      sample: matches.slice(0, 10).map(item => ({
        entityId: item.entityId,
        label: item.label,
        branchId: item.branchId,
        dueAt: item.dueAt,
        balancePaise: item.balancePaise,
        recipientCount: item.recipients.length,
      })),
    };
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

router.post("/automations/:id/run", async (req: AuthRequest, res) => {
  requireAdmin(req);
  const rule = await getOwnedRule(req, id.parse(req.params.id));
  if (!rule.active) throw new AppError(409, "AUTOMATION_PAUSED", "Enable this automation before running it");
  const data = await executeAutomationRule(rule.id, new Date(), { actorId: req.auth!.userId, mode: "MANUAL" });
  res.json({ data });
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
