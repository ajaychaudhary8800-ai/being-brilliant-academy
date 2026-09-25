import { Role } from "@prisma/client";
import { Router } from "express";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { z } from "zod";
import { AppError } from "../lib/http.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();

const documents = [
  { id: "overview", title: "Sales, Legal & Client Documentation Pack", file: "README.md", category: "Guidance", generationEnabled: false },
  { id: "proposal", title: "Sales Proposal Template", file: "01_SALES_PROPOSAL_TEMPLATE.md", category: "Sales", generationEnabled: true },
  { id: "quotation", title: "Order Form / Quotation", file: "02_ORDER_FORM_QUOTATION.md", category: "Commercial", generationEnabled: true },
  { id: "master-agreement", title: "SaaS Master Agreement", file: "03_SAAS_MASTER_AGREEMENT.md", category: "Legal", generationEnabled: true },
  { id: "implementation-sow", title: "Implementation Statement of Work", file: "04_IMPLEMENTATION_SOW.md", category: "Implementation", generationEnabled: true },
  { id: "sla-support", title: "SLA & Support Policy", file: "05_SLA_SUPPORT_POLICY.md", category: "Operations", generationEnabled: true },
  { id: "dpa", title: "Data Processing Addendum", file: "06_DATA_PROCESSING_ADDENDUM.md", category: "Privacy", generationEnabled: true },
  { id: "privacy-notice", title: "Privacy Notice", file: "07_PRIVACY_NOTICE.md", category: "Privacy", generationEnabled: true },
  { id: "acceptable-use", title: "Acceptable Use Policy", file: "08_ACCEPTABLE_USE_POLICY.md", category: "Policy", generationEnabled: true },
  { id: "data-exit-retention", title: "Data Exit & Retention Policy", file: "09_DATA_EXIT_RETENTION.md", category: "Policy", generationEnabled: true },
  { id: "security-schedule", title: "Security Schedule", file: "10_SECURITY_SCHEDULE.md", category: "Security", generationEnabled: true },
  { id: "handover-acceptance", title: "Client Handover & Acceptance", file: "11_CLIENT_HANDOVER_ACCEPTANCE.md", category: "Implementation", generationEnabled: true },
  { id: "legal-research", title: "Legal Research Notes", file: "LEGAL_RESEARCH_NOTES.md", category: "Guidance", generationEnabled: false },
] as const;

type DocumentDefinition = (typeof documents)[number];
const root = fileURLToPath(new URL("../../../../docs/legal-sales/", import.meta.url));

function requirePlatformAdmin(req: AuthRequest) {
  if (req.auth?.role !== Role.SUPER_ADMIN || req.auth.homeOrganizationId !== "org_default") {
    throw new AppError(403, "PLATFORM_ADMIN_REQUIRED", "Platform super administrator access required");
  }
}

function definition(id: string): DocumentDefinition {
  const item = documents.find(document => document.id === id);
  if (!item) throw new AppError(404, "LEGAL_SALES_DOCUMENT_NOT_FOUND", "Sales/legal document not found");
  return item;
}

async function source(item: DocumentDefinition) {
  return readFile(resolve(root, item.file), "utf8");
}

function placeholders(content: string) {
  const tokens = new Set<string>();
  for (const match of content.matchAll(/\[\[([^\[\]\n]{1,120})\]\]/g)) tokens.add(match[1].trim());
  return [...tokens];
}

function replacePlaceholders(content: string, replacements: Record<string, string>) {
  return content.replace(/\[\[([^\[\]\n]{1,120})\]\]/g, (full, rawKey: string) => {
    const key = rawKey.trim();
    return Object.prototype.hasOwnProperty.call(replacements, key) ? replacements[key] : full;
  });
}

const generationInput = z.object({
  replacements: z.record(z.string().max(10_000)).default({}),
}).superRefine((value, ctx) => {
  if (Object.keys(value.replacements).length > 100) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Too many replacement fields" });
  }
});

router.use(requireAuth);

router.get("/platform/legal-sales/documents", async (req: AuthRequest, res) => {
  requirePlatformAdmin(req);
  const rows = await Promise.all(documents.map(async item => {
    const content = await source(item);
    return {
      id: item.id,
      title: item.title,
      file: item.file,
      category: item.category,
      generationEnabled: item.generationEnabled,
      placeholders: placeholders(content),
    };
  }));
  res.json({ data: rows });
});

router.get("/platform/legal-sales/documents/:id", async (req: AuthRequest, res) => {
  requirePlatformAdmin(req);
  const item = definition(String(req.params.id));
  const content = await source(item);
  res.json({
    data: {
      id: item.id,
      title: item.title,
      file: item.file,
      category: item.category,
      generationEnabled: item.generationEnabled,
      placeholders: placeholders(content),
      content,
    },
  });
});

router.post("/platform/legal-sales/documents/:id/generate", async (req: AuthRequest, res) => {
  requirePlatformAdmin(req);
  const item = definition(String(req.params.id));
  if (!item.generationEnabled) {
    throw new AppError(422, "DOCUMENT_NOT_GENERATABLE", "This controlled guidance document is view-only");
  }
  const input = generationInput.parse(req.body);
  const original = await source(item);
  res.json({
    data: {
      id: item.id,
      title: item.title,
      file: item.file.replace(/\.md$/i, "-working-copy.md"),
      content: replacePlaceholders(original, input.replacements),
      unresolvedPlaceholders: placeholders(replacePlaceholders(original, input.replacements)),
      sourceFile: item.file,
      generatedAt: new Date().toISOString(),
      notice: "Working copy only. The controlled source template remains unchanged.",
    },
  });
});

export default router;
