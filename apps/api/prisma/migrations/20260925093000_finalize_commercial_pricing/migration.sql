-- Step 8: finalize launch commercial pricing, capacity limits, and package boundaries.
-- Prices are stored in paise and are exclusive of applicable GST.
-- Annual pricing equals ten monthly payments (approximately two months free).
-- Standard domestic India plans use 18% GST (1800 bps). Export/SEZ/non-domestic
-- treatment must be reviewed before invoicing outside this standard configuration.

UPDATE "SaaSPlan"
SET
  "name" = 'Essentials',
  "description" = 'Core institutional ERP for small schools, coaching centres and academies: students, attendance, fees, academics and core reports.',
  "monthlyPricePaise" = 499900,
  "annualPricePaise" = 4999000,
  "trialDays" = 14,
  "currency" = 'INR',
  "taxRateBps" = 1800,
  "entitlements" = '{}'::jsonb,
  "limits" = '{"branches":1,"users":1000,"students":300}'::jsonb,
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'ESSENTIALS';

UPDATE "SaaSPlan"
SET
  "name" = 'Growth',
  "description" = 'Essentials plus LMS, admissions CRM, communication and examinations for growing institutions.',
  "monthlyPricePaise" = 899900,
  "annualPricePaise" = 8999000,
  "trialDays" = 14,
  "currency" = 'INR',
  "taxRateBps" = 1800,
  "entitlements" = '{"lms":true,"crm":true,"communication":true,"examinations":true}'::jsonb,
  "limits" = '{"branches":1,"users":3000,"students":800}'::jsonb,
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'GROWTH';

UPDATE "SaaSPlan"
SET
  "name" = 'Professional',
  "description" = 'Growth plus HR/payroll, finance, library, inventory, advanced analytics and multi-branch operations.',
  "monthlyPricePaise" = 1499900,
  "annualPricePaise" = 14999000,
  "trialDays" = 14,
  "currency" = 'INR',
  "taxRateBps" = 1800,
  "entitlements" = '{"lms":true,"crm":true,"communication":true,"examinations":true,"hr_payroll":true,"finance":true,"library":true,"inventory":true,"analytics":true,"multi_branch":true}'::jsonb,
  "limits" = '{"branches":5,"users":7000,"students":2000}'::jsonb,
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'PROFESSIONAL';

UPDATE "SaaSPlan"
SET
  "name" = 'Enterprise',
  "description" = 'Professional plus transport, hostel, full white-label branding, custom domain and large multi-campus capacity.',
  "monthlyPricePaise" = 2999900,
  "annualPricePaise" = 29999000,
  "trialDays" = 0,
  "currency" = 'INR',
  "taxRateBps" = 1800,
  "entitlements" = '{"lms":true,"crm":true,"communication":true,"examinations":true,"hr_payroll":true,"finance":true,"library":true,"inventory":true,"analytics":true,"multi_branch":true,"transport":true,"hostel":true,"white_label":true,"custom_domain":true}'::jsonb,
  "limits" = '{"branches":20,"users":18000,"students":5000}'::jsonb,
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'ENTERPRISE';
