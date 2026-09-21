import { Router } from "express";
import { z } from "zod";
import { systemPrisma } from "../lib/prisma.js";

const router = Router();

const querySchema = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/).min(2).max(80).optional(),
  host: z.string().trim().min(1).max(255).optional(),
});

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}

function textValue(value: unknown, max = 1000) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : false;
}

function normalizeHost(value: string | null | undefined) {
  if (!value) return null;
  const withoutProtocol = value.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0] ?? "";
  return withoutProtocol.replace(/:\d+$/, "").replace(/\.$/, "") || null;
}

function safeAssetUrl(value: unknown) {
  const candidate = textValue(value);
  if (!candidate) return null;
  if (candidate.startsWith("/") || /^https?:\/\//i.test(candidate)) return candidate;
  return null;
}

function whiteLabelSettings(settings: unknown) {
  const whiteLabel = record(record(settings).whiteLabel);
  return {
    appName: textValue(whiteLabel.appName, 120),
    portalName: textValue(whiteLabel.portalName, 80),
    loginHeadline: textValue(whiteLabel.loginHeadline, 160),
    loginSubheadline: textValue(whiteLabel.loginSubheadline, 300),
    supportEmail: textValue(whiteLabel.supportEmail, 254),
    supportPhone: textValue(whiteLabel.supportPhone, 40),
    customDomain: normalizeHost(textValue(whiteLabel.customDomain, 255)),
    faviconUrl: safeAssetUrl(whiteLabel.faviconUrl),
    accentColor: typeof whiteLabel.accentColor === "string" && /^#[0-9a-fA-F]{6}$/.test(whiteLabel.accentColor) ? whiteLabel.accentColor : null,
    hideVendorBranding: booleanValue(whiteLabel.hideVendorBranding),
  };
}

const select = {
  id: true,
  slug: true,
  name: true,
  logoUrl: true,
  primaryColor: true,
  secondaryColor: true,
  settings: true,
  isActive: true,
  deletedAt: true,
} as const;

function available(organization: { isActive: boolean; deletedAt: Date | null }) {
  return organization.isActive && !organization.deletedAt;
}

function present(organization: Awaited<ReturnType<typeof systemPrisma.organization.findFirst>>) {
  if (!organization) return null;
  const whiteLabel = whiteLabelSettings((organization as { settings?: unknown }).settings);
  return {
    organizationId: organization.id,
    slug: organization.slug,
    name: organization.name,
    logoUrl: organization.logoUrl,
    primaryColor: organization.primaryColor,
    secondaryColor: organization.secondaryColor,
    whiteLabel,
  };
}

router.get("/branding", async (req, res) => {
  const query = querySchema.parse(req.query);
  const host = normalizeHost(query.host);

  let organization = query.slug
    ? await systemPrisma.organization.findUnique({ where: { slug: query.slug }, select })
    : null;

  if (organization && !available(organization)) organization = null;

  if (!organization && host) {
    const firstLabel = host.split(".")[0] ?? "";
    const reserved = new Set(["www", "app", "api", "staging"]);
    if (firstLabel && !reserved.has(firstLabel) && /^[a-z0-9-]{2,80}$/.test(firstLabel)) {
      const bySubdomain = await systemPrisma.organization.findUnique({ where: { slug: firstLabel }, select });
      if (bySubdomain && available(bySubdomain)) organization = bySubdomain;
    }
  }

  if (!organization && host) {
    const organizations = await systemPrisma.organization.findMany({
      where: { isActive: true, deletedAt: null },
      select,
      take: 500,
    });
    organization = organizations.find((candidate) => whiteLabelSettings(candidate.settings).customDomain === host) ?? null;
  }

  if (!organization) {
    return res.status(404).json({ error: { code: "BRANDING_NOT_FOUND", message: "Organization branding was not found" } });
  }

  return res.json({ data: present(organization) });
});

export default router;
