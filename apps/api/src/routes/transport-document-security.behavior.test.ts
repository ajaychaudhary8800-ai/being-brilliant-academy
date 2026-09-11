import "express-async-errors";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { Role } from "@prisma/client";
import express from "express";
import jwt from "jsonwebtoken";
import { env } from "../config.js";
import { errorHandler } from "../lib/http.js";
import { prisma, systemPrisma } from "../lib/prisma.js";
import transport from "./transport.js";

const ORG = "organization-transport-document-test";
const VEHICLE = "vehicle-transport-document-test";
const BRANCH = "branch-transport-document-test";
const DOCUMENT = "document-transport-document-test";
const bytes = Buffer.from("%PDF-1.7\ntransport document\n%%EOF");

test("transport vehicle documents validate uploads and authorize safe downloads", async t => {
  const patches: Array<() => void> = [];
  const patch = (target: any, property: string, replacement: (...args: any[]) => any) => {
    const original = target[property]; target[property] = replacement; patches.unshift(() => { target[property] = original; });
  };
  let assigned = [BRANCH];
  patch((systemPrisma as any).user, "findFirst", async () => ({ isActive: true }));
  let authOrganizationId = ORG;
  patch((systemPrisma as any).organization, "findUnique", async ({ where }: any) => where.id === authOrganizationId ? ({ id: ORG, isActive: true, deletedAt: null, subscriptionStatus: "ACTIVE", trialEndsAt: null, subscriptionEndsAt: null }) : null);
  patch((systemPrisma as any).tenantAccessAudit, "create", async () => ({}));
  patch((prisma as any).branchUser, "findMany", async () => assigned.map(branchId => ({ branchId })));
  patch((prisma as any).transportVehicle, "findUnique", async ({ where }: any) => where.id === VEHICLE ? { id: VEHICLE, branchId: BRANCH, seatCapacity: 40, status: "ACTIVE" } : null);
  let stored: any = { id: DOCUMENT, vehicleId: VEHICLE, type: "REGISTRATION", number: "REG-1", name: "..\\internal\r\nvehicle.pdf", mimeType: "application/pdf", data: bytes, vehicle: { id: VEHICLE, branchId: BRANCH } };
  patch((prisma as any).transportVehicleDocument, "create", async ({ data, select }: any) => { stored = { ...stored, ...data, id: DOCUMENT, vehicle: { id: VEHICLE, branchId: BRANCH } }; return select ? Object.fromEntries(Object.keys(select).filter(key => select[key]).map(key => [key, stored[key]])) : stored; });
  patch((prisma as any).transportVehicleDocument, "findUnique", async ({ where }: any) => where.id === DOCUMENT ? stored : null);

  const application = express(); application.use(express.json({ limit: "15mb" })); application.use("/api/v1", transport); application.use(errorHandler);
  const server = application.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const port = (server.address() as AddressInfo).port;
  let role: Role = Role.SUPER_ADMIN;
  const token = () => jwt.sign({ userId: "transport-admin", role, organizationId: ORG }, env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
  const request = (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}/api/v1${path}`, { ...init, headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json", ...init?.headers } });
  try {
    await t.test("invalid declared MIME/content is rejected", async () => {
      const response = await request(`/transport/vehicles/${VEHICLE}/documents`, { method: "POST", body: JSON.stringify({ type: "REGISTRATION", number: "REG-2", name: "bad.png", mimeType: "image/png", base64: bytes.toString("base64") }) });
      assert.equal(response.status, 422);
    });
    await t.test("valid upload is stored and authorized administrator can download safe bytes", async () => {
      const upload = await request(`/transport/vehicles/${VEHICLE}/documents`, { method: "POST", body: JSON.stringify({ type: "REGISTRATION", number: "REG-2", name: "vehicle.pdf", mimeType: "application/pdf", base64: bytes.toString("base64") }) });
      assert.equal(upload.status, 201);
      const uploadBody = await upload.json() as { data: Record<string, unknown> };
      assert.equal(Object.hasOwn(uploadBody.data, "data"), false);
      assert.equal(Object.hasOwn(uploadBody.data, "base64"), false);
      const download = await request(`/transport/vehicles/${VEHICLE}/documents/${DOCUMENT}/download`);
      assert.equal(download.status, 200);
      assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
      assert.equal(download.headers.get("content-type"), "application/pdf");
      assert.equal(download.headers.get("content-length"), String(bytes.length));
      const disposition = download.headers.get("content-disposition") ?? "";
      assert.match(disposition, /^attachment; filename="/);
      assert.doesNotMatch(disposition, /[\r\n\0]|internal/);
    });
    await t.test("a different organization cannot download the document", async () => {
      authOrganizationId = "another-organization";
      const response = await request(`/transport/vehicles/${VEHICLE}/documents/${DOCUMENT}/download`);
      assert.equal(response.status, 402);
      authOrganizationId = ORG;
    });
    await t.test("an unauthorized role cannot download the document", async () => {
      role = Role.STUDENT;
      const response = await request(`/transport/vehicles/${VEHICLE}/documents/${DOCUMENT}/download`);
      assert.equal(response.status, 403);
      role = Role.SUPER_ADMIN;
    });
    await t.test("unassigned branch administrator is denied", async () => {
      role = Role.BRANCH_ADMIN; assigned = ["another-branch"];
      const response = await request(`/transport/vehicles/${VEHICLE}/documents/${DOCUMENT}/download`);
      assert.equal(response.status, 403);
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const restore of patches) restore();
  }
});
