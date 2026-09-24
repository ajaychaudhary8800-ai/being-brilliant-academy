-- Align database-backed commercial plans with the public Essentials/Growth/Professional/Enterprise packaging.
-- Pricing remains sales-configured (0 here) until commercial rates are finalized.
-- Core ERP features (students, attendance, fees, academics and core reports) are intentionally
-- not feature-gated; optional modules use the entitlements below.

INSERT INTO "SaaSPlan" (
  "id", "code", "name", "description", "monthlyPricePaise", "annualPricePaise",
  "trialDays", "currency", "taxRateBps", "entitlements", "limits", "isActive", "updatedAt"
) VALUES
  (
    'saas_plan_essentials',
    'ESSENTIALS',
    'Essentials',
    'Core institutional operations: student management, attendance, fees, academic operations and core reports.',
    0, 0, 0, 'INR', 0,
    '{}'::jsonb,
    '{"branches":1}'::jsonb,
    true,
    CURRENT_TIMESTAMP
  ),
  (
    'saas_plan_growth',
    'GROWTH',
    'Growth',
    'Essentials plus LMS, admissions CRM, communication and examinations.',
    0, 0, 0, 'INR', 0,
    '{"lms":true,"crm":true,"communication":true,"examinations":true}'::jsonb,
    '{"branches":1}'::jsonb,
    true,
    CURRENT_TIMESTAMP
  ),
  (
    'saas_plan_professional',
    'PROFESSIONAL',
    'Professional',
    'Growth plus HR and payroll, advanced analytics and multi-branch operations.',
    0, 0, 0, 'INR', 0,
    '{"lms":true,"crm":true,"communication":true,"examinations":true,"hr_payroll":true,"analytics":true,"multi_branch":true}'::jsonb,
    '{}'::jsonb,
    true,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "entitlements" = EXCLUDED."entitlements",
  "limits" = EXCLUDED."limits",
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "SaaSPlan"
SET
  "name" = 'Enterprise',
  "description" = 'Professional plus full white-label branding, custom domain and enterprise module access.',
  "entitlements" = '{"lms":true,"crm":true,"communication":true,"examinations":true,"hr_payroll":true,"analytics":true,"multi_branch":true,"white_label":true,"custom_domain":true,"finance":true,"transport":true,"library":true,"hostel":true,"inventory":true}'::jsonb,
  "limits" = '{}'::jsonb,
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'ENTERPRISE';

-- Keep existing STANDARD subscriptions functional, but stop offering STANDARD to new customers.
UPDATE "SaaSPlan"
SET
  "isActive" = false,
  "description" = 'Legacy compatibility plan. Existing subscriptions remain valid; new customers should use Essentials, Growth, Professional or Enterprise.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'STANDARD';
