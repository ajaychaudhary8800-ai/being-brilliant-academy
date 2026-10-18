import "express-async-errors";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { Role } from "@prisma/client";
import express from "express";
import jwt from "jsonwebtoken";
import { env } from "../config.js";
import { errorHandler } from "../lib/http.js";
import { systemPrisma } from "../lib/prisma.js";
import rates from "../routes/schoolos-addon-rates.js";
import quotes from "../routes/schoolos-quotations.js";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";
function safeTarget() {
  let u: URL | null = null;
  try { if (process.env.TEST_DATABASE_URL) u = new URL(process.env.TEST_DATABASE_URL); } catch { /* fail */ }
  const db = u?.pathname.replace(/^\//, "") ?? "";
  if (!enabled || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL || !u ||
    !["localhost", "127.0.0.1", "::1"].includes(u.hostname) ||
    !["postgres:", "postgresql:"].includes(u.protocol) ||
    !/(^|[_-])(test|integration)([_-]|$)/i.test(db))
    throw new Error("Refusing SchoolOS finance approval test outside an isolated local TEST_DATABASE_URL");
}
async function call(port: number, path: string, token: string, body?: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  return { status: response.status, body: raw ? JSON.parse(raw) as any : null };
}
test("PostgreSQL: separate maker/checker, SKU overlap guard and quoted price validation", { skip: !enabled, timeout: 120_000 }, async () => {
  safeTarget();
  const key = crypto.randomUUID().slice(0, 12).replaceAll("-", "");
  const planCode = `SQSKU_${key.toUpperCase()}`;
  const createdUsers: string[] = [];
  const rateIds: string[] = [];
  let server: Server | undefined;
  try {
    const maker = await systemPrisma.user.create({ data: { organizationId: "org_default",
      name: "SKU Maker", email: `sku-maker-${key}@example.test`, role: Role.SUPER_ADMIN,
      passwordHash: "integration-test", emailVerifiedAt: new Date() } });
    const checker = await systemPrisma.user.create({ data: { organizationId: "org_default",
      name: "SKU Checker", email: `sku-checker-${key}@example.test`, role: Role.SUPER_ADMIN,
      passwordHash: "integration-test", emailVerifiedAt: new Date() } });
    createdUsers.push(maker.id, checker.id);
    const token = (userId: string) => jwt.sign({ userId, role: Role.SUPER_ADMIN, organizationId: "org_default" },
      env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
    const makerToken = token(maker.id);
    const checkerToken = token(checker.id);
    await systemPrisma.saaSPlan.create({
      data: { code: planCode, name: "Quote SKU Integration Plan", currency: "INR",
        monthlyPricePaise: 100_000, annualPricePaise: 4990000, taxRateBps: 1800,
        entitlements: { lms: true }, limits: { students: 100 }, isActive: true },
    });
    const app = express();
    app.use(express.json());
    app.use("/api/v1", rates, quotes);
    app.use(errorHandler);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server!.once("listening", resolve); server!.once("error", reject);
    });
    const port = (server.address() as AddressInfo).port;

    const proposal = {
      category: "AI_USAGE", code: "ai_credits", label: "AI Credit Unit",
      unitPricePaise: 200, taxRateBps: 1800,
      effectiveFrom: new Date(Date.now() - 86_400_000).toISOString(),
      effectiveUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    };
    const posted = await call(port, "/api/v1/platform/schoolos/addon-rates", makerToken, proposal);
    assert.equal(posted.status, 201, JSON.stringify(posted.body));
    rateIds.push(posted.body.data.id);
    assert.equal(posted.body.data.status, "DRAFT");

    const input = {
      clientName: "Integration Quote Client", planCode, billingCycle: "ANNUAL",
      validUntil: new Date(Date.now() + 15 * 86_400_000).toISOString(),
      discountBps: 0,
      items: [{ category: "AI_USAGE", code: "ai_credits", label: "AI Credit Unit", quantity: 10, unitPricePaise: 200 }],
    };
    const before = await call(port, "/api/v1/platform/schoolos/quotes/preview", checkerToken, input);
    assert.equal(before.status, 422);
    assert.equal(before.body.error.code, "SCHOOLOS_ADDON_PRICING_NOT_APPROVED");

    const approval = { approvalReference: `approved-finance-ticket-${key}`,
      reason: "Independently approved prelaunch QA rate with no payment execution" };
    const selfApproval = await call(port, `/api/v1/platform/schoolos/addon-rates/${rateIds[0]}/approve`, makerToken, approval);
    assert.equal(selfApproval.status, 403);
    const accepted = await call(port, `/api/v1/platform/schoolos/addon-rates/${rateIds[0]}/approve`, checkerToken, approval);
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.equal(accepted.body.data.approvedBy, checker.id);

    const priced = await call(port, "/api/v1/platform/schoolos/quotes/preview", checkerToken, input);
    assert.equal(priced.status, 200, JSON.stringify(priced.body));
    assert.equal(priced.body.data.addonRateSnapshot[0].rateId, rateIds[0]);
    assert.equal(priced.body.data.addonRateSnapshot[0].unitPricePaise, 200);
    assert.equal(priced.body.data.draftOnly, true);
    const tampered = await call(port, "/api/v1/platform/schoolos/quotes/preview", checkerToken,
      { ...input, items: [{ ...input.items[0], unitPricePaise: 50 }] });
    assert.equal(tampered.status, 422);

    const second = await call(port, "/api/v1/platform/schoolos/addon-rates", makerToken,
      { ...proposal, unitPricePaise: 250 });
    assert.equal(second.status, 201, JSON.stringify(second.body));
    rateIds.push(second.body.data.id);
    assert.equal(second.body.data.revision, 2);
    const overlap = await call(port, `/api/v1/platform/schoolos/addon-rates/${rateIds[1]}/approve`, checkerToken, approval);
    assert.equal(overlap.status, 409);
    assert.equal(overlap.body.error.code, "SCHOOLOS_ADDON_APPROVAL_WINDOW_CONFLICT");

    assert.equal(await systemPrisma.schoolOSAddonRate.count({ where: { status: "APPROVED", code: proposal.code } }), 1);
    assert.equal(await systemPrisma.schoolOSQuotation.count({ where: { planCode } }), 0);
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    await systemPrisma.auditLog.deleteMany({ where: { entity: "SchoolOSAddonRate", entityId: { in: rateIds } } });
    await systemPrisma.schoolOSAddonRate.deleteMany({ where: { id: { in: rateIds } } });
    await systemPrisma.tenantAccessAudit.deleteMany({ where: { userId: { in: createdUsers } } });
    await systemPrisma.user.deleteMany({ where: { id: { in: createdUsers } } });
    await systemPrisma.saaSPlan.deleteMany({ where: { code: planCode } });
  }
});
