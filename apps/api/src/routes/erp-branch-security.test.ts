import "express-async-errors";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { LibraryCopyStatus, PaymentMode, Role, TransportStatus } from "@prisma/client";
import express from "express";
import jwt from "jsonwebtoken";
import { env } from "../config.js";
import { errorHandler } from "../lib/http.js";
import { prisma, systemPrisma } from "../lib/prisma.js";
import hostel from "./hostel.js";
import inventory from "./inventory.js";
import library from "./library.js";
import transport from "./transport.js";

const id = (suffix: string) => `cerp000000000000000000${suffix}`;
const ORGANIZATION = id("01"), BRANCH_A = id("02"), BRANCH_B = id("03"), USER = id("04"), BRANCH_OTHER_TENANT = id("05");

test("legacy ERP routers enforce BranchUser isolation and preserve Super Admin scope", async t => {
  let assignedBranches = [BRANCH_A];
  let inventoryAssetBranch = BRANCH_B;
  let branchScopeWhere: any, transportVehicleWhere: any, transportAssignmentWhere: any, transportReportWhere: any, hostelWhere: any, hostelAllocationWhere: any, hostelReportWhere: any;
  let libraryWhere: any, libraryReportWhere: any, inventoryWhere: any, inventoryReportWhere: any;
  let transportCreates = 0, transportUpdates = 0, transportDeletes = 0, hostelCreates = 0, libraryCreates = 0, inventoryCreates = 0, financialWrites = 0;
  const patches: Array<() => void> = [];
  function patch(object: any, property: string, replacement: (...args: any[]) => any) {
    const original = object[property]; object[property] = replacement; patches.unshift(() => { object[property] = original; });
  }

  patch((systemPrisma as any).organization, "findUnique", async () => ({ id: ORGANIZATION, isActive: true, deletedAt: null, subscriptionStatus: "ACTIVE", trialEndsAt: null, subscriptionEndsAt: null }));
  patch((systemPrisma as any).user, "findFirst", async () => ({ isActive: true }));
  patch((systemPrisma as any).tenantAccessAudit, "create", async () => ({}));
  patch((prisma as any).branchUser, "findMany", async ({ where }: any) => { branchScopeWhere = where; return assignedBranches.map(branchId => ({ branchId })); });
  patch((prisma as any).branch, "findFirst", async ({ where }: any) => [BRANCH_A, BRANCH_B].includes(where.id) ? { id: where.id } : null);

  patch((prisma as any).transportVehicle, "findMany", async ({ where }: any) => { transportVehicleWhere = where; return []; });
  patch((prisma as any).transportVehicle, "count", async () => 0);
  patch((prisma as any).transportVehicle, "findFirst", async () => null);
  patch((prisma as any).transportVehicle, "findUnique", async ({ where }: any) => ({ id: where.id, branchId: where.id === id("11") ? BRANCH_B : BRANCH_A, typeId: id("12"), seatCapacity: 20, status: TransportStatus.ARCHIVED, _count: { studentAssignments: 0, routes: 0, trips: 0 } }));
  patch((prisma as any).transportVehicle, "create", async ({ data }: any) => { transportCreates += 1; return { id: id("10"), ...data }; });
  patch((prisma as any).transportVehicle, "update", async ({ data }: any) => { transportUpdates += 1; return { id: id("14"), branchId: BRANCH_A, ...data }; });
  patch((prisma as any).transportVehicle, "delete", async () => { transportDeletes += 1; return {}; });
  patch((prisma as any).transportVehicleType, "findUnique", async () => ({ seatCapacity: 40 }));
  patch((prisma as any).transportRoute, "findUnique", async () => ({ id: id("15"), branchId: BRANCH_A, vehicleId: id("14"), status: TransportStatus.ACTIVE }));
  patch((prisma as any).transportStop, "findMany", async () => [{ id: id("16"), branchId: BRANCH_A }, { id: id("17"), branchId: BRANCH_A }]);
  patch((prisma as any).transportRouteStop, "count", async () => 2);
  patch((prisma as any).studentProfile, "findUnique", async () => ({ branchId: BRANCH_B, status: "ACTIVE" }));
  patch((prisma as any).studentTransportAssignment, "findMany", async ({ where }: any) => { transportAssignmentWhere = where; return []; });
  patch((prisma as any).studentTransportAssignment, "findUnique", async () => ({ id: id("19"), studentId: id("18"), route: { branchId: BRANCH_A }, student: { branchId: BRANCH_B } }));
  patch((prisma as any).studentTransportAssignment, "create", async () => { financialWrites += 1; return {}; });
  patch((prisma as any).transportTrip, "findUnique", async () => ({ id: id("19"), vehicleId: id("11"), route: { branchId: BRANCH_A }, vehicle: { branchId: BRANCH_B } }));
  patch((prisma as any).transportFuelLog, "findMany", async ({ where }: any) => { transportReportWhere = where; return []; });
  patch((prisma as any).transportFeeBill, "findUnique", async () => ({ id: id("13"), amountPaise: 1000, finePaise: 0, discountPaise: 0, paidPaise: 0, assignment: { route: { branchId: BRANCH_B } } }));
  patch((prisma as any).transportFeePayment, "create", async () => { financialWrites += 1; return {}; });

  patch((prisma as any).hostel, "findMany", async ({ where }: any) => { hostelWhere = where; return []; });
  patch((prisma as any).hostel, "count", async () => 0);
  patch((prisma as any).hostel, "findUnique", async ({ where }: any) => ({ id: where.id, branchId: where.id === id("22") ? BRANCH_B : BRANCH_A }));
  patch((prisma as any).hostel, "create", async ({ data }: any) => { hostelCreates += 1; return { id: id("20"), ...data }; });
  patch((prisma as any).hostelAllocation, "findMany", async ({ where }: any) => { hostelAllocationWhere = where; return []; });
  patch((prisma as any).hostelAllocation, "findUnique", async () => ({ id: id("23"), hostelId: id("20"), studentId: id("24"), status: "ACTIVE", hostel: { id: id("20"), branchId: BRANCH_A }, student: { branchId: BRANCH_B }, bed: null }));
  patch((prisma as any).hostelFee, "findUnique", async () => ({ id: id("21"), amountPaise: 1000, finePaise: 0, discountPaise: 0, paidPaise: 0, allocation: { hostel: { branchId: BRANCH_B } } }));
  patch((prisma as any).hostelFeePayment, "create", async () => { financialWrites += 1; return {}; });
  patch((prisma as any).hostelVisitor, "findMany", async ({ where }: any) => { hostelReportWhere = where; return []; });

  patch((prisma as any).libraryBook, "findMany", async ({ where }: any) => { libraryWhere = where; return []; });
  patch((prisma as any).libraryBook, "count", async () => 0);
  patch((prisma as any).libraryBook, "findUnique", async ({ where }: any) => ({ id: where.id, branchId: where.id === id("34") ? BRANCH_B : BRANCH_A, categoryId: id("35"), publisherId: null, isArchived: false, _count: { copies: 0, digitalResources: 0, purchases: 0, reservations: 0 } }));
  patch((prisma as any).libraryShelf, "create", async ({ data }: any) => { libraryCreates += 1; return { id: id("30"), ...data }; });
  patch((prisma as any).user, "findUnique", async () => ({ role: Role.TEACHER, isActive: true, studentProfile: null, teacherProfile: { branchId: BRANCH_B }, employee: null }));
  patch((prisma as any).libraryMember, "findUnique", async () => ({ id: id("31"), branchId: BRANCH_A, active: true, borrowLimit: 2, loanDays: 7 }));
  patch((prisma as any).libraryBookCopy, "findUnique", async () => ({ id: id("32"), bookId: id("33"), status: LibraryCopyStatus.AVAILABLE, book: { branchId: BRANCH_B } }));
  patch((prisma as any).libraryLoan, "create", async () => { financialWrites += 1; return {}; });
  patch((prisma as any).libraryFinePayment, "findMany", async ({ where }: any) => { libraryReportWhere = where; return []; });

  patch((prisma as any).enterpriseAsset, "findMany", async ({ where }: any) => { inventoryReportWhere = where; return []; });
  patch((prisma as any).enterpriseAsset, "count", async () => 0);
  patch((prisma as any).enterpriseAsset, "findUnique", async ({ where }: any) => where.id === id("42") ? null : ({ id: where.id, branchId: inventoryAssetBranch, categoryId: id("43"), custodianEmployeeId: null, purchaseCostPaise: 1000, residualValuePaise: 0, usefulLifeMonths: 12, purchaseDate: new Date(), depreciationMethod: "STRAIGHT_LINE" }));
  patch((prisma as any).assetCategory, "create", async ({ data }: any) => { inventoryCreates += 1; return { id: id("40"), ...data }; });
  patch((prisma as any).inventoryStore, "findUnique", async ({ where }: any) => ({ id: where.id, branchId: BRANCH_B }));
  patch((prisma as any).inventoryStockLot, "findMany", async () => []);
  patch((prisma as any).inventoryStore, "count", async () => 0);
  patch((prisma as any).assetMaintenanceTicket, "count", async () => 0);
  patch((prisma as any).inventoryItem, "count", async () => 0);
  patch((prisma as any).assetMaintenanceTicket, "findMany", async ({ where }: any) => { inventoryWhere = where; return []; });
  patch(prisma as any, "$transaction", async (operations: any) => Array.isArray(operations) ? Promise.all(operations) : operations({}));

  const application = express();
  application.use(express.json());
  application.use("/api/v1", transport, hostel, library, inventory);
  application.use(errorHandler);
  const server = application.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const port = (server.address() as AddressInfo).port;
  const token = (role: Role) => jwt.sign({ userId: USER, role, organizationId: ORGANIZATION }, env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
  async function request(path: string, role: Role, options: { method?: string; body?: unknown } = {}) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: options.method ?? "GET", headers: { Authorization: `Bearer ${token(role)}`, ...(options.body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
    const payload = await response.json().catch(() => null);
    return { status: response.status, payload };
  }
  const denied = (response: { status: number; payload: any }) => { assert.equal(response.status, 403); assert.equal(response.payload.error.code, "BRANCH_FORBIDDEN"); };

  try {
    await t.test("Branch Admin lists and reports are constrained to assigned branches", async () => {
      assert.equal((await request("/api/v1/transport/vehicles", Role.BRANCH_ADMIN)).status, 200);
      assert.equal(branchScopeWhere.organizationId, ORGANIZATION);
      assert.equal(branchScopeWhere.userId, USER);
      assert.equal(branchScopeWhere.branch.isActive, true);
      assert.deepEqual(transportVehicleWhere.branchId, { in: [BRANCH_A] });
      assert.equal((await request("/api/v1/transport/reports/fuel", Role.BRANCH_ADMIN)).status, 200);
      assert.deepEqual(transportReportWhere.vehicle.branchId, { in: [BRANCH_A] });
      assert.equal((await request("/api/v1/transport/assignments", Role.BRANCH_ADMIN)).status, 200);
      assert.deepEqual(transportAssignmentWhere.route.branchId, { in: [BRANCH_A] });
      assert.deepEqual(transportAssignmentWhere.student.branchId, { in: [BRANCH_A] });
      assert.deepEqual(transportAssignmentWhere.vehicle.branchId, { in: [BRANCH_A] });
      assert.equal((await request("/api/v1/hostel/hostels", Role.BRANCH_ADMIN)).status, 200);
      assert.deepEqual(hostelWhere.branchId, { in: [BRANCH_A] });
      assert.equal((await request("/api/v1/hostel/allocations?search=student", Role.BRANCH_ADMIN)).status, 200);
      assert.deepEqual(hostelAllocationWhere.hostel.branchId, { in: [BRANCH_A] });
      assert.deepEqual(hostelAllocationWhere.student.branchId, { in: [BRANCH_A] });
      assert.equal(hostelAllocationWhere.student.user.name.contains, "student");
      assert.equal((await request("/api/v1/hostel/reports/visitors", Role.BRANCH_ADMIN)).status, 200);
      assert.deepEqual(hostelReportWhere.hostel.branchId, { in: [BRANCH_A] });
      assert.equal((await request("/api/v1/library/books", Role.BRANCH_ADMIN)).status, 200);
      assert.deepEqual(libraryWhere.branchId, { in: [BRANCH_A] });
      assert.equal((await request("/api/v1/library/reports/fines", Role.BRANCH_ADMIN)).status, 200);
      assert.deepEqual(libraryReportWhere.loan.member.branchId, { in: [BRANCH_A] });
      assert.deepEqual(libraryReportWhere.loan.copy.book.branchId, { in: [BRANCH_A] });
      assert.equal((await request("/api/v1/inventory/maintenance", Role.BRANCH_ADMIN)).status, 200);
      assert.deepEqual(inventoryWhere.branchId, { in: [BRANCH_A] });
      assert.equal((await request("/api/v1/inventory/reports/assets", Role.BRANCH_ADMIN)).status, 200);
      assert.deepEqual(inventoryReportWhere.branchId, { in: [BRANCH_A] });
    });

    await t.test("assigned-branch create and direct operations remain available", async () => {
      assert.equal((await request("/api/v1/transport/vehicles", Role.BRANCH_ADMIN, { method: "POST", body: { branchId: BRANCH_A, typeId: id("12"), vehicleNumber: "SEC-A01", seatCapacity: 20 } })).status, 201);
      assert.equal((await request("/api/v1/hostel/hostels", Role.BRANCH_ADMIN, { method: "POST", body: { branchId: BRANCH_A, code: "HA", name: "Hostel A", capacity: 10 } })).status, 201);
      assert.equal((await request("/api/v1/library/shelves", Role.BRANCH_ADMIN, { method: "POST", body: { branchId: BRANCH_A, name: "Shelf A", code: "SA", rack: "R1", capacity: 10 } })).status, 201);
      assert.equal((await request("/api/v1/inventory/asset-categories", Role.BRANCH_ADMIN, { method: "POST", body: { branchId: BRANCH_A, code: "CATA", name: "Category A", type: "OTHER", defaultUsefulLifeMonths: 12 } })).status, 201);
      assert.equal((await request(`/api/v1/transport/vehicles/${id("14")}`, Role.BRANCH_ADMIN, { method: "PATCH", body: { model: "Updated" } })).status, 200);
      inventoryAssetBranch = BRANCH_A;
      assert.equal((await request(`/api/v1/inventory/assets/${id("41")}/depreciation`, Role.BRANCH_ADMIN)).status, 200);
      inventoryAssetBranch = BRANCH_B;
      assert.equal((await request(`/api/v1/transport/vehicles/${id("14")}`, Role.BRANCH_ADMIN, { method: "DELETE" })).status, 204);
      assert.equal(transportCreates, 1); assert.equal(transportUpdates, 1); assert.equal(transportDeletes, 1); assert.equal(hostelCreates, 1); assert.equal(libraryCreates, 1); assert.equal(inventoryCreates, 1);
      transportCreates = transportUpdates = transportDeletes = hostelCreates = libraryCreates = inventoryCreates = financialWrites = 0;
    });

    await t.test("cross-branch create, direct ID, relationship and financial operations are denied", async () => {
      denied(await request("/api/v1/transport/vehicles", Role.BRANCH_ADMIN, { method: "POST", body: { branchId: BRANCH_B, typeId: id("12"), vehicleNumber: "SEC-001", seatCapacity: 20 } }));
      denied(await request(`/api/v1/transport/vehicles/${id("14")}`, Role.BRANCH_ADMIN, { method: "PATCH", body: { branchId: BRANCH_B } }));
      denied(await request(`/api/v1/transport/vehicles/${id("11")}`, Role.BRANCH_ADMIN, { method: "DELETE" }));
      denied(await request(`/api/v1/transport/fees/${id("13")}/pay`, Role.BRANCH_ADMIN, { method: "POST", body: { amountPaise: 100, mode: PaymentMode.CASH } }));
      denied(await request("/api/v1/hostel/hostels", Role.BRANCH_ADMIN, { method: "POST", body: { branchId: BRANCH_B, code: "HB", name: "Hostel B", capacity: 10 } }));
      denied(await request(`/api/v1/hostel/fees/${id("21")}/pay`, Role.BRANCH_ADMIN, { method: "POST", body: { amountPaise: 100, mode: PaymentMode.CASH } }));
      denied(await request("/api/v1/library/shelves", Role.BRANCH_ADMIN, { method: "POST", body: { branchId: BRANCH_B, name: "Shelf B", code: "SB", rack: "R1", capacity: 10 } }));
      const issue = await request("/api/v1/library/loans/issue", Role.BRANCH_ADMIN, { method: "POST", body: { memberId: id("31"), copyId: id("32") } });
      assert.equal(issue.status, 403); assert.equal(issue.payload.error.code, "BRANCH_FORBIDDEN");
      const teacherSubstitution = await request("/api/v1/library/members", Role.BRANCH_ADMIN, { method: "POST", body: { branchId: BRANCH_A, userId: id("36"), membershipNumber: "T-B", type: "TEACHER", borrowLimit: 2, loanDays: 7, finePerDayPaise: 10 } });
      assert.equal(teacherSubstitution.status, 422); assert.equal(teacherSubstitution.payload.error.code, "LIBRARY_BRANCH_MISMATCH");
      const studentSubstitution = await request("/api/v1/transport/assignments", Role.BRANCH_ADMIN, { method: "POST", body: { studentId: id("18"), routeId: id("15"), vehicleId: id("14"), pickupStopId: id("16"), dropStopId: id("17"), startsAt: new Date().toISOString(), monthlyFeePaise: 1000 } });
      assert.equal(studentSubstitution.status, 422); assert.equal(studentSubstitution.payload.error.code, "TRANSPORT_BRANCH_MISMATCH");
      assert.equal((await request(`/api/v1/transport/assignments/${id("19")}/attendance`, Role.BRANCH_ADMIN, { method: "POST", body: { date: new Date().toISOString(), pickupStatus: "PRESENT", dropStatus: "PRESENT" } })).status, 422);
      assert.equal((await request(`/api/v1/transport/trips/${id("19")}/gps`, Role.BRANCH_ADMIN, { method: "POST", body: { latitude: 1, longitude: 1, speed: 0 } })).status, 422);
      assert.equal((await request(`/api/v1/hostel/allocations/${id("23")}/checkout`, Role.BRANCH_ADMIN, { method: "PATCH" })).status, 422);
      denied(await request("/api/v1/inventory/asset-categories", Role.BRANCH_ADMIN, { method: "POST", body: { branchId: BRANCH_B, code: "CAT", name: "Category", type: "OTHER", defaultUsefulLifeMonths: 12 } }));
      denied(await request(`/api/v1/inventory/assets/${id("41")}/depreciation`, Role.BRANCH_ADMIN));
      denied(await request(`/api/v1/inventory/assets?branchId=${BRANCH_B}`, Role.BRANCH_ADMIN));
      assert.equal(transportCreates + hostelCreates + libraryCreates + inventoryCreates + financialWrites, 0);
    });

    await t.test("zero-branch Branch Admin receives empty scope and cannot create", async () => {
      assignedBranches = [];
      assert.equal((await request("/api/v1/transport/vehicles", Role.BRANCH_ADMIN)).status, 200);
      assert.deepEqual(transportVehicleWhere.branchId, { in: [] });
      assert.equal((await request("/api/v1/hostel/hostels", Role.BRANCH_ADMIN)).status, 200);
      assert.deepEqual(hostelWhere.branchId, { in: [] });
      assert.equal((await request("/api/v1/library/books", Role.BRANCH_ADMIN)).status, 200);
      assert.deepEqual(libraryWhere.branchId, { in: [] });
      denied(await request(`/api/v1/transport/vehicles/${id("14")}`, Role.BRANCH_ADMIN, { method: "DELETE" }));
      denied(await request("/api/v1/transport/vehicles", Role.BRANCH_ADMIN, { method: "POST", body: { branchId: BRANCH_A, typeId: id("12"), vehicleNumber: "ZERO-1", seatCapacity: 20 } }));
      denied(await request("/api/v1/inventory/item-categories", Role.BRANCH_ADMIN, { method: "POST", body: { code: "ZERO", name: "Zero", type: "OTHER" } }));
      assignedBranches = [BRANCH_A];
    });

    await t.test("cross-tenant branch IDs are rejected even for Super Admin", async () => {
      const response = await request("/api/v1/transport/vehicles", Role.SUPER_ADMIN, { method: "POST", body: { branchId: BRANCH_OTHER_TENANT, typeId: id("12"), vehicleNumber: "SEC-X01", seatCapacity: 20 } });
      assert.equal(response.status, 403);
      assert.equal(response.payload.error.code, "BRANCH_FORBIDDEN");
      assert.equal(transportCreates, 0);
      assert.equal((await request(`/api/v1/inventory/assets/${id("42")}/depreciation`, Role.SUPER_ADMIN)).status, 404);
    });

    await t.test("Super Admin remains organization-wide and other roles remain unauthorized", async () => {
      assert.equal((await request("/api/v1/transport/vehicles", Role.SUPER_ADMIN)).status, 200);
      assert.equal(transportVehicleWhere.branchId, undefined);
      assert.equal((await request("/api/v1/hostel/hostels", Role.SUPER_ADMIN)).status, 200);
      assert.equal(hostelWhere.branchId, undefined);
      assert.equal((await request("/api/v1/library/books", Role.SUPER_ADMIN)).status, 200);
      assert.equal(libraryWhere.branchId, undefined);
      assert.equal((await request("/api/v1/inventory/maintenance", Role.SUPER_ADMIN)).status, 200);
      assert.equal(inventoryWhere.branchId, undefined);
      assert.equal((await request("/api/v1/transport/vehicles", Role.SUPER_ADMIN, { method: "POST", body: { branchId: BRANCH_B, typeId: id("12"), vehicleNumber: "SEC-S01", seatCapacity: 20 } })).status, 201);
      for (const role of [Role.TEACHER, Role.STUDENT, Role.PARENT, Role.ACCOUNTANT]) {
        assert.equal((await request("/api/v1/hostel/hostels", role)).status, 403);
        assert.equal((await request("/api/v1/transport/vehicles", role)).status, 403);
      }
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const restore of patches) restore();
  }
});
