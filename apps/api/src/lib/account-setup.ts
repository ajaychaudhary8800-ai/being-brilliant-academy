import crypto from "node:crypto";
import { sendEmail } from "./notifications.js";
import { systemPrisma } from "./prisma.js";
import { loadTenantBrand } from "./tenant-brand.js";

export async function issueAccountSetup(user: { id: string; organizationId: string; email: string; name: string }) {
  const raw = crypto.randomBytes(32).toString("base64url");
  await systemPrisma.passwordResetToken.deleteMany({ where: { organizationId: user.organizationId, userId: user.id, usedAt: null } });
  await systemPrisma.passwordResetToken.create({
    data: {
      organizationId: user.organizationId,
      userId: user.id,
      tokenHash: crypto.createHash("sha256").update(raw).digest("hex"),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  const organization = await systemPrisma.organization.findUnique({ where: { id: user.organizationId }, select: { name: true, slug: true, settings: true } });
  const settings = organization?.settings && typeof organization.settings === "object" && !Array.isArray(organization.settings) ? organization.settings as Record<string, unknown> : {};
  const whiteLabel = settings.whiteLabel && typeof settings.whiteLabel === "object" && !Array.isArray(settings.whiteLabel) ? settings.whiteLabel as Record<string, unknown> : {};
  const brand = await loadTenantBrand(user.organizationId);
  const brandName = typeof whiteLabel.appName === "string" && whiteLabel.appName.trim() ? whiteLabel.appName.trim() : organization?.name ?? "Your institution";
  return sendEmail(
    user.email,
    `Set up your ${brandName} account`,
    `Hello ${user.name},\n\nUse this secure link within one hour to set your password:\n\n${brand.portalBaseUrl}/reset-password?token=${encodeURIComponent(raw)}&workspace=${encodeURIComponent(organization?.slug ?? "")}`,
  );
}
