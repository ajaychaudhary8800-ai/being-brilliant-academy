export const ERP_3_1_SOFTWARE_GATES = [
  { key: "ai-examiner", name: "Ranpal AI Examiner Advanced", implemented: true },
  { key: "device-hub", name: "Device Integration Hub", implemented: true },
  { key: "biometric-access", name: "Biometric / RFID / Access", implemented: true },
  { key: "smart-transport", name: "Smart Transport & Ridership", implemented: true },
  { key: "campus-vision", name: "Campus Vision / Video", implemented: true },
  { key: "safety-command", name: "School Safety Command Center", implemented: true },
  { key: "privacy-security", name: "Identity, Privacy, Security & Compliance", implemented: true },
  { key: "parent-mobile", name: "Parent / Mobile Experience", implemented: true },
] as const;

export type ConnectedCampusReadinessInput = {
  activeDeviceIds: string[];
  certifiedRealDeviceIds: string[];
  activeAdapterKeys: string[];
  certifiedRealAdapterKeys: string[];
  activeBenchmarkSuiteCodes: string[];
  benchmarkReadySuiteCodes: string[];
  aiCertifiedSuiteCodes: string[];
  requiredPrivacyPurposes: string[];
  configuredPrivacyPurposes: string[];
  securityPrivacyCertified: boolean;
};

function unique(values: readonly string[]) {
  return [...new Set(values.filter(Boolean))].sort();
}

function missing(required: readonly string[], actual: readonly string[]) {
  const have = new Set(actual);
  return unique(required).filter(value => !have.has(value));
}

export function evaluateERP31Readiness(input: ConnectedCampusReadinessInput) {
  const softwareGates = ERP_3_1_SOFTWARE_GATES.map(gate => ({ ...gate }));
  const softwareComplete = softwareGates.every(gate => gate.implemented);

  const activeDeviceIds = unique(input.activeDeviceIds);
  const activeAdapterKeys = unique(input.activeAdapterKeys);
  const activeBenchmarkSuiteCodes = unique(input.activeBenchmarkSuiteCodes);

  const deviceActivationScopeConfigured = activeDeviceIds.length > 0 || activeAdapterKeys.length > 0;
  const aiActivationScopeConfigured = activeBenchmarkSuiteCodes.length > 0;

  const missingDeviceCertifications = missing(activeDeviceIds, input.certifiedRealDeviceIds);
  const missingAdapterCertifications = missing(activeAdapterKeys, input.certifiedRealAdapterKeys);
  const missingBenchmarkReadiness = missing(activeBenchmarkSuiteCodes, input.benchmarkReadySuiteCodes);
  const missingAICertifications = missing(activeBenchmarkSuiteCodes, input.aiCertifiedSuiteCodes);
  const missingPrivacyPurposes = missing(input.requiredPrivacyPurposes, input.configuredPrivacyPurposes);

  const externalCertificationComplete =
    deviceActivationScopeConfigured &&
    aiActivationScopeConfigured &&
    missingDeviceCertifications.length === 0 &&
    missingAdapterCertifications.length === 0 &&
    missingBenchmarkReadiness.length === 0 &&
    missingAICertifications.length === 0 &&
    input.securityPrivacyCertified;

  const privacyConfigured = missingPrivacyPurposes.length === 0;
  const blockers = [
    ...(!deviceActivationScopeConfigured ? [{
      type: "DEVICE_ACTIVATION_SCOPE",
      key: "connected-campus-devices",
      message: "Configure at least one active Device Hub device or connector before activation can be declared ready.",
    }] : []),
    ...(!aiActivationScopeConfigured ? [{
      type: "AI_ACTIVATION_SCOPE",
      key: "ai-examiner-benchmarks",
      message: "Configure at least one active AI Examiner benchmark suite before activation can be declared ready.",
    }] : []),
    ...missingDeviceCertifications.map(id => ({ type: "REAL_DEVICE_CERTIFICATION", key: id, message: "Active Device Hub device lacks a passed, unexpired REAL_DEVICE certification." })),
    ...missingAdapterCertifications.map(key => ({ type: "ADAPTER_CERTIFICATION", key, message: "Active connector adapter lacks a passed, unexpired REAL_DEVICE certification." })),
    ...missingBenchmarkReadiness.map(code => ({ type: "AI_BENCHMARK", key: code, message: "Active AI Examiner benchmark suite has no completed benchmark-ready run." })),
    ...missingAICertifications.map(code => ({ type: "AI_CERTIFICATION", key: code, message: "Active AI Examiner benchmark suite has not received approved AI_GRADING certification." })),
    ...missingPrivacyPurposes.map(purpose => ({ type: "PRIVACY_RETENTION", key: purpose, message: "No active retention/legal-basis policy is configured for this connected-campus purpose." })),
    ...(!input.securityPrivacyCertified ? [{ type: "SECURITY_PRIVACY_CERTIFICATION", key: "security-privacy", message: "Security/privacy review certification has not passed." }] : []),
  ];

  return {
    softwareComplete,
    softwarePercent: Math.round((softwareGates.filter(gate => gate.implemented).length / softwareGates.length) * 100),
    softwareGates,
    externalCertificationComplete,
    privacyConfigured,
    productionActivationReady: softwareComplete && externalCertificationComplete && privacyConfigured,
    blockers,
    counts: {
      activeDevices: activeDeviceIds.length,
      certifiedDevices: unique(input.certifiedRealDeviceIds).length,
      activeAdapters: activeAdapterKeys.length,
      certifiedAdapters: unique(input.certifiedRealAdapterKeys).length,
      activeBenchmarkSuites: activeBenchmarkSuiteCodes.length,
      benchmarkReadySuites: unique(input.benchmarkReadySuiteCodes).length,
      aiCertifiedSuites: unique(input.aiCertifiedSuiteCodes).length,
      requiredPrivacyPurposes: unique(input.requiredPrivacyPurposes).length,
      configuredPrivacyPurposes: unique(input.configuredPrivacyPurposes).length,
    },
  };
}
