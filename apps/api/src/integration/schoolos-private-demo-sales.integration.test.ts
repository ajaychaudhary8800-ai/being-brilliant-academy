import "express-async-errors";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import test from "node:test";
import { Role } from "@prisma/client";
import express from "express";
import jwt from "jsonwebtoken";
import { env } from "../config.js";
import { errorHandler } from "../lib/http.js";
import { systemPrisma } from "../lib/prisma.js";
import salesRouter from "../routes/saas-sales.js";

function requireDisposableDatabase() {
  const value = process.env.TEST_DATABASE_URL;
  let url: URL | undefined;
  try { url = value ? new URL(value) : undefined; } catch { /* fail closed */ }
  const name = url?.pathname.replace(/^\//, "") ?? "";
  if (process.env.RUN_POSTGRES_INTEGRATION !== "1" || !url || value !== process.env.DATABASE_URL
    || !["postgres:", "postgresql:"].includes(url.protocol)
    || !["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    || !/(^|[_-])(test|integration)([_-]|$)/i.test(name))
    throw new Error("Refuse SchoolOS CRM acceptance outside isolated local TEST_DATABASE_URL");
}

test("SchoolOS private-demo sales intake requires consent, deduplicates concurrent HTTP, protects CRM", {
  skip: process.env.RUN_POSTGRES_INTEGRATION !== "1", timeout: 90_000,
}, async () => {
  requireDisposableDatabase();
  const id = crypto.randomUUID().replaceAll("-", "").slice(0, 18);
  const org = "Synthetic SchoolOS Enquiry " + id;
  let userId: string | undefined;
  let server: Server | undefined;
  try {
    const api = express();
    api.use(express.json());
    api.use("/api/v1", salesRouter);
    api.use(errorHandler);
    server = api.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server!.once("listening", resolve);
      server!.once("error", reject);
    });
    const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
    async function call(path: string, method = "GET", body?: unknown, token?: string) {
      const response = await fetch(base + path, {
        method,
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(token ? { authorization: "Bearer " + token } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() as any };
    }
    const path = "/api/v1/public/saas-sales/leads";
    const input = {
      organizationName: org, contactName: "Synthetic Institution Owner",
      mobile: "9876543210", email: "schoolos-" + id + "@example.test",
      institutionType: "Coaching Institute", studentCountBand: "Under 500",
      source: "WEBSITE", campaign: "SCHOOLOS_V5_PRIVATE_DEMO",
      requirements: ["lms", "crm"],
      utm: { intent: "B2B_PRODUCT_DEMO", product: "ADHYAY_SCHOOLOS",
        stage: "PRIVATE_DEMO_ONLY", contactConsent: "yes" },
    };
    const noConsent = await call(path, "POST", { ...input, utm: { ...input.utm, contactConsent: "no" } });
    assert.equal(noConsent.status, 422);
    assert.equal(noConsent.body.error.code, "SCHOOLOS_CONTACT_CONSENT_REQUIRED");
    const forgedSource = await call(path, "POST", { ...input, source: "PARTNER" });
    assert.equal(forgedSource.status, 422);
    assert.equal(forgedSource.body.error.code, "VALIDATION_ERROR");
    assert.equal(await systemPrisma.saaSSalesLead.count({ where: { organizationName: org } }), 0);

    const attempts = await Promise.all(Array.from({ length: 3 }, () => call(path, "POST", input)));
    assert.deepEqual(attempts.map(result => result.status).sort(), [200, 200, 201]);
    assert.equal(new Set(attempts.map(result => result.body.data.id)).size, 1);
    assert.equal(await systemPrisma.saaSSalesLead.count({ where: { organizationName: org } }), 1);
    const record = await systemPrisma.saaSSalesLead.findFirstOrThrow({ where: { organizationName: org } });
    assert.equal(record.source, "WEBSITE");
    assert.equal(record.campaign, "SCHOOLOS_V5_PRIVATE_DEMO");
    assert.equal(record.qualification, "MQL");
    assert.equal(record.recommendedPlan, "GROWTH");
    const utm = record.utm as Record<string, string>;
    assert.equal(utm.contactConsent, "yes");
    assert.equal(utm.product, "ADHYAY_SCHOOLOS");
    assert.ok(Number.isFinite(Date.parse(utm.contactConsentRecordedAt)));

    const listPath = "/api/v1/platform/sales/leads?search=" + encodeURIComponent(org);
    assert.equal((await call(listPath)).status, 401);
    const admin = await systemPrisma.user.create({ data: {
      organizationId: "org_default", email: "schoolos-platform-" + id + "@example.test",
      passwordHash: "synthetic-test-only", name: "Synthetic Sales Admin", role: Role.SUPER_ADMIN,
    } });
    userId = admin.id;
    const token = jwt.sign({ userId, role: Role.SUPER_ADMIN, organizationId: "org_default" },
      env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
    const sales = await call(listPath, "GET", undefined, token);
    assert.equal(sales.status, 200, JSON.stringify(sales.body));
    assert.equal(sales.body.meta.total, 1);
    assert.equal(sales.body.data[0].id, record.id);
    console.log("SCHOOLOS_PRIVATE_DEMO_CONSENT=PASS");
    console.log("SCHOOLOS_PRIVATE_DEMO_CONCURRENT_DEDUPLICATION=PASS");
    console.log("SCHOOLOS_PRIVATE_DEMO_PLATFORM_CRM_HANDOFF=PASS");
    console.log("REAL_CUSTOMER_LEADS_CREATED=0");
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close(err => err ? reject(err) : resolve()));
    await systemPrisma.saaSSalesLead.deleteMany({ where: { organizationName: org } });
    if (userId) {
      await systemPrisma.tenantAccessAudit.deleteMany({ where: { userId } });
      await systemPrisma.user.delete({ where: { id: userId } });
    }
  }
});
