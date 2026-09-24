import { systemPrisma } from "./prisma.js";
import { normalizeTenantHost, tenantSlugFromHost } from "./tenant-domain.js";

export async function isTenantCorsOriginAllowed(origin: string) {
  const host = normalizeTenantHost(origin);
  if (!host) return false;

  const subdomainSlug = tenantSlugFromHost(host);
  if (subdomainSlug) {
    const organization = await systemPrisma.organization.findFirst({
      where: { slug: subdomainSlug, isActive: true, deletedAt: null },
      select: { id: true },
    });
    return Boolean(organization);
  }

  const organization = await systemPrisma.organization.findFirst({
    where: {
      isActive: true,
      deletedAt: null,
      settings: { path: ["whiteLabel", "customDomain"], equals: host },
    },
    select: { id: true },
  });
  return Boolean(organization);
}
