import assert from "node:assert/strict";
import test from "node:test";
import { ERP_3_1_SOFTWARE_GATES, evaluateERP31Readiness } from "./erp-3-1-readiness.js";

test("ERP 3.1 software gates are complete independently of external certification", () => {
  assert.equal(ERP_3_1_SOFTWARE_GATES.length, 8);
  assert.equal(ERP_3_1_SOFTWARE_GATES.every(gate => gate.implemented), true);
  const result = evaluateERP31Readiness({
    activeDeviceIds: ["device-1"],
    certifiedRealDeviceIds: [],
    activeAdapterKeys: ["gps.vendor"],
    certifiedRealAdapterKeys: [],
    activeBenchmarkSuiteCodes: ["CBSE-PHYSICS-12"],
    benchmarkReadySuiteCodes: [],
    aiCertifiedSuiteCodes: [],
    requiredPrivacyPurposes: ["SAFETY","TRANSPORT"],
    configuredPrivacyPurposes: [],
    securityPrivacyCertified: false,
  });
  assert.equal(result.softwareComplete, true);
  assert.equal(result.softwarePercent, 100);
  assert.equal(result.productionActivationReady, false);
  assert.ok(result.blockers.some(blocker => blocker.type === "REAL_DEVICE_CERTIFICATION"));
  assert.ok(result.blockers.some(blocker => blocker.type === "AI_BENCHMARK"));
  assert.ok(result.blockers.some(blocker => blocker.type === "PRIVACY_RETENTION"));
});

test("production activation becomes ready only when every external gate is satisfied", () => {
  const result = evaluateERP31Readiness({
    activeDeviceIds: ["device-1","device-2"],
    certifiedRealDeviceIds: ["device-1","device-2"],
    activeAdapterKeys: ["gps.vendor","camera.onvif"],
    certifiedRealAdapterKeys: ["gps.vendor","camera.onvif"],
    activeBenchmarkSuiteCodes: ["CBSE-PHYSICS-12"],
    benchmarkReadySuiteCodes: ["CBSE-PHYSICS-12"],
    aiCertifiedSuiteCodes: ["CBSE-PHYSICS-12"],
    requiredPrivacyPurposes: ["SAFETY","TRANSPORT","VIDEO_SECURITY"],
    configuredPrivacyPurposes: ["VIDEO_SECURITY","TRANSPORT","SAFETY"],
    securityPrivacyCertified: true,
  });
  assert.equal(result.softwarePercent, 100);
  assert.equal(result.externalCertificationComplete, true);
  assert.equal(result.privacyConfigured, true);
  assert.equal(result.productionActivationReady, true);
  assert.deepEqual(result.blockers, []);
});

test("readiness calculation deduplicates certification evidence", () => {
  const result = evaluateERP31Readiness({
    activeDeviceIds: ["a","a"],
    certifiedRealDeviceIds: ["a","a"],
    activeAdapterKeys: [],
    certifiedRealAdapterKeys: [],
    activeBenchmarkSuiteCodes: [],
    benchmarkReadySuiteCodes: [],
    aiCertifiedSuiteCodes: [],
    requiredPrivacyPurposes: ["SAFETY","SAFETY"],
    configuredPrivacyPurposes: ["SAFETY"],
    securityPrivacyCertified: true,
  });
  assert.equal(result.counts.activeDevices, 1);
  assert.equal(result.counts.certifiedDevices, 1);
  assert.equal(result.counts.requiredPrivacyPurposes, 1);
});
