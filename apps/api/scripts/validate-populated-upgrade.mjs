import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
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

  const branch = { id: `audit-branch-${crypto.randomBytes(6).toString("hex")}` };
  const course = { id: `audit-course-${crypto.randomBytes(6).toString("hex")}` };
  const teacher = { id: `audit-teacher-${crypto.randomBytes(6).toString("hex")}`, userId: `audit-user-${crypto.randomBytes(6).toString("hex")}` };
  const allocationId = `audit-${crypto.randomBytes(8).toString("hex")}`;
  const ambiguousAllocationId = `audit-ambiguous-${crypto.randomBytes(6).toString("hex")}`;
  const db = await client(urlFor(successName));
  try {
    const [session] = await db.$queryRawUnsafe(`SELECT id, name FROM "AcademicSession" WHERE "organizationId"='org_default' AND "isCurrent" LIMIT 1`);
    const [adminUser] = await db.$queryRawUnsafe(`SELECT id FROM "User" WHERE "organizationId"='org_default' AND role='SUPER_ADMIN' LIMIT 1`);
    if (!session || !adminUser) throw new Error("Legacy migration chain did not provision its required organization session and administrator");
    const batch = { id: `audit-batch-${crypto.randomBytes(6).toString("hex")}`, academicSessionId: session.id };
    await db.$executeRawUnsafe(`INSERT INTO "Branch" (id,code,name,"organizationId","createdAt","updatedAt") VALUES ('${branch.id}','AUDIT-BRANCH','Audit Legacy Branch','org_default',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
    await db.$executeRawUnsafe(`INSERT INTO "User" (id,email,"passwordHash",name,role,"organizationId","createdAt","updatedAt") VALUES ('${teacher.userId}','audit-teacher@example.invalid','not-a-login-credential','Audit Legacy Teacher','TEACHER','org_default',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
    await db.$executeRawUnsafe(`INSERT INTO "TeacherProfile" (id,"userId","employeeNo","branchId","organizationId",specialization,"createdAt","updatedAt") VALUES ('${teacher.id}','${teacher.userId}','AUDIT-EMPLOYEE','${branch.id}','org_default','Physics / Mathematics',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
    await db.$executeRawUnsafe(`INSERT INTO "Course" (id,title,slug,"courseCode",description,type,price,"branchId","organizationId","createdAt","updatedAt") VALUES ('${course.id}','Audit Legacy Course','audit-legacy-course','AUDIT-COURSE','Legacy populated upgrade fixture','OTHER',10000,'${branch.id}','org_default',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
    await db.$executeRawUnsafe(`INSERT INTO "Batch" (id,name,code,"branchId","courseId","academicSession","academicSessionId","startsAt","organizationId","createdAt","updatedAt") VALUES ('${batch.id}','Audit Legacy Batch','AUDIT-BATCH','${branch.id}','${course.id}','${session.name}','${session.id}',DATE '2026-04-01','org_default',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
    const subjectId = `audit-${crypto.randomBytes(8).toString("hex")}`;
    await db.$executeRawUnsafe(`INSERT INTO "Subject" (id,"organizationId",name,code,"createdAt") VALUES ('${subjectId}','org_default','Physics','AUDIT-PHYSICS',CURRENT_TIMESTAMP)`);
    await db.$executeRawUnsafe(`INSERT INTO "CourseSubject" ("organizationId","courseId","subjectId",position,"isActive") VALUES ('org_default','${course.id}','${subjectId}',0,false)`);
    await db.$executeRawUnsafe(`INSERT INTO "TeacherAllocation" (id,"organizationId","branchId","academicSessionId","courseId","batchId","teacherId","subjectName","weeklyPeriods","effectiveFrom",status,"createdById","updatedById","createdAt","updatedAt") VALUES ('${allocationId}','org_default','${branch.id}','${batch.academicSessionId}','${course.id}','${batch.id}','${teacher.id}','Physics',5,DATE '2026-04-01','ACTIVE','${adminUser.id}','${adminUser.id}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
    await db.$executeRawUnsafe(`INSERT INTO "TeacherAllocation" (id,"organizationId","branchId","academicSessionId","courseId","batchId","teacherId","subjectName","weeklyPeriods","effectiveFrom",status,"createdById","updatedById","createdAt","updatedAt") VALUES ('${ambiguousAllocationId}','org_default','${branch.id}','${batch.academicSessionId}','${course.id}','${batch.id}','${teacher.id}','Physics + Mathematics',3,DATE '2026-04-01','INACTIVE','${adminUser.id}','${adminUser.id}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
    await db.$executeRawUnsafe(`INSERT INTO "LeaveRequest" (id,"organizationId","userId","branchId","fromDate","toDate",reason,status,"createdAt","updatedAt") VALUES ('audit-approved-leave','org_default','${teacher.userId}','${branch.id}',DATE '2026-08-20',DATE '2026-08-20','Legacy approved leave','APPROVED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
  } finally { await db.$disconnect(); }

  await admin.$executeRawUnsafe(`CREATE DATABASE "${rejectName}" TEMPLATE "${successName}"`);
  for (const entry of await migrationNames) if (entry.isDirectory() && entry.name >= "20260820090000") await cp(path.join(sourcePrisma, "migrations", entry.name), path.join(tempMigrations, entry.name), { recursive: true });
  run(prismaBin, [prismaCli, "migrate", "deploy", "--schema", path.join(tempPrisma, "schema.prisma")], urlFor(successName));
  const verified = await client(urlFor(successName));
  try {
    const preflightSql = await readFile(path.join(sourcePrisma, "preflight", "20260830_academic_architecture.sql"), "utf8");
    const preflightResults = [];
    for (const statement of preflightSql.split(/;\s*(?:\r?\n|$)/).map(value => value.trim()).filter(Boolean)) preflightResults.push(await verified.$queryRawUnsafe(statement));
    if (!preflightResults.flat().some(row => row.category === "AMBIGUOUS" && Number(row.records) === 1)) throw new Error("Academic architecture preflight did not identify the ambiguous legacy subject fixture");
    const [allocation] = await verified.$queryRawUnsafe(`SELECT "subjectId" FROM "TeacherAllocation" WHERE id='${allocationId}'`);
    const [link] = await verified.$queryRawUnsafe(`SELECT "isActive" FROM "CourseSubject" WHERE "subjectId"='${allocation.subjectId}'`);
    const [leave] = await verified.$queryRawUnsafe(`SELECT status::text status FROM "LeaveRequest" WHERE id='audit-approved-leave'`);
    const [ambiguous] = await verified.$queryRawUnsafe(`SELECT s."legacyReviewStatus"::text review FROM "TeacherAllocation" a JOIN "Subject" s ON s.id=a."subjectId" WHERE a.id='${ambiguousAllocationId}'`);
    const [teacherSubject] = await verified.$queryRawUnsafe(`SELECT count(*)::int count FROM "TeacherSubject" WHERE "teacherId"='${teacher.id}'`);
    const [organization] = await verified.$queryRawUnsafe(`SELECT "groupLabelType"::text label FROM "Organization" WHERE id='org_default'`);
    const [legacyCourse] = await verified.$queryRawUnsafe(`SELECT "taxonomyReviewStatus"::text review,"type"::text type,"classLevel"::text class FROM "Course" WHERE id='${course.id}'`);
    const [legacySpecialization] = await verified.$queryRawUnsafe(`SELECT t.specialization,s."legacyReviewStatus"::text review FROM "TeacherProfile" t JOIN "TeacherSpecialization" ts ON ts."teacherId"=t.id JOIN "Specialization" s ON s.id=ts."specializationId" WHERE t.id='${teacher.id}'`);
    if (!allocation.subjectId || link.isActive !== false || leave.status !== "APPROVED" || ambiguous.review !== "REVIEW_REQUIRED" || teacherSubject.count < 2 || organization.label !== "BATCH" || legacyCourse.review !== "REVIEW_REQUIRED" || legacyCourse.type !== "OTHER" || legacySpecialization.specialization !== "Physics / Mathematics" || legacySpecialization.review !== "REVIEW_REQUIRED") throw new Error("Populated upgrade changed protected legacy state or failed additive academic backfill");
    const taxonomyPreflight = await readFile(path.join(sourcePrisma, "preflight", "20260831_course_taxonomy.sql"), "utf8");
    const taxonomyFindings = [];
    for (const statement of taxonomyPreflight.split(/;\s*(?:\r?\n|$)/).map(value => value.trim()).filter(Boolean)) taxonomyFindings.push(await verified.$queryRawUnsafe(statement));
    if (!taxonomyFindings.flat().some(row => row.category === "AMBIGUOUS_LEGACY_SPECIALIZATION" && Number(row.records) >= 1)) throw new Error("Course taxonomy preflight did not identify the ambiguous legacy specialization fixture");
    let duplicateSubjectRejected = false;
    try { await verified.$executeRawUnsafe(`INSERT INTO "Subject" (id,"organizationId",name,code,"createdAt","updatedAt") VALUES ('audit-duplicate-subject','org_default',' physics ','AUDIT-DUPLICATE',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`); } catch { duplicateSubjectRejected = true; }
    if (!duplicateSubjectRejected) throw new Error("Case-insensitive tenant subject duplicate protection did not reject a normalized duplicate");
    let duplicateAllocationRejected = false;
    try { await verified.$executeRawUnsafe(`INSERT INTO "TeacherAllocation" (id,"organizationId","branchId","academicSessionId","courseId","batchId","teacherId","subjectId","subjectName","weeklyPeriods","effectiveFrom",status,"createdById","updatedById","createdAt","updatedAt") SELECT 'audit-duplicate-allocation',"organizationId","branchId","academicSessionId","courseId","batchId","teacherId","subjectId","subjectName","weeklyPeriods","effectiveFrom",status,"createdById","updatedById",CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM "TeacherAllocation" WHERE id='${allocationId}'`); } catch { duplicateAllocationRejected = true; }
    if (!duplicateAllocationRejected) throw new Error("Duplicate active normalized teacher allocation protection did not reject a duplicate");
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
    const [state] = await fresh.$queryRawUnsafe(`SELECT (SELECT count(*)::int FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) migrations, (SELECT count(*)::int FROM "User") users, (SELECT count(*)::int FROM "AcademicSession") sessions, (SELECT count(*)::int FROM "CompetitiveExam") exams, (SELECT count(*)::int FROM "SkillCategory") skills, (SELECT count(*)::int FROM "Specialization") specializations, (SELECT count(*)::int FROM "TeacherSubject") teacher_subjects`);
    if (state.migrations < 1 || state.users < 1 || state.sessions < 1 || state.exams < 1 || state.skills < 1 || state.specializations < 1 || state.teacher_subjects < 1) throw new Error("Fresh migration or seed verification returned empty required academic data");
  } finally { await fresh.$disconnect(); }
  console.log(JSON.stringify({ preflightSql: "PASS", courseTaxonomyPreflight: "PASS", populatedUpgrade: "PASS", freshMigrationAndSeed: "PASS", approvedLeavePreserved: true, inactiveCourseSubjectPreserved: true, ambiguousLegacySubjectFlagged: true, ambiguousLegacySpecializationFlagged: true, legacyCourseClassificationPreserved: true, teacherSubjectsBackfilled: true, subjectDuplicateProtection: true, activeAllocationDuplicateProtection: true, unknownLeaveStatusRejected: true }));
} finally {
  await dropDatabase(admin, successName).catch(() => undefined); await dropDatabase(admin, rejectName).catch(() => undefined); await dropDatabase(admin, freshName).catch(() => undefined); await admin.$disconnect(); await rm(temporary, { recursive: true, force: true });
}
