import { env } from "../config.js";
import { systemPrisma } from "./prisma.js";
import { customDomainFromSettings, tenantPortalBaseUrl } from "./tenant-domain.js";

type OrganizationBrandSource = {
  id?: string;
  name: string;
  slug?: string | null;
  settings?: unknown;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}


function defaultDocumentPrefix(name: string) {
  const words = name.toUpperCase().match(/[A-Z0-9]+/g) ?? [];
  const initials = words.map(word => word[0]).join("").slice(0, 8);
  if (initials.length >= 2) return initials;
  const compact = words.join("").replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return compact.length >= 2 ? compact : "ORG";
}

export function tenantBrandFromOrganization(organization: OrganizationBrandSource) {
  const settings = record(organization.settings);
  const whiteLabel = record(settings.whiteLabel);
  const appName = stringValue(whiteLabel.appName) ?? organization.name;
  const configuredPrefix = stringValue(whiteLabel.documentPrefix)?.toUpperCase().replace(/[^A-Z0-9]/g, "") ?? "";
  const documentPrefix = /^[A-Z0-9]{2,12}$/.test(configuredPrefix) ? configuredPrefix : defaultDocumentPrefix(appName);
  const customDomain = customDomainFromSettings(organization.settings);
  return {
    appName,
    documentPrefix,
    customDomain,
    portalBaseUrl: tenantPortalBaseUrl(organization.settings),
  };
}

export async function loadTenantBrand(organizationId: string) {
  const organization = await systemPrisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, slug: true, settings: true },
  });
  if (!organization) return {
    appName: "Institution",
    documentPrefix: "ORG",
    customDomain: null,
    portalBaseUrl: env.WEB_URL.replace(/\/$/, ""),
  };
  return tenantBrandFromOrganization(organization);
}
