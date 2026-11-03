# SchoolOS V5 — Phase 5 commercial, legal and finance reconciliation

**Prepared for review 3 Nov 2026 · non-binding internal working copy · NOT a new approved policy.** Owner: Adhyay Eduventure Private Limited. Release board [#258](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/issues/258). Finance/legal reviewer: Madhuri Verma (owner-reported broad internal approval, original dated A–E decision evidence pending). **No external contract, signature, tax opinion, paid checkout or production GO is created by this document.**

## 1. Authoritative catalog and contradictory legacy controls
Use `SCHOOL_OS_COMMERCIAL_REFERENCE` in [V5 source](../apps/api/src/lib/schoolos-pricing-reconciliation.ts) at the reviewed reference `SCHOOLOS-LAUNCH-2027-INDIA-V1` (18 Oct 2026) for **comparison**, together with [finance/legal decision sheet](SCHOOLOS_V5_FINANCE_LEGAL_DECISION_SHEET_20261029.md). Code does **not** mutate plans or enable external activation. Legacy [September pricing](COMMERCIAL_PACKAGING_PRICING.md) still lists Essentials ₹49,990, Growth ₹89,990, numeric Enterprise, monthly offers and a separate plan-capacity matrix; it must not be republished as the V5 annual pricebook or quietly edited. Reported 23 Oct staging dry run: three fixed tiers ALIGNED, blocked/changed zero; new staging audit and finance acceptance not re-executed.

| V5 reference tier | Annual base, ex applicable GST | At **illustrative** 18% GST | Onboarding (NON-BINDING estimate) | Sales clearance |
|---|---:|---:|---:|---|
| Essentials | ₹49,900 | ₹58,882 | ₹9,999 | Reference only |
| Growth | ₹99,900 | ₹1,17,882 | ₹14,999 | Reference only |
| Professional | ₹1,49,990 | ₹1,76,988.20 | ₹24,999 | Reference only |
| Enterprise | Authorized custom quote | Scope/tax-specific | Custom | Not an automated fixed-priced tier |

**Do not infer that GST always applies at exactly 18%.** Finance must verify institution, supply and place-of-supply classification, GSTIN and documentary invoicing. The ₹14,999 ex-GST / 60-day *external* pilot is a planning reference; it has no approved supported automatic 60-day subscription checkout. The owner-operated BBA institutional pilot is proposed **non-billable and separate** from an external paid pilot. No discount, unsupported pilot invoice, free add-on or recurring debit is authorized.

## 2. Feature-to-plan entitlement comparison — **VERIFY AGAINST V5 LIVE PLAN**, not a promise
The matrix below is a **legacy packaging starting point only**, sourced from `docs/COMMERCIAL_PACKAGING_PRICING.md`; actual V5 `SaaSPlan.entitlements`, branch/student/user caps and direct API enforcement must be inspected on a reviewed target release before sales use.

| Feature / plan tier | Essentials | Growth | Professional | Enterprise | Current verification |
|---|---|---|---|---|---|
| Admissions, academic masters, attendance, timetable, fees | Legacy: yes | Legacy: yes | Legacy: yes | Legacy: yes | Verify V5 per-route access |
| LMS, CRM, communication and exams | Legacy: no | Legacy: yes | Legacy: yes | Legacy: yes | Verify V5 entitlement and price |
| HR, accounting, library, inventory, advanced analytics | Legacy: no | Legacy: no | Legacy: yes | Legacy: yes | Verify V5 endpoints/caps |
| Multi-branch management | Legacy: no | Legacy: no | Legacy: yes | Legacy: yes | Verify branch limit and manager control |
| Transport, hostel, white label, custom domain | Legacy: no | Legacy: no | Legacy: no | Legacy: yes | Enterprise SOW and live capability review |
| AI Examiner, LiveKit, recordings, video usage quotas | **Not established** | **Not established** | **Not established** | **Not established** | Paid flags OFF; provider scope/pricing not cleared |
| School mode / coaching mode including mixed grades | Mode-dependent, unverified by tier | Mode-dependent | Mode-dependent | Mode-dependent | UAT scope and release candidate-specific checks required |

**Sales rule:** no V5 tier-specific student/user/branch number is customer-facing until V5 plan seed/config, route enforcement and signed Order Form agree. Source access to a feature is not automatically a commercial entitlement.

## 3. Commercial onboarding and quotation acceptance procedure
1. Qualify authorized institution legal name, mode, branches, learners, required modules, migration, support, AI/video and procurement.
2. Cross-check actual V5 tenant plan/quotas, reference price, tax treatment and implemented entitlements. Custom requests → written quote/SOW; no bypass.
3. Prepare working copy using [Order Form / quotation](legal-sales/02_ORDER_FORM_QUOTATION.md) and [SOW](legal-sales/04_IMPLEMENTATION_SOW.md); include exact product, term and start/end trigger, seat/branch limits, inclusion/exclusion, data processing, SLA, quote expiry, tax, implementation fees and approval routing.
4. Maker-checker/finance approves quotation version and tenant linking. `INTERNALLY_APPROVED` and `ALIGNED` price status alone do **not** enable collection: source `schoolOSExternalQuoteReady` returns `activationAllowed: false`.
5. Obtain genuine authorized customer acceptance and controlled contract references in restricted storage; do not imply unsigned quotations are customer agreements.
6. Only after security/DR/provider TEST/finance/legal gates and a separate explicit commercial decision may a supported checkout/payment entitlement activation occur.
7. Provision and train under [companion Phase 4 onboarding SOP](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/blob/docs/v5-phase4-institution-operations-20261103/docs/SCHOOLOS_V5_PHASE4_OPERATIONS_SOP_20261103.md) after its review and merge. Do not send automatic invoices merely because BBA pilot exists.

## 4. Subscription and financial lifecycle (review only)
**Lead → internally approved scoped quote → signed Order Form/processing terms → supported invoice OPEN/OVERDUE → genuine signed-provider capture exactly once → tenant/quote/term ledger reconciliation → permitted entitlement activation → support → pre-expiry renewal quote → customer decision → verified new-term payment or cancellation/exit.** Deny DRAFT/VOID capture, duplicate events, mismatched tenant, late/out-of-term terms and finance-hold bypass. An invoice status alone is not provider settlement proof. Refund, failed refund, dispute and chargeback require event replay validation, debit/credit arithmetic and finance hold/release decision; retain no confidential payer data in public GitHub. Refer to [Phase 3 draft #294](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/pull/294), [failed-payment recovery](SCHOOLOS_V5_FAILED_PAYMENT_RECOVERY.md), [finance dispute release](SCHOOLOS_V5_FINANCE_DISPUTE_RELEASE.md), [renewal policy](SCHOOLOS_V5_RENEWAL_EXPIRY_GUARDRAILS.md). Provider TEST-to-ledger and witnessed finance acceptance: **BLOCKED_BY_PHASE_3**.

### Finance reconciliation evidence ledger — required before human acceptance
| Item | Must prove | Status |
|---|---|---|
| Legal QA contract | Authorized signed TEST-only scope with institution/tenant | NOT ATTESTED |
| Quotation/invoice | Approved immutable quote version, right tenant/tax, collectible invoice | Existing synthetic QA; live TEST mapping missing |
| Razorpay TEST | Actual provider order and payment/capture references, callback signature and UTC | BLOCKED_BY_PHASE_3 |
| Replay/negative | Forged signature rejected, duplicate event idempotent, wrong tenant denied | Reuse synthetic CI, bind exact source |
| Refund/dispute/failure | Provider TEST refund/failure and applicability or documented exclusion | BLOCKED_BY_PHASE_3 |
| Ledger | Reconcile paise totals, currency, fees/tax, event IDs, terms, refund and holds | BLOCKED_BY_PHASE_3 |
| Human finance review | Madhuri's dated transaction-by-transaction decision and protected original reference | PENDING |
| Production settlement | Separate real-money authorization and regulatory/tax obligations | NOT AUTHORIZED |

## 5. Controlled legal-template inventory and change requests
**Reuse, do not redraft:** [Master Agreement / public SaaS Terms source](legal-sales/03_SAAS_MASTER_AGREEMENT.md), [Acceptable Use Policy](legal-sales/08_ACCEPTABLE_USE_POLICY.md), [Privacy](legal-sales/07_PRIVACY_NOTICE.md), [DPA](legal-sales/06_DATA_PROCESSING_ADDENDUM.md), [SLA](legal-sales/05_SLA_SUPPORT_POLICY.md), [cancellation/data exit](legal-sales/09_DATA_EXIT_RETENTION.md), [Quote](legal-sales/02_ORDER_FORM_QUOTATION.md), [SOW](legal-sales/04_IMPLEMENTATION_SOW.md), [Counsel approval](legal-sales/COUNSEL_APPROVAL_RECORD.md). Check the actual site Terms route and `LEGAL_PAGES_PUBLISHED` switch before marketing claims.

**Prior legal review:** [Counsel Approval Record (6 October 2026)](legal-sales/COUNSEL_APPROVAL_RECORD.md) records management confirmation that qualified Indian counsel approved the then-controlled Being Brilliant legal pack without changes, with private correspondence held by management. This is existing **owner-reported prior legal approval**, not proof of a brand-new V5 counsel review. The underlying correspondence has not been inspected here, and the approval does **not automatically cover material V5 changes** to pricing, AI/recordings, payments, privacy, support and security. Verify approved source versions and obtain an attributable V5-delta disposition before external V5 execution.

The `/terms` route renders the controlled Master Agreement, not the AUP; `/privacy` renders the Privacy Notice. Both are fail-closed unless `LEGAL_PAGES_PUBLISHED=true` and a legal effective date are configured. No site publication or reachability test was executed here. These sources do not establish current GST treatment, operator capability or published effective dates.

| Legal/finance review area | Required targeted V5 determination | State |
|---|---|---|
| A — internal BBA pilot | Non-billable status, real tenant/data scope, related-party disclosure | OWNER REPORTED APPROVAL; original evidence PENDING |
| B — annual card and tax | Source ID, quote version, finance-approved GST/application and 23 Oct audit | OWNER REPORTED APPROVAL; detailed evidence PENDING |
| C — included onboarding vs extra | Basic annual remote onboarding in legacy September pack **versus** new October add-on estimates; decide approved fair-use scope and optional SOW trigger | CONFLICT OPEN |
| D — external 60-day pilot | Eligible modules, quotas, start trigger, refund/exit, conversion, supported collection, privacy and support | NOT APPROVED FOR OFFER |
| E — processing/contract/finance | DPA child/guardian/recordings/AI, transfer/retention, SLA feasibility, breach/grievance contacts, settlement audit | ORIGINAL DECISION + TEST EVIDENCE PENDING |
| Qualified review | 6 Oct reported V4/legacy counsel approval exists; verify retained private original, version match, and whether V5 material changes need renewed Indian counsel/tax assessment | PRIOR PACK OWNER-REPORTED APPROVED; V5 DELTA DISPOSITION PENDING |

Do not assume a single blanket owner statement constitutes a signed original or formal legal opinion. Apply statutory requirements according to actual commencement and institutional processing role; avoid unsupported compliance badges.

## 6. Refund/cancellation and renewal communications — internal templates NOT approved for sending
**Renewal reminder (editable draft):** “Your SchoolOS subscription for [institution] is due for review on [date]. The proposed [plan] annual renewal and tax details will be sent in a versioned quotation. Access/continuity and renewal remain subject to the signed terms; no payment or automatic renewal is assumed by this notice.”
**Expiry notice:** “Your current subscription term ends on [date]. Please contact the authorized support/commercial channel to review renewal, applicable data export and end-of-term access under your agreement. No payment link is included in this draft.”
**Cancellation acknowledgment:** “We received your request on [date]. We will verify authorized account ownership, the signed cancellation/refund terms, any open invoices, and permitted export/retention obligations before issuing a final determination.”
**Refund investigation:** “Your request [reference] is under finance review. We will reconcile the approved invoice, payment, provider status and any prior refund/hold before confirming the eligible amount or timetable.”  
None of the above messages should be automated or delivered without product, legal and data-privacy review and actual transaction-specific facts.

## 7. Commercial exception register and launch readiness
| Exception | Decision owner | Consequence until closed |
|---|---|---|
| Legacy price/caps contradict V5 annual reference | Finance + product | Block public V5 rate sheet and automatic sale |
| Included annual onboarding vs quoted implementation estimates | Madhuri + commercial owner | No additional mandatory charge |
| Enterprise custom rate/entitlements | Authorized quoting authority | No fixed Enterprise purchase |
| External 60-day pilot unsupported checkout | Finance, product, legal | No binding pilot sale or collection |
| Provider TEST-to-ledger absent | Phase 3 finance reviewer | No provider acceptance/real charge |
| Security/DR/rollback not accepted | Ajay as human owner, external reviewer if binding requirement | No customer live data or production GO |
| Legal signoff original and qualified tax applicability pending | Madhuri / counsel where required | No unapproved contracts/site publication |

**Commercial phase formal acceptance: PENDING (Gate 4, Gate 9 and related Gate 10).** This controlled reconciliation is documentation evidence only; nothing was priced, quoted, invoiced, billed, approved, migrated, or legally certified by creating it.


## 8. V5-specific legal/privacy/contract delta review — independent source review, NOT legal signoff

The [October 6 counsel approval record](legal-sales/COUNSEL_APPROVAL_RECORD.md) identifies an approved **pre-V5 controlled pack** and private management-held correspondence. The [public Terms source map](../apps/web/lib/public-legal.ts) maps `/terms` to `03_SAAS_MASTER_AGREEMENT.md`, `/privacy` to `07_PRIVACY_NOTICE.md` and `/acceptable-use` to `08_ACCEPTABLE_USE_POLICY.md`. Under `publicLegalPagesPublished()`, publication requires a true feature flag and nonblank effective date; source availability alone is not public publication. The following are **targeted material-change questions**, not claims of legal breach.

| V5 feature / changed risk | Existing controlled document(s) to compare to 6 Oct approved source | Concrete question for Madhuri / counsel as applicable | Status |
|---|---|---|---|
| Annual V5 pricebook / Enterprise quotation | Order Form, SOW, Master Agreement | Does the old September monthly/annual language contradict the 18 Oct V5 reference, scope, student/branch quotas or tax terms? | V5 VERSION DECISION PENDING |
| Onboarding included vs tier estimates | Order Form, SOW and legacy packaging | Which remote setup/training is included; when is a separate written priced SOW necessary; how is prior promise protected? | CONFLICT OPEN |
| 60-day external paid pilot | Order Form, cancellation/exit, SLA, payment terms | Is the 60-day start trigger, billing path, refund, conversion, cap and exit legally and technically supported? | NO EXTERNAL PAID OFFER |
| Child/parent/guardian data and recordings | DPA, Privacy Notice, Security Schedule, AUP | Are institution instruction, child consent, recordings retention and parent access/erasure controls precise and implemented? | V5 PRIVACY DECISION PENDING |
| AI Examiner provider and marks | Master Agreement, DPA, Privacy/Security Schedule | Are processing, accuracy review, human override, vendor/subprocessor disclosures, retention and liability appropriately scoped? | PROVIDER/LEGAL REVIEW PENDING |
| LiveKit video, R2 recordings and egress | Master Agreement, DPA, SOW, SLA, Security Schedule | Are recorded-session consent, access boundaries, object retention, deletion, third-party fees and paid flags reflected accurately? | PAID VIDEO OFF / REVIEW PENDING |
| Razorpay TEST→real finance and disputes | Order Form, Master Agreement, refund/cancellation terms | Do settlement, reconciliation, tax receipt, failed refunds, dispute holds and cancellation comply with actual supported paths? | BLOCKED_BY_PHASE_3 |
| Incident #281/#292/#293 + DR claims | Security Schedule, DPA, SLA, incident/retention policy | Does historical credential exposure require notification/disclosure? Can support/restore commitments be evidenced without false RPO/RTO guarantees? | BLOCKED_BY_PHASE_1 |
| Multi-tenant school vs coaching and BBA related party | DPA, SOW, handover terms | Are buyer roles, tenancy, UAT witness and related-party conflict disclosure adequate for actual contracted deployment? | BLOCKED_BY_PHASE_2 |
| Public legal publication | Site source, Privacy Notice, Master Agreement, AUP | Has approved V5 wording and effective date been recorded before enabling public pages? | SOURCE-GATE REVIEWED; PUBLICATION NOT VERIFIED |

**Disposition format (protected originals, leave blank until real decision):** each item needs prior approved source SHA/file hash, V5 changed source SHA/file hash, accountable reviewer, change/no-change rationale, whether new counsel review legally/contractually required, counsel reference if reviewed, dated human acceptance and permitted confidential artifact locator. This adds no new contract clauses, counsel opinion or approval.

**Critical distinction:** the prior legal pack *was reported approved* on 6 Oct; **V5 change-impact acceptance remains unverified**. No historical counsel approval should be withdrawn or silently rewritten merely because a new version is in preparation.
