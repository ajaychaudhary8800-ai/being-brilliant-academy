import "express-async-errors";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { Prisma, Role, SubstitutionStatus, TimetableDay, TimetablePeriodType, TimetableStatus } from "@prisma/client";
import express from "express";
import jwt from "jsonwebtoken";
import { env } from "../config.js";
import { errorHandler } from "../lib/http.js";
import { prisma, systemPrisma } from "../lib/prisma.js";
import operations from "./admin-academic-operations.js";

const ORGANIZATION_ID = "organization-substitution-test";
const USER_ID = "super-admin-substitution-test";
const BRANCH_ID = "cbranch000000000000000001";
const SESSION_ID = "csession00000000000000001";
const TIMETABLE_ID = "ctimetable000000000000001";
const COURSE_ID = "ccourse000000000000000001";
const BATCH_ID = "cbatch0000000000000000001";
const SUBJECT_ID = "csubject00000000000000001";
const ORIGINAL_TEACHER_ID = "cteacher00000000000000001";
const SUBSTITUTE_TEACHER_ID = "cteacher00000000000000002";
const DATE = new Date("2099-01-05T00:00:00.000Z");

type StoredSubstitution = { id: string; substituteTeacherId: string; status: SubstitutionStatus };
type StoredAudit = { action: string; entity: string; entityId: string };
type Store = { substitutions: StoredSubstitution[]; audits: StoredAudit[] };

const knownError = (code: string) => new Prisma.PrismaClientKnownRequestError("Simulated transaction conflict", { code, clientVersion: "test" });

