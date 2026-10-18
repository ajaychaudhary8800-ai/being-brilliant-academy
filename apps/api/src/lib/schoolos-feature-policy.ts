/** SchoolOS 5.0 per-tenant feature policy, independent of Prisma and request handlers. */
export const schoolOSFeatures = [
  { key: "lms", name: "Learning Management", group: "Academics" },
  { key: "crm", name: "Admissions CRM", group: "Admissions" },
  { key: "examinations", name: "Examinations & Tests", group: "Academics" },
  { key: "ai_examiner", name: "Ranpal AI Examiner", group: "Academics", parent: "examinations" },
  { key: "communication", name: "Communication", group: "Operations" },
  { key: "workflow_automation", name: "Workflow Automation", group: "Operations", parent: "communication" },
  { key: "hr_payroll", name: "HR & Payroll", group: "Operations" },
  { key: "finance", name: "Finance & Accounting", group: "Finance" },
  { key: "library", name: "Library", group: "Operations" },
  { key: "inventory", name: "Inventory & Assets", group: "Operations" },
  { key: "analytics", name: "Analytics", group: "Analytics" },
  { key: "transport", name: "Transport", group: "Operations" },
  { key: "hostel", name: "Hostel", group: "Operations" },
  { key: "multi_branch", name: "Multi-branch", group: "Platform" },
  { key: "white_label", name: "White-label", group: "Platform" },
  { key: "custom_domain", name: "Custom Domain", group: "Platform" },
] as const;

export type SchoolOSFeature = (typeof schoolOSFeatures)[number]["key"];
export type SchoolOSFeatureOverride = {
  enabled: boolean;
  reason: string;
  expiresAt: string | null;
  changedBy: string;
  changedAt: string;
};
export type SchoolOSFeatureOverrides = Partial<Record<SchoolOSFeature, SchoolOSFeatureOverride>>;

const knownFeatures = new Set<string>(schoolOSFeatures.map(item => item.key));
export const isSchoolOSFeature = (value: string): value is SchoolOSFeature => knownFeatures.has(value);
export function schoolOSParentFeature(feature: string): SchoolOSFeature | null {
  const definition = schoolOSFeatures.find(item => item.key === feature);
  return definition && "parent" in definition ? definition.parent : null;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function readSchoolOSFeatureOverrides(value: unknown): SchoolOSFeatureOverrides {
  const result: SchoolOSFeatureOverrides = {};
  for (const [key, raw] of Object.entries(asObject(value))) {
    if (!isSchoolOSFeature(key)) continue;
    const candidate = asObject(raw);
    if (typeof candidate.enabled !== "boolean") continue;
    const expiresAt = candidate.expiresAt === null ? null : typeof candidate.expiresAt === "string" ? candidate.expiresAt : null;
    result[key] = {
      enabled: candidate.enabled,
      reason: typeof candidate.reason === "string" ? candidate.reason : "",
      expiresAt,
      changedBy: typeof candidate.changedBy === "string" ? candidate.changedBy : "",
      changedAt: typeof candidate.changedAt === "string" ? candidate.changedAt : "",
    };
  }
  return result;
}

export function activeSchoolOSOverride(
  overrides: SchoolOSFeatureOverrides, feature: string, now = new Date(),
): SchoolOSFeatureOverride | null {
  if (!isSchoolOSFeature(feature)) return null;
  const override = overrides[feature];
  if (!override) return null;
  if (override.expiresAt !== null) {
    const date = Date.parse(override.expiresAt);
    if (!Number.isFinite(date) || date <= now.getTime()) return null;
  }
  return override;
}

export function schoolOSFeatureAccess(
  planEntitlements: Record<string, boolean>,
  enforcementEnabled: boolean,
  overrides: SchoolOSFeatureOverrides,
  feature: string,
  now = new Date(),
): { enabled: boolean; source: "OVERRIDE" | "PLAN" | "LEGACY" | "PARENT" | "INHERITED" } {
  const parent = schoolOSParentFeature(feature);
  if (parent) {
    const parentDecision = schoolOSFeatureAccess(planEntitlements, enforcementEnabled, overrides, parent, now);
    if (!parentDecision.enabled) return { enabled: false, source: "PARENT" };
  }
  const override = activeSchoolOSOverride(overrides, feature, now);
  if (override) return { enabled: override.enabled, source: "OVERRIDE" };
  if (!enforcementEnabled) return { enabled: true, source: "LEGACY" };
  if (planEntitlements["*"] === true || planEntitlements[feature] === true)
    return { enabled: true, source: "PLAN" };
  if (planEntitlements[feature] === false) return { enabled: false, source: "PLAN" };
  // Previously bundled sub-modules inherit their licensed parent until an explicit plan entitlement is introduced.
  if (parent) return { enabled: true, source: "INHERITED" };
  return { enabled: false, source: "PLAN" };
}

export function schoolOSResolvedFeatures(
  entitlements: Record<string, boolean>,
  enforce: boolean,
  overrides: SchoolOSFeatureOverrides,
  now = new Date(),
) {
  return Object.fromEntries(schoolOSFeatures.map(({ key }) =>
    [key, schoolOSFeatureAccess(entitlements, enforce, overrides, key, now).enabled],
  )) as Record<SchoolOSFeature, boolean>;
}

export function schoolOSEffectiveOverrideLists(overrides: SchoolOSFeatureOverrides, now = new Date()) {
  const deniedFeatures: string[] = [];
  const enabledFeatures: string[] = [];
  for (const feature of schoolOSFeatures) {
    const active = activeSchoolOSOverride(overrides, feature.key, now);
    if (active?.enabled === false) deniedFeatures.push(feature.key);
    else if (active?.enabled === true) enabledFeatures.push(feature.key);
  }
  return { deniedFeatures, enabledFeatures };
}
