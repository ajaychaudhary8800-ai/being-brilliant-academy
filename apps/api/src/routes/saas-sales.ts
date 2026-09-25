import { Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/http.js";
import { systemPrisma } from "../lib/prisma.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();

const statuses = [
  "NEW", "QUALIFIED", "CONTACTED", "DEMO_SCHEDULED", "DEMO_COMPLETED",
  "PROPOSAL_SENT", "NEGOTIATION", "WON", "LOST", "NURTURE",
] as const;
const qualifications = ["UNQUALIFIED", "MQL", "SQL", "DISQUALIFIED"] as const;
const sources = [
  "WEBSITE", "REFERRAL", "CBSE_DIRECTORY", "CISCE_DIRECTORY", "GOOGLE_MAPS",
  "LINKEDIN", "SAHODAYA", "PARTNER", "OUTBOUND", "EVENT", "OTHER",
] as const;

const publicLeadInput = z.object({
  organizationName: z.string().trim().min(2).max(160),
  contactName: z.string().trim().min(2).max(120),
  mobile: z.string().transform(value => value.replace(/\D/g, "")).refine(value => /^(?:91)?[6-9]\d{9}$/.test(value), "Enter a valid Indian mobile number").transform(value => value.length === 12 ? value.slice(2) : value),
  email: z.string().trim().email().max(180).optional().or(z.literal("")).transform(value => value || undefined),
  institutionType: z.string().trim().min(2).max(80),
  studentCountBand: z.string().trim().max(40).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  website: z.string().trim().url().max(240).optional().or(z.literal("")).transform(value => value || undefined),
  source: z.enum(sources).default("WEBSITE"),
  campaign: z.string().trim().max(100).optional(),
  requirements: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  utm: z.record(z.string()).optional(),
});

function scoreLead(input: z.infer<typeof publicLeadInput>) {
  let score = 20;
  if (input.email) score += 10;
  if (input.website) score += 5;
  if (["500–2,000", "2,000–5,000", "5,000+", "500-2,000", "2,000-5,000"].includes(input.studentCountBand ?? "")) score += 15;
  if (/group|multi|chain/i.test(input.institutionType)) score += 10;
  const requirements = new Set((input.requirements ?? []).map(item => item.toLowerCase()));
  if (requirements.has("lms")) score += 5;
  if (requirements.has("crm")) score += 5;
  if (requirements.has("analytics")) score += 5;
  if (requirements.has("white-label") || requirements.has("custom domain")) score += 10;
  if (input.source === "REFERRAL" || input.source === "PARTNER") score += 10;
  if (input.utm?.intent === "B2B_PRODUCT_DEMO") score += 20;
  return Math.min(score, 100);
}

function recommendedPlan(input: z.infer<typeof publicLeadInput>) {
  const req = new Set((input.requirements ?? []).map(item => item.toLowerCase()));
  const band = input.studentCountBand ?? "";
  if (req.has("white-label") || req.has("custom domain") || req.has("transport") || req.has("hostel") || band === "5,000+" || band === "2,000–5,000" || band === "2,000-5,000") return "ENTERPRISE";
  if (band === "500–2,000" || band === "500-2,000" || req.has("hr") || req.has("payroll") || req.has("finance") || req.has("library") || req.has("inventory") || req.has("analytics") || /group|multi|chain/i.test(input.institutionType)) return "PROFESSIONAL";
  if (req.has("lms") || req.has("crm") || req.has("communication") || req.has("examinations")) return "GROWTH";
  return "ESSENTIALS";
}

function requirePlatformAdmin(req: AuthRequest) {
  if (req.auth?.role !== Role.SUPER_ADMIN || req.auth.homeOrganizationId !== "org_default") {
    throw new AppError(403, "PLATFORM_ADMIN_REQUIRED", "Platform super administrator access required");
  }
}

router.post("/public/saas-sales/leads", async (req, res) => {
  const input = publicLeadInput.parse(req.body);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const existing = await systemPrisma.saaSSalesLead.findFirst({
    where: {
      createdAt: { gte: since },
      status: { notIn: ["WON", "LOST"] },
      OR: [
        {
          organizationName: { equals: input.organizationName, mode: "insensitive" },
          mobile: input.mobile,
        },
        ...(input.email ? [{
          organizationName: { equals: input.organizationName, mode: "insensitive" as const },
          email: { equals: input.email, mode: "insensitive" as const },
        }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
  });
  const leadScore = scoreLead(input);
  const plan = recommendedPlan(input);
  if (existing) {
    const updated = await systemPrisma.saaSSalesLead.update({
      where: { id: existing.id },
      data: {
        email: existing.email ?? input.email,
        studentCountBand: existing.studentCountBand ?? input.studentCountBand,
        city: existing.city ?? input.city,
        state: existing.state ?? input.state,
        website: existing.website ?? input.website,
        campaign: existing.campaign ?? input.campaign,
        requirements: input.requirements ?? undefined,
        utm: input.utm ?? undefined,
        leadScore: Math.max(existing.leadScore, leadScore),
        recommendedPlan: existing.recommendedPlan ?? plan,
      },
    });
    return res.status(200).json({ data: { id: updated.id, status: updated.status, leadScore: updated.leadScore, deduplicated: true } });
  }

  const row = await systemPrisma.saaSSalesLead.create({
    data: {
      ...input,
      leadScore,
      recommendedPlan: plan,
      qualification: leadScore >= 60 ? "MQL" : "UNQUALIFIED",
    },
  });
  return res.status(201).json({ data: { id: row.id, status: row.status, leadScore: row.leadScore, deduplicated: false } });
});

router.use(requireAuth);

router.get("/platform/sales/dashboard", async (req: AuthRequest, res) => {
  requirePlatformAdmin(req);
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const activeStatuses = ["NEW", "QUALIFIED", "CONTACTED", "DEMO_SCHEDULED", "DEMO_COMPLETED", "PROPOSAL_SENT", "NEGOTIATION", "NURTURE"];
  const [total, newLeads, qualified, demos, proposals, negotiation, won, lost, overdue, dueSoon, createdThisWeek, bySource] = await Promise.all([
    systemPrisma.saaSSalesLead.count(),
    systemPrisma.saaSSalesLead.count({ where: { status: "NEW" } }),
    systemPrisma.saaSSalesLead.count({ where: { qualification: { in: ["MQL", "SQL"] } } }),
    systemPrisma.saaSSalesLead.count({ where: { status: { in: ["DEMO_SCHEDULED", "DEMO_COMPLETED"] } } }),
    systemPrisma.saaSSalesLead.count({ where: { status: "PROPOSAL_SENT" } }),
    systemPrisma.saaSSalesLead.count({ where: { status: "NEGOTIATION" } }),
    systemPrisma.saaSSalesLead.count({ where: { status: "WON" } }),
    systemPrisma.saaSSalesLead.count({ where: { status: "LOST" } }),
    systemPrisma.saaSSalesLead.count({ where: { status: { in: activeStatuses }, nextFollowUpAt: { lt: now } } }),
    systemPrisma.saaSSalesLead.count({ where: { status: { in: activeStatuses }, nextFollowUpAt: { gte: now, lte: new Date(now.getTime() + 48 * 60 * 60 * 1000) } } }),
    systemPrisma.saaSSalesLead.count({ where: { createdAt: { gte: weekAgo } } }),
    systemPrisma.saaSSalesLead.groupBy({ by: ["source"], _count: { _all: true }, orderBy: { _count: { source: "desc" } }, take: 10 }),
  ]);
  const resolved = won + lost;
  res.json({
    data: {
      total, new: newLeads, qualified, demos, proposals, negotiation, won, lost, overdue, dueSoon, createdThisWeek,
      winRate: resolved ? Math.round((won / resolved) * 1000) / 10 : 0,
      bySource: bySource.map(item => ({ source: item.source, count: item._count._all })),
    },
  });
});

router.get("/platform/sales/leads", async (req: AuthRequest, res) => {
  requirePlatformAdmin(req);
  const q = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    search: z.string().trim().optional(),
    status: z.enum(statuses).optional(),
    qualification: z.enum(qualifications).optional(),
    source: z.enum(sources).optional(),
    followUp: z.enum(["overdue", "upcoming"]).optional(),
  }).parse(req.query);
  const now = new Date();
  const where: any = {
    ...(q.status ? { status: q.status } : {}),
    ...(q.qualification ? { qualification: q.qualification } : {}),
    ...(q.source ? { source: q.source } : {}),
    ...(q.search ? { OR: [
      { organizationName: { contains: q.search, mode: "insensitive" } },
      { contactName: { contains: q.search, mode: "insensitive" } },
      { mobile: { contains: q.search } },
      { email: { contains: q.search, mode: "insensitive" } },
      { city: { contains: q.search, mode: "insensitive" } },
    ] } : {}),
    ...(q.followUp === "overdue" ? { nextFollowUpAt: { lt: now }, status: { notIn: ["WON", "LOST"] } } : {}),
    ...(q.followUp === "upcoming" ? { nextFollowUpAt: { gte: now, lte: new Date(now.getTime() + 48 * 60 * 60 * 1000) }, status: { notIn: ["WON", "LOST"] } } : {}),
  };
  const [total, data] = await systemPrisma.$transaction([
    systemPrisma.saaSSalesLead.count({ where }),
    systemPrisma.saaSSalesLead.findMany({
      where, skip: (q.page - 1) * q.limit, take: q.limit,
      orderBy: [{ leadScore: "desc" }, { createdAt: "desc" }],
      include: { activities: { orderBy: { createdAt: "desc" }, take: 5 } },
    }),
  ]);
  res.json({ data, meta: { total, page: q.page, limit: q.limit, totalPages: Math.max(1, Math.ceil(total / q.limit)) } });
});

router.post("/platform/sales/leads", async (req: AuthRequest, res) => {
  requirePlatformAdmin(req);
  const input = publicLeadInput.extend({
    status: z.enum(statuses).default("NEW"),
    qualification: z.enum(qualifications).default("UNQUALIFIED"),
    ownerUserId: z.string().trim().max(80).optional(),
    nextFollowUpAt: z.coerce.date().optional(),
    notes: z.string().trim().max(5000).optional(),
  }).parse(req.body);
  const leadScore = scoreLead(input);
  const row = await systemPrisma.saaSSalesLead.create({
    data: { ...input, leadScore, recommendedPlan: recommendedPlan(input) },
  });
  res.status(201).json({ data: row });
});

router.patch("/platform/sales/leads/:id", async (req: AuthRequest, res) => {
  requirePlatformAdmin(req);
  const data = z.object({
    status: z.enum(statuses).optional(),
    qualification: z.enum(qualifications).optional(),
    ownerUserId: z.string().trim().max(80).nullable().optional(),
    recommendedPlan: z.enum(["ESSENTIALS", "GROWTH", "PROFESSIONAL", "ENTERPRISE"]).nullable().optional(),
    expectedAnnualValuePaise: z.number().int().min(0).nullable().optional(),
    nextFollowUpAt: z.coerce.date().nullable().optional(),
    lastContactAt: z.coerce.date().nullable().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
    lostReason: z.string().trim().max(1000).nullable().optional(),
    wonOrganizationId: z.string().trim().max(80).nullable().optional(),
  }).parse(req.body);
  const existing = await systemPrisma.saaSSalesLead.findUnique({ where: { id: String(req.params.id) } });
  if (!existing) throw new AppError(404, "SAAS_SALES_LEAD_NOT_FOUND", "Sales lead not found");
  if (data.status === "WON" && !data.wonOrganizationId && !existing.wonOrganizationId) {
    throw new AppError(422, "WON_ORGANIZATION_REQUIRED", "Link the created customer organization before marking a lead as won");
  }
  if (data.status === "LOST" && !data.lostReason && !existing.lostReason) {
    throw new AppError(422, "LOST_REASON_REQUIRED", "Record a lost reason before closing a lead as lost");
  }
  const row = await systemPrisma.saaSSalesLead.update({ where: { id: existing.id }, data });
  if (data.status && data.status !== existing.status) {
    await systemPrisma.saaSSalesActivity.create({
      data: {
        leadId: existing.id,
        activityType: "STATUS_CHANGE",
        outcome: `${existing.status} → ${data.status}`,
        createdById: req.auth!.userId,
        nextFollowUpAt: data.nextFollowUpAt ?? undefined,
      },
    });
  }
  res.json({ data: row });
});

router.post("/platform/sales/leads/:id/activities", async (req: AuthRequest, res) => {
  requirePlatformAdmin(req);
  const input = z.object({
    activityType: z.enum(["CALL", "EMAIL", "WHATSAPP", "MEETING", "DEMO", "PROPOSAL", "NOTE"]),
    outcome: z.string().trim().max(300).optional(),
    notes: z.string().trim().max(5000).optional(),
    nextFollowUpAt: z.coerce.date().optional(),
    status: z.enum(statuses).optional(),
  }).parse(req.body);
  const id = String(req.params.id);
  const lead = await systemPrisma.saaSSalesLead.findUnique({ where: { id } });
  if (!lead) throw new AppError(404, "SAAS_SALES_LEAD_NOT_FOUND", "Sales lead not found");
  const now = new Date();
  const [activity] = await systemPrisma.$transaction([
    systemPrisma.saaSSalesActivity.create({
      data: {
        leadId: id,
        activityType: input.activityType,
        outcome: input.outcome,
        notes: input.notes,
        nextFollowUpAt: input.nextFollowUpAt,
        createdById: req.auth!.userId,
      },
    }),
    systemPrisma.saaSSalesLead.update({
      where: { id },
      data: {
        lastContactAt: input.activityType === "NOTE" ? undefined : now,
        nextFollowUpAt: input.nextFollowUpAt,
        status: input.status,
      },
    }),
  ]);
  res.status(201).json({ data: activity });
});

export default router;
