import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("connected-campus governance router is mounted on the existing connected-campus API prefix", async () => {
  const server = await readFile(new URL("../server.ts", import.meta.url), "utf8");
  assert.match(server, /import connectedCampusGovernance from ".\/routes\/connected-campus-governance\.js"/);
  assert.match(server, /onlyPaths\(\["\/connected-campus"\], connectedCampusGovernance\)/);
});

test("parent privacy routes require a linked active child and never auto-delete data", async () => {
  const routes = await readFile(new URL("./connected-campus-governance.ts", import.meta.url), "utf8");
  assert.match(routes, /parentStudent\.findFirst/);
  assert.match(routes, /parentId: req\.auth!\.userId/);
  assert.match(routes, /CHILD_ACCESS_DENIED/);
  assert.match(routes, /automaticDeletion: false/);
  assert.match(routes, /Deletion\/restriction requests require identity verification/);
  assert.doesNotMatch(routes, /studentProfile\.delete/);
  assert.doesNotMatch(routes, /user\.delete/);
});

test("retention policy replacement is audited and preserves historical policy rows", async () => {
  const routes = await readFile(new URL("./connected-campus-governance.ts", import.meta.url), "utf8");
  const start = routes.indexOf('router.post("/connected-campus/governance/retention-policies"');
  assert.ok(start >= 0);
  const section = routes.slice(start, start + 6000);
  assert.match(section, /privacyRetentionPolicy\.updateMany/);
  assert.match(section, /isActive: false/);
  assert.match(section, /privacyRetentionPolicy\.create/);
  assert.match(section, /PRIVACY_RETENTION_POLICY_APPROVED/);
  assert.doesNotMatch(section, /privacyRetentionPolicy\.delete/);
});

test("data-subject request state machine requires verification and evidence-bearing completion", async () => {
  const routes = await readFile(new URL("./connected-campus-governance.ts", import.meta.url), "utf8");
  assert.match(routes, /const requestTransitions/);
  assert.match(routes, /REQUESTED: \[DataSubjectRequestStatus\.VERIFIED/);
  assert.match(routes, /DATA_SUBJECT_REQUEST_TRANSITION_INVALID/);
  assert.match(routes, /DATA_SUBJECT_REJECTION_REASON_REQUIRED/);
  assert.match(routes, /DATA_SUBJECT_RESULT_REQUIRED/);
});

test("capability certification cannot pass AI grading without benchmark-ready evidence", async () => {
  const routes = await readFile(new URL("./connected-campus-governance.ts", import.meta.url), "utf8");
  const start = routes.indexOf('router.patch("/connected-campus/governance/certifications/:certificationId/review"');
  assert.ok(start >= 0);
  const section = routes.slice(start, start + 7500);
  assert.match(section, /CapabilityCertificationKind\.AI_GRADING/);
  assert.match(section, /benchmarkReady/);
  assert.match(section, /BENCHMARK_NOT_READY/);
  assert.match(section, /status !== "COMPLETED"/);
});

test("real-device certification requires actual hardware evidence", async () => {
  const routes = await readFile(new URL("./connected-campus-governance.ts", import.meta.url), "utf8");
  assert.match(routes, /CertificationEnvironment\.REAL_DEVICE/);
  assert.match(routes, /REAL_DEVICE_EVIDENCE_REQUIRED/);
  assert.match(routes, /hardwareModel/);
  assert.match(routes, /deviceId/);
});

test("ERP 3.1 readiness is super-admin-only and separates software completion from external activation", async () => {
  const routes = await readFile(new URL("./connected-campus-governance.ts", import.meta.url), "utf8");
  const start = routes.indexOf('router.get("/connected-campus/governance/readiness"');
  assert.ok(start >= 0);
  const section = routes.slice(start, start + 12000);
  assert.match(section, /allow\(Role\.SUPER_ADMIN\)/);
  assert.match(section, /evaluateERP31Readiness/);
  assert.match(section, /benchmarkReadySuiteCodes/);
  assert.match(section, /aiCertifiedSuiteCodes/);
  assert.match(section, /retentionPolicies/);
});

test("governance schema persists consent, retention, subject requests and capability certification", async () => {
  const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  for (const model of ["PrivacyRetentionPolicy","PrivacyConsentRecord","DataSubjectRequest","CapabilityCertification"]) {
    assert.match(schema, new RegExp(`model ${model} \\\{`));
  }
});
