import { prisma } from "./prisma.js";

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}

function text(value: unknown, max: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

export function tenantDocumentIdentity(organization: { name: string; slug: string; settings: unknown }) {
  const whiteLabel = record(record(organization.settings).whiteLabel);
  const name = text(whiteLabel.appName, 120) ?? organization.name;
  const certificatePrefix = organization.slug
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 18).replace(/-+$/g, "") || "ORG";
  return { name, certificatePrefix };
}

export async function loadTenantDocumentIdentity(organizationId: string) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true, slug: true, settings: true },
  });
  return organization
    ? tenantDocumentIdentity(organization)
    : { name: "Institution", certificatePrefix: "ORG" };
}
