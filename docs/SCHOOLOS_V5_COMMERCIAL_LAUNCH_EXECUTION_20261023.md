# Adhyay SchoolOS V5 — Commercial launch execution and decision register

**Snapshot date:** 23 October 2026 | **Owner:** Adhyay Eduventure Private Limited | **Go-live authorization:** **NOT GRANTED**.

This is a *business-readiness control pack*, not a claim that the V5 code is deployed, a quotation has been signed or a customer has paid. The frozen V4 production repository `main` must not be modified merely to accelerate V5 sales.

## 1. Commercial posture: three distinct stages

| Stage | Safe action | Revenue or external entitlement allowed? | Exit evidence |
|---|---|---|---|
| A. Sales preparation / invitation to a private demo | Audit target institutions, qualify leads, prepare offline proposals, show a clearly labelled test/demo environment with synthetic data. | **No payment, no unsupported SLA/feature claims, no production login for prospects.** External announcements require normal brand/content approval. | Demonstration script, approved product claims, reliable public demo entry point and named support/implementation owner. |
| B. Controlled signed institutional pilot | Only after **all applicable** V5 production/security/payment/DR/contract gates and a named institution's signed pilot scope, data-processing terms, payment arrangements and UAT. | Allowed only via individually authorized and technically supported billing flow; never by changing a production invoice manually or treating a synthetic TEST capture as revenue. | Customer legal signature, controlled finance collection, tenant-specific limits, staff training, signed UAT and support handover. |
| C. General commercial availability | Repeatable signed Order Form → approved quotation → invoice → genuine Razorpay capture → reconciled entitlements and support. | **Only after all ten release gates VERIFIED, release checker READY, protected production approval and deployment acceptance.** | Evidence-backed release tag, monitored production, verified recovery, approved finance/legal/SLA and management GO. |

**Current permitted technical position:** Draft source and synthetic tests are improving. The V5 commercial release manifest remains HOLD with ten gates PENDING. This document is not an authorization for stage B/C.

## 2. Approved *reference* pricing, not an auto-payable pricebook

Approved India launch reference `SCHOOLOS-LAUNCH-2027-INDIA-V1` (18 October 2026), amounts **exclusive of GST**, exact paise in `apps/api/src/lib/schoolos-pricing-reconciliation.ts`.

| Tier | Base annual ex GST | At indicative 18% GST | Separate onboarding estimate (ex GST) |
|---|---:|---:|---:|
| Essentials | ₹49,900 | ₹58,882 | ₹9,999 |
| Growth | ₹99,900 | ₹1,17,882 | ₹14,999 |
| Professional | ₹1,49,990 | ₹1,76,988.20 | ₹24,999 |
| Enterprise | Individually quoted | Based on signed quote and applicable tax | Individually quoted |

**60-day suggested pilot:** ₹14,999 plus applicable GST (₹17,698.82 at 18%). This is an *offer reference*, **not a supported automatically payable 60-day subscription workflow**. Do not issue a Razorpay standard annual checkout for the pilot amount. Obtain contractual scope, refund/data-exit clauses, actual implementation cost/margin and a separately approved collection path before an offer becomes binding.

**Important pricing conflict:** The September Being Brilliant packaging file says annual remote onboarding is included; V5 October reference describes extra onboarding *estimates*. Until management/finance sign off on whether each specific onboarding service is included or charged under the SOW, treat the above onboarding amounts as **non-binding estimates**, not mandatory add-on fees. Custom module prices, SMS/WhatsApp volume, AI credits, LiveKit room-minutes and GST treatment require their own approved rate/scope; no unverified “unlimited usage” promise. Enterprise never uses the old default numeric catalogue price.

**Detected staging drift, not a newly verified observation:** Prior checks recorded Essentials ₹49,990 and Growth ₹89,990 versus approved ₹49,900/₹99,900; Professional ₹1,49,990 aligned with historical synthetic TEST invoice. The guarded V5 staging pricebook script is **read-only by default**, refuses updates affecting any existing quotation snapshot or invoice and has **not been authorized/executed here**. Recheck live isolated staging using the read-only preflight below. Do not silently rewrite historical contracts, receipts, taxes or invoices.

## 3. Real customer pathway and hard stops

1. **Lead qualification:** institutional name and public business contact, branches, active students, system pain, authorized decision-maker, timeline and support constraints. Only log business data needed for legitimate sales follow-up.
2. **Demonstration:** school or coaching-specific workflows; distinguish proven stable modules from isolated V5 Draft features and paid LiveKit/AI that remain disabled. No school/student personal data is used in synthetic demos.
3. **Requirements and scope:** school/coaching mode, teacher multi-branch and mixed-grade coaching batches, roles, LMS/exams, migration source and contractual module/capacity needs. Mark unsupported extras as *separate engineering review*, not included.
4. **Internal proposal:** reconcile the exact proposed base annual plan, capacities and taxes; obtain maker/checker approval; custom discounts/add-ons require separately approved versioned rates. Until V5 finance signoff, do not label a tentative quote externally “ready for payment”.
5. **Order Form:** real signatory and institution-authorized signature, verified reference/amount/version, encrypted Commercial Vault independent checker, correct quote-to-tenant-to-won-lead linkage. An unsigned mock PDF is never evidence.
6. **Test → finance signoff → live payment:** use only a specifically authorized sandbox with genuine TEST provider payment proof first. Real payment requires verified capture/event replay/reconciliation and approved live provider mode. An order creation, browser success screenshot or synthetic HMAC is not proof of payment.
7. **Onboarding:** approved tenant, measured limits and features, initial admin setup, scoped migration controls, branch isolation, user training and institution-specific UAT; client signs implementation handover.
8. **Operations:** monitor onboarding, customer-reported critical workflows, 5xx/login/worker alerts, billable usage, refunds/disputes, backups, 14-day R2 retention and encrypted Vault recoverability; maintain tested rollback and support escalation.