test("substitution production route rechecks availability and commits assignment with audit atomically", async t => {
  let store: Store;
  let originalOnLeave = true;
  let substituteOnLeave = false;
  let substituteActive = true;
  let occupied = false;
  let existingConflict = false;
  let failCreate = false;
  let failAudit = false;
  let transactionError: string | null = null;
  let transactionIsolation: string | null = null;
  let sequence = 0;

  const timetable = {
    id: TIMETABLE_ID,
    branchId: BRANCH_ID,
    academicSessionId: SESSION_ID,
    courseId: COURSE_ID,
    batchId: BATCH_ID,
    subjectId: SUBJECT_ID,
    teacherId: ORIGINAL_TEACHER_ID,
    day: TimetableDay.MONDAY,
    startMinute: 600,
    endMinute: 660,
    periodNumber: 1,
    status: TimetableStatus.ACTIVE,
    session: { startsAt: new Date("2099-01-01T00:00:00.000Z"), endsAt: new Date("2099-12-31T00:00:00.000Z") },
  };

  function reset() {
    store = { substitutions: [], audits: [] };
    originalOnLeave = true;
    substituteOnLeave = false;
    substituteActive = true;
    occupied = false;
    existingConflict = false;
    failCreate = false;
    failAudit = false;
    transactionError = null;
    transactionIsolation = null;
  }

  function transactionClient(local: Store) {
    return {
      leaveRequest: {
        findFirst: async ({ where }: any) => {
          const teacherId = where.user.teacherProfile.id;
          if (teacherId === ORIGINAL_TEACHER_ID) return originalOnLeave ? { id: "leave-original" } : null;
          if (teacherId === SUBSTITUTE_TEACHER_ID) return substituteOnLeave ? { id: "leave-substitute" } : null;
          return null;
        },
      },
      teacherProfile: {
        findUnique: async ({ where }: any) => where.id === SUBSTITUTE_TEACHER_ID ? {
          id: SUBSTITUTE_TEACHER_ID,
          branchId: BRANCH_ID,
          userId: "substitute-user",
          maxPeriodsPerDay: 6,
          user: { isActive: substituteActive, name: "Available Substitute" },
          subjects: [{ subjectId: SUBJECT_ID }],
          allocations: [{ id: "allocation-substitute" }],
        } : null,
      },
      timetable: { findFirst: async () => occupied ? { id: "occupied-timetable" } : null },
      teacherDuty: { findFirst: async () => null },
      teacherSubstitution: {
        findFirst: async () => existingConflict || local.substitutions.length ? { id: "existing-substitution" } : null,
        create: async ({ data }: any) => {
          if (failCreate) throw knownError("P2002");
          const saved = { id: `substitution-${++sequence}`, substituteTeacherId: data.substituteTeacherId, status: SubstitutionStatus.ASSIGNED };
          local.substitutions.push(saved);
          return {
            ...saved,
            date: data.date,
            reason: data.reason,
            createdAt: new Date(),
            updatedAt: new Date(),
            timetable: { id: TIMETABLE_ID, day: timetable.day, periodNumber: 1, startMinute: 600, endMinute: 660 },
            originalTeacher: { id: ORIGINAL_TEACHER_ID, employeeNo: "T-1", user: { name: "Absent Teacher" } },
            substituteTeacher: { id: SUBSTITUTE_TEACHER_ID, employeeNo: "T-2", user: { name: "Available Substitute" } },
            course: { id: COURSE_ID, title: "Route Course" },
            batch: { id: BATCH_ID, name: "Route Batch" },
            subject: { id: SUBJECT_ID, name: "Route Subject" },
            approvedBy: { id: USER_ID, name: "Route Admin" },
          };
        },
      },
      auditLog: {
        create: async ({ data }: any) => {
          if (failAudit) throw new Error("Simulated AuditLog failure");
          local.audits.push({ action: data.action, entity: data.entity, entityId: data.entityId });
          return data;
        },
      },
    };
  }

  const patches: Array<() => void> = [];
  function patch(target: any, property: string, replacement: (...args: any[]) => any) {
    const original = target[property];
    target[property] = replacement;
    patches.unshift(() => { target[property] = original; });
  }

  reset();
  patch((systemPrisma as any).organization, "findUnique", async () => ({ id: ORGANIZATION_ID, isActive: true, deletedAt: null, subscriptionStatus: "ACTIVE", trialEndsAt: null, subscriptionEndsAt: null }));
  patch((systemPrisma as any).user, "findFirst", async () => ({ isActive: true }));
  patch((systemPrisma as any).tenantAccessAudit, "create", async () => ({}));
  patch((prisma as any).branch, "findUnique", async ({ where }: any) => where.id === BRANCH_ID ? { id: BRANCH_ID } : null);
  patch((prisma as any).timetable, "findUnique", async ({ where }: any) => where.id === TIMETABLE_ID ? timetable : null);
  patch((prisma as any).timetablePeriod, "findMany", async () => [{ periodNumber: 1, type: TimetablePeriodType.TEACHING }, { periodNumber: 2, type: TimetablePeriodType.TEACHING }]);
  patch((prisma as any).timetable, "findMany", async () => []);
  patch((prisma as any).teacherSubstitution, "findMany", async () => []);
  patch((prisma as any).teacherDuty, "findMany", async () => []);
  patch(prisma as any, "$transaction", async (operation: any, options: any) => {
    transactionIsolation = options?.isolationLevel ?? null;
    if (transactionError) {
      const code = transactionError;
      transactionError = null;
      throw knownError(code);
    }
    const local: Store = { substitutions: store.substitutions.map(row => ({ ...row })), audits: store.audits.map(row => ({ ...row })) };
    const result = await operation(transactionClient(local));
    store = local;
    return result;
  });

  const application = express();
  application.use(express.json());
  application.use("/api/v1/admin", operations);
  application.use(errorHandler);
  const server = application.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const port = (server.address() as AddressInfo).port;
  const token = jwt.sign({ userId: USER_ID, role: Role.SUPER_ADMIN, organizationId: ORGANIZATION_ID }, env.JWT_ACCESS_SECRET, { expiresIn: "5m" });

  async function assign() {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/admin/substitutions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ timetableId: TIMETABLE_ID, date: DATE.toISOString(), substituteTeacherId: SUBSTITUTE_TEACHER_ID, reason: "Approved leave coverage" }),
    });
    return { status: response.status, payload: await response.json() as any };
  }

  try {
    await t.test("eligible free substitute is assigned with its audit in one serializable transaction", async () => {
      reset();
      const response = await assign();
      assert.equal(response.status, 201);
      assert.equal(transactionIsolation, "Serializable");
      assert.equal(store.substitutions.length, 1);
      assert.equal(store.audits.length, 1);
      assert.equal(store.audits[0]!.action, "ASSIGN");
      assert.equal(store.audits[0]!.entityId, store.substitutions[0]!.id);
    });

    await t.test("occupied, on-leave and inactive substitutes are rejected", async () => {
      for (const unavailable of ["occupied", "leave", "inactive"] as const) {
        reset();
        if (unavailable === "occupied") occupied = true;
        if (unavailable === "leave") substituteOnLeave = true;
        if (unavailable === "inactive") substituteActive = false;
        const response = await assign();
        assert.equal(response.status, 409);
        assert.equal(response.payload.error.code, "SUBSTITUTE_NOT_AVAILABLE");
        assert.equal(store.substitutions.length, 0);
        assert.equal(store.audits.length, 0);
      }
    });

    await t.test("the original teacher must have approved leave", async () => {
      reset();
      originalOnLeave = false;
      const response = await assign();
      assert.equal(response.status, 409);
      assert.equal(response.payload.error.code, "ORIGINAL_TEACHER_NOT_ON_LEAVE");
      assert.equal(store.substitutions.length, 0);
    });

    await t.test("existing availability conflicts and duplicate unique writes are rejected", async () => {
      reset();
      existingConflict = true;
      let response = await assign();
      assert.equal(response.status, 409);
      assert.equal(response.payload.error.code, "SUBSTITUTE_NOT_AVAILABLE");
      reset();
      failCreate = true;
      response = await assign();
      assert.equal(response.status, 409);
      assert.equal(response.payload.error.code, "SUBSTITUTION_ALREADY_ASSIGNED");
      assert.equal(store.substitutions.length, 0);
      assert.equal(store.audits.length, 0);
    });

    await t.test("P2034 maps to 409 SUBSTITUTE_NOT_AVAILABLE without partial writes", async () => {
      reset();
      transactionError = "P2034";
      const response = await assign();
      assert.equal(response.status, 409);
      assert.equal(response.payload.error.code, "SUBSTITUTE_NOT_AVAILABLE");
      assert.equal(store.substitutions.length, 0);
      assert.equal(store.audits.length, 0);
    });

    await t.test("AuditLog failure rolls back the created substitution", async () => {
      reset();
      failAudit = true;
      const response = await assign();
      assert.equal(response.status, 500);
      assert.equal(store.substitutions.length, 0);
      assert.equal(store.audits.length, 0);
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    for (const restore of patches) restore();
  }
});
