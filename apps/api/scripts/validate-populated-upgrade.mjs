import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import "dotenv/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, "..");
const sourcePrisma = path.join(apiRoot, "prisma");
const base = new URL(process.env.MIGRATION_VALIDATION_DATABASE_URL ?? process.env.DATABASE_URL ?? "");
if (!new Set(["localhost", "127.0.0.1", "::1"]).has(base.hostname)) throw new Error("Populated migration validation is restricted to a local PostgreSQL server");
const successName = `bba_migration_validation_populated_${process.pid}`;
const rejectName = `bba_migration_validation_reject_${process.pid}`;
const freshName = `bba_migration_validation_fresh_${process.pid}`;
const adminUrl = new URL(base); adminUrl.pathname = "/postgres"; adminUrl.search = "";
const urlFor = name => { const value = new URL(base); value.pathname = `/${name}`; return value.toString(); };
const prismaBin = process.execPath;
const prismaCli = path.join(apiRoot, "node_modules", "prisma", "build", "index.js");
const tsxCli = path.join(apiRoot, "node_modules", "tsx", "dist", "cli.mjs");

function run(bin, args, databaseUrl, expectSuccess = true) {
  const result = spawnSync(bin, args, { cwd: apiRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: "utf8" });
  if (expectSuccess && result.status !== 0) throw new Error(`${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  if (!expectSuccess && result.status === 0) throw new Error(`${args.join(" ")} unexpectedly succeeded`);
  return `${result.stdout}\n${result.stderr}`;
}

async function client(databaseUrl) { return new PrismaClient({ datasourceUrl: databaseUrl }); }
async function dropDatabase(admin, name) {
  if (!name.startsWith("bba_migration_validation_")) throw new Error(`Unsafe disposable database name: ${name}`);
  await admin.$executeRawUnsafe(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`);
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`);
}

const temporary = await mkdtemp(path.join(os.tmpdir(), "bba-prisma-upgrade-"));
const tempPrisma = path.join(temporary, "prisma");
const tempMigrations = path.join(tempPrisma, "migrations");
const admin = await client(adminUrl.toString());
try {
  await dropDatabase(admin, successName); await dropDatabase(admin, rejectName); await dropDatabase(admin, freshName);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${successName}"`);
  await mkdir(tempMigrations, { recursive: true });
  await cp(path.join(sourcePrisma, "schema.prisma"), path.join(tempPrisma, "schema.prisma"));
  await cp(path.join(sourcePrisma, "migrations", "migration_lock.toml"), path.join(tempMigrations, "migration_lock.toml"));
  const migrationNames = (await import("node:fs/promises")).readdir(path.join(sourcePrisma, "migrations"), { withFileTypes: true });
  for (const entry of await migrationNames) if (entry.isDirectory() && entry.name < "20260820090000") await cp(path.join(sourcePrisma, "migrations", entry.name), path.join(tempMigrations, entry.name), { recursive: true });
  run(prismaBin, [prismaCli, "migrate", "deploy", "--schema", path.join(tempPrisma, "schema.prisma")], urlFor(successName));

  const db = await client(urlFor(successName));
  try {
    const [session] = await db.$queryRawUnsafe(`SELECT id, name FROM "AcademicSession" WHERE "organizationId"='org_default' AND "isCurrent" LIMIT 1`);
    const [adminUser] = await db.$queryRawUnsafe(`SELECT id FROM "User" WHERE "organizationId"='org_default' AND role='SUPER_ADMIN' LIMIT 1`);
    if (!session || !adminUser) throw new Error("Legacy migration chain did not provision its required organization session and administrator");
    const branch = { id: `audit-branch-${crypto.randomBytes(6).toString("hex")}` };
    const course = { id: `audit-course-${crypto.randomBytes(6).toString("hex")}` };
    const batch = { id: `audit-batch-${crypto.randomBytes(6).toString("hex")}`, academicSessionId: session.id };
    const teacher = { id: `audit-teacher-${crypto.randomBytes(6).toString("hex")}`, userId: `audit-user-${crypto.randomBytes(6).toString("hex")}` };
    await db.$executeRawUnsafe(`INSERT INTO "Branch" (id,code,name,"organizationId","createdAt","updatedAt") VALUES ('${branch.id}','AUDIT-BRANCH','Audit Legacy Branch','org_default',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
    await db.$executeRawUnsafe(`INSERT INTO "User" (id,email,"passwordHash",name,role,"organizationId","createdAt","updatedAt") VALUES ('${teacher.userId}','audit-teacher@example.invalid','not-a-login-credential','Audit Legacy Teacher','TEACHER','org_default',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
    await db.$executeRawUnsafe(`INSERT INTO "TeacherProfile" (id,"userId","employeeNo","branchId","organizationId","createdAt","updatedAt") VALUES ('${teacher.id}','${teacher.userId}','AUDIT-EMPLOYEE','${branch.id}','org_default',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
    await db.$executeRawUnsafe(`INSERT INTO "Course" (id,title,slug,"courseCode",description,type,price,"branchId","organizationId","createdAt","updatedAt") VALUES ('${course.id}','Audit Legacy Course','audit-legacy-course','AUDIT-COURSE','Legacy populated upgrade fixture','OTHER',10000,'${branch.id}','org_default',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
    await db.$executeRawUnsafe(`INSERT INTO "Batch" (id,name,code,"branchId","courseId","academicSession","academicSessionId","startsAt","organizationId","createdAt","updatedAt") VALUES ('${batch.id}','Audit Legacy Batch','AUDIT-BATCH','${branch.id}','${course.id}','${session.name}','${session.id}',DATE '2026-04-01','org_default',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
    const subjectId = `audit-${crypto.randomBytes(8).toString("hex")}`;
    await db.$executeRawUnsafe(`INSERT INTO "Subject" (id,"organizationId",name,code,"createdAt") VALUES ('${subjectId}','org_default','Physics','AUDIT-PHYSICS',CURRENT_TIMESTAMP)`);
    await db.$executeRawUnsafe(`INSERT INTO "CourseSubject" ("organizationId","courseId","subjectId",position,"isActive") VALUES ('org_default','${course.id}','${subjectId}',0,false)`);
    const allocationId = `audit-${crypto.randomBytes(8).toString("hex")}`;
    await db.$executeRawUnsafe(`INSERT INTO "TeacherAllocation" (id,"organizationId","branchId","academicSessionId","courseId","batchId","teacherId","subjectName","weeklyPeriods","effectiveFrom",status,"createdById","updatedById","createdAt","updatedAt") VALUES ('${allocationId}','org_default','${branch.id}','${batch.academicSessionId}','${course.id}','${batch.id}','${teacher.id}','Physics',5,DATE '2026-04-01','ACTIVE','${adminUser.id}','${adminUser.id}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
    await db.$executeRawUnsafe(`INSERT INTO "LeaveRequest" (id,"organizationId","userId","branchId","fromDate","toDate",reason,status,"createdAt","updatedAt") VALUES ('audit-approved-leave','org_default','${teacher.userId}','${branch.id}',DATE '2026-08-20',DATE '2026-08-20','Legacy approved leave','APPROVED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
  } finally { await db.$disconnect(); }

  await admin.$executeRawUnsafe(`CREATE DATABASE "${rejectName}" TEMPLATE "${successName}"`);
  for (const entry of await migrationNames) if (entry.isDirectory() && entry.name >= "20260820090000") await cp(path.join(sourcePrisma, "migrations", entry.name), path.join(tempMigrations, entry.name), { recursive: true });
  run(prismaBin, [prismaCli, "migrate", "deploy", "--schema", path.join(tempPrisma, "schema.prisma")], urlFor(successName));
  const verified = await client(urlFor(successName));
  try {
    const [allocation] = await verified.$queryRawUnsafe(`SELECT "subjectId" FROM "TeacherAllocation" WHERE id LIKE 'audit-%'`);
    const [link] = await verified.$queryRawUnsafe(`SELECT "isActive" FROM "CourseSubject" WHERE "subjectId"='${allocation.subjectId}'`);
    const [leave] = await verified.$queryRawUnsafe(`SELECT status::text status FROM "LeaveRequest" WHERE id='audit-approved-leave'`);
    if (!allocation.subjectId || link.isActive !== false || leave.status !== "APPROVED") throw new Error("Populated upgrade changed protected legacy business state");
  } finally { await verified.$disconnect(); }

  const reject = await client(urlFor(rejectName));
  try { await reject.$executeRawUnsafe(`UPDATE "LeaveRequest" SET status='LEGACY_UNKNOWN' WHERE id='audit-approved-leave'`); } finally { await reject.$disconnect(); }
  const failure = run(prismaBin, [prismaCli, "migrate", "deploy", "--schema", path.join(tempPrisma, "schema.prisma")], urlFor(rejectName), false);
  if (!failure.includes("Explicitly map these legacy values")) throw new Error(`Unknown leave status did not produce the expected safe migration failure\n${failure}`);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${freshName}"`);
  run(prismaBin, [prismaCli, "migrate", "deploy", "--schema", path.join(tempPrisma, "schema.prisma")], urlFor(freshName));
  run(prismaBin, [tsxCli, "prisma/seed.ts"], urlFor(freshName));
  const fresh = await client(urlFor(freshName));
  try {
    const [state] = await fresh.$queryRawUnsafe(`SELECT (SELECT count(*)::int FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) migrations, (SELECT count(*)::int FROM "User") users, (SELECT count(*)::int FROM "AcademicSession") sessions`);
    if (state.migrations < 1 || state.users < 1 || state.sessions < 1) throw new Error("Fresh migration or seed verification returned empty required data");
  } finally { await fresh.$disconnect(); }
  console.log(JSON.stringify({ populatedUpgrade: "PASS", freshMigrationAndSeed: "PASS", approvedLeavePreserved: true, inactiveCourseSubjectPreserved: true, unknownLeaveStatusRejected: true }));
} finally {
  await dropDatabase(admin, successName).catch(() => undefined); await dropDatabase(admin, rejectName).catch(() => undefined); await dropDatabase(admin, freshName).catch(() => undefined); await admin.$disconnect(); await rm(temporary, { recursive: true, force: true });
}
