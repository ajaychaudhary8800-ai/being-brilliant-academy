import crypto from "node:crypto";
import { env } from "../config.js";
import { sendEmail } from "./notifications.js";
import { prisma } from "./prisma.js";

export async function issueAccountSetup(user: { id: string; organizationId: string; email: string; name: string }) {
  const raw = crypto.randomBytes(32).toString("base64url");
  await prisma.passwordResetToken.deleteMany({ where: { organizationId: user.organizationId, userId: user.id, usedAt: null } });
  await prisma.passwordResetToken.create({
    data: {
      organizationId: user.organizationId,
      userId: user.id,
      tokenHash: crypto.createHash("sha256").update(raw).digest("hex"),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  return sendEmail(
    user.email,
    "Set up your Being Brilliant Academy account",
    `Hello ${user.name},\n\nUse this secure link within one hour to set your password:\n\n${env.WEB_URL}/reset-password?token=${encodeURIComponent(raw)}`,
  );
}
