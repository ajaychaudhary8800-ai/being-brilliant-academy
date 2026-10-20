#!/usr/bin/env node
/**
 * One-time, OWNER-INITIATED V5 staging QA credential bootstrap.
 *
 * Execute only within the isolated V5 API Docker container after reviewing
 * the exact target guards. Never run on production or other staging deployments.
 * Reads password from STDIN; never prints it, or writes it to an artifact.
 * This script creates/rotates ONE synthetic platform QA identity only.
 */
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import {
  assertV5StagingBootstrapTarget,
  validateV5QaPassword,
  V5_QA_EMAIL,
} from "./schoolos-v5-qa-guard.mjs";

async function readPassword() {
  if (process.stdin.isTTY) {
    throw new Error("Pipe a password from a private no-echo terminal prompt via STDIN");
  }
  let chunks = "";
  for await (const part of process.stdin) {
    chunks += part.toString("utf8");
    if (chunks.length > 128) throw new Error("QA password is too long");
  }
  validateV5QaPassword(chunks);
  return chunks;
}

async function main() {
  assertV5StagingBootstrapTarget(process.env);
  if (process.argv.slice(2).length) throw new Error("No CLI arguments permitted");

  let password = await readPassword();
  const db = new PrismaClient();
  try {
    const org = await db.organization.findUnique({
      where: { id: "org_default" },
      select: { id: true, slug: true, isActive: true, deletedAt: true },
    });
    if (!org || org.slug !== "being-brilliant-academy" || !org.isActive || org.deletedAt) {
      throw new Error("Unexpected platform organization; refusing QA account operation");
    }
    const expectedTenants = ["schoolos-qa-coaching", "schoolos-qa-school"];
    const tenants = await db.organization.findMany({
      where: { slug: { in: expectedTenants }, deletedAt: null },
      select: { slug: true },
    });
    if (expectedTenants.some(slug => !tenants.some(t => t.slug === slug))) {
      throw new Error("Both isolated synthetic QA tenants must exist before enabling QA account");
    }
    const existing = await db.user.findUnique({ where: { email: V5_QA_EMAIL } });
    if (existing && (existing.organizationId !== org.id || existing.role !== "SUPER_ADMIN")) {
      throw new Error("Conflicting existing QA identity; refusing mutation");
    }
    const hash = await bcrypt.hash(password, 12);
    password = "";

    const now = new Date();
    await db.$transaction(async tx => {
      const account = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: { passwordHash: hash, emailVerifiedAt: now, isActive: true },
          })
        : await tx.user.create({
            data: {
              organizationId: org.id,
              email: V5_QA_EMAIL,
              name: "SchoolOS V5 Synthetic QA Platform Administrator",
              role: "SUPER_ADMIN",
              passwordHash: hash,
              emailVerifiedAt: now,
              isActive: true,
            },
          });
      await tx.session.deleteMany({
        where: { organizationId: org.id, userId: account.id },
      });
      await tx.auditLog.create({
        data: {
          organizationId: org.id,
          actorId: account.id,
          action: existing ? "V5_STAGING_QA_IDENTITY_ROTATED" : "V5_STAGING_QA_IDENTITY_CREATED",
          entity: "User",
          entityId: account.id,
          metadata: { source: "isolated_v5_staging_manual_bootstrap", synthetic: true },
        },
      });
    });

    console.log("V5_STAGING_QA_BOOTSTRAP=PASS");
    console.log("QA_EMAIL=" + V5_QA_EMAIL);
    console.log("QA_PASSWORD=NOT_PRINTED");
    console.log("QA_SCOPE=ISOLATED_STAGING_ONLY");
    console.log("NOTE=Disable account after live authenticated acceptance.");
  } finally {
    password = "";
    await db.$disconnect();
  }
}

main().catch(error => {
  console.error("V5_STAGING_QA_BOOTSTRAP=FAIL");
  // Don't emit arbitrary server/Prisma error messages containing PII or secrets.
  const safeMessage = typeof error?.message === "string" &&
    (/^QA password |^Both isolated |^Unexpected platform |^Conflicting existing |^No CLI |^Pipe a password |^Explicit isolated |^Target is not |^Database does not |^Invalid database target/.test(error.message));
  if (safeMessage) console.error(error.message);
  process.exitCode = 1;
});