## 4. Release-critical ownership and evidence checklist

| Priority | Owner role | Blocker | Concrete proof required |
|---|---|---|---|
| P0 | Platform lead + operations | Candidate-to-staging deployment provenance | Reviewed V5 Draft chain, frozen source SHA, exact container digests, 114 migration parity, isolated domain/database, full CI and rollback evidence. |
| P0 | Finance + platform lead | Essentials/Growth price reconciliation | Read-only staging preflight; if safe, separately approved guarded **staging-only** reconciliation; signed rate-card decision, historical plan/quote/invoice preservation. |
| P0 | Finance/payment operations | Provider readiness | Stage-only Razorpay TEST key/webhook verified **with provider**; real signed QA-only Order Form and captured → replay → failed → refund/dispute/renewal accounting evidence. No QA capture may be counted as customer revenue. |
| P0 | Engineering + AI/video finance owner | Cost exposure | Real LiveKit and AI Examiner admission, provider disconnect/reconnect, duration metering, failed/delayed webhooks, hold settlement, two-person release; explicit tariffs and margin signoff. |
| P0 | Security/ops reviewer | Durable recovery | Latest off-site backup download/restore, database and document integrity, encrypted Vault key custody/decryption, retention, tenant boundary and rollback signoff. |
| P0 | Institution sponsor + QA lead | Real customer UAT | School/coaching admins, teachers, students/guardians and accountants verify contracted flows, permissions, mobile, receipts and training. Synthetic “100% onboarding” does not replace this. |
| P0 | Legal + finance + management | Commercial GO | Controlled V4 legal pack was management-reported counsel-approved on 6 Oct 2026; verify *V5-specific* add-ons/AI/video/pilot/processing and current contract versions; GST/support terms; actual signing and independent owner production release approval. |
| P1 | Commercial lead | Demand-generation start | Product claims verified, short demo, updated pitch, target list of Delhi NCR schools/coaching centres, CRM ownership, 24h lead-response target, 20–30 minute workflow demo slots. |

## 5. One safe staging command: technical preflight (never a GO certificate)

After the reviewed PR code is deployed to the **isolated V5 staging API**, an operator with staging access can execute from that API's project directory:

```bash
pnpm --filter @bba/api exec tsx src/scripts/schoolos-v5-commercial-preflight.ts
```

It first verifies the isolated staging DB path/origin and TEST Razorpay mode. It reads only **four SaaS plan configurations** and **quotation/invoice counts**, shows approved-versus-configured annual paise and sanitized provider credential-presence booleans, **never** logs secret values or tenant identities, creates no payment/order/invoice and **always reports paidLaunchAuthorized=false**. Credential presence is **not** actual provider verification.

This command is **not** authorized on V4 production or shared main-staging. It must not be run using copied production database connection credentials. No other interactive steps are needed until an operator can provide the sanitized output and the separate genuine provider/customer acceptance evidence.

## 6. 2027 launch motion and reporting

**Target:** begin market-facing SchoolOS campaign from 1 January 2027 **only to the extent the actual stage is approved**. A January campaign can safely be a “private demo / early-access registration” campaign if commercial GO remains HOLD; do **not** promise a particular release date, live subscription or advanced billed features before acceptance.

Initial positioning: **“One connected administration, learning and admissions operating system for schools and coaching institutes, configured to the institution’s contracted modules and capacity.”** Keep claims about security/availability limited to controlled legal/SLA wording; never claim proof of ISO certification, a named paid customer, zero downtime, unlimited AI/video or real provider activation without evidence.

**Sales execution sequence:** target-list validation → discovery → role-specific demo → workflow audit → scoped SOW → approved quote → signed Order Form → verified invoice/payment → onboarding/UAT → acceptance → measured retention. Use the existing platform SaaS Sales CRM, not spreadsheets as a second source of truth.

**Weekly accountable scorecard:** new leads, decision-makers qualified, demos held, audit forms completed, signed proposals, contracted clients, *provider-verified* revenue, go-live acceptance, critical tickets and churn/renewal risks. Keep synthetic/test invoices and internal Being Brilliant tenants out of paying-customer statistics.

**Next owner-controlled decisions:** (a) onboarding-included vs separately billable, (b) pilot offer and lawful collection mechanics, (c) real TEST Razorpay configuration and signed test institution, (d) AI/video prices, (e) staging and production release approval **after** signed evidence. Everything else remains eligible for automated Draft/QA work.
