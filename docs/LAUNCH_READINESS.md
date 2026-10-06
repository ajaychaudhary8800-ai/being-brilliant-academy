# Step 14 — Final Launch Readiness

**Product:** Being Brilliant ERP + LMS + CRM  
**Owner:** Platform leadership / commercial operations  
**Effective:** 25 September 2026  
**Last evidence update:** 6 October 2026  
**Current launch decision:** **HOLD**

Step 14 installs the final pre-launch control framework. It does not override unresolved external dependencies or declare the platform commercially launched.

The machine-readable source of truth is:

`config/launch-readiness.json`

Run:

`pnpm launch:check`

To enforce a hard GO gate before formal release:

`pnpm launch:require-go`

The hard command must fail while any blocking gate remains unresolved.

## 1. What is already launch-ready

The following areas are operationally ready based on implemented controls and repository evidence:

- Core multi-tenant SaaS platform and tenant isolation.
- Role-based access and subscription enforcement.
- Staging and production QA controls.
- Seven-role nightly staging workflow.
- Client provisioning and onboarding.
- Client implementation/UAT/handover process.
- Commercial plans, pricing, limits and billing rules.
- Sales/legal contract template pack.
- Dedicated B2B SaaS sales pipeline.
- Public demo lead routing into the platform sales pipeline.
- Monitoring, operational health and incident response.
- Local backup freshness and container health monitoring.
- Production change-control through protected CI.
- API/web/backup container-build validation.
- Cloudflare R2 off-site backup, retrieval, checksum verification and isolated restore evidence.

### Step 5 — Off-site Backup & Disaster Recovery

Status: **READY**

Verified on 6 October 2026:

- scheduled production backups are present in Cloudflare R2;
- the latest R2 backup was downloaded back from the off-site provider;
- `database.dump` and `files.tar.gz` passed SHA-256 verification;
- the database was restored into a temporary isolated PostgreSQL cluster on loopback port `55432`;
- file storage was restored into a temporary isolated directory;
- representative administrator, teacher, student and parent records were validated;
- measured core database + file restore duration was 7 seconds for the tested backup; and
- the temporary DR environment was stopped and removed after validation.

Evidence: `docs/DR_RESTORE_EVIDENCE_2026-10-06.md`.

This evidence clears the current technical off-site DR launch gate. It does **not** create a contractual RPO/RTO commitment.

## 2. Current hard launch blockers

### A. Corporate/legal execution particulars

Status: **READY**

Official MCA and GST evidence has been supplied and recorded:

- the management-supplied MCA Company Information extract dated 23 October 2024 is the controlled source for company name, CIN, registered office and Director/signatory particulars;
- the official GST REG-06 certificate issued 17 December 2024 verifies GSTIN, legal/trade name, Regular registration and principal place of business;
- business-role legal, privacy and support mail flow is operational;
- support phone/hours are confirmed; and
- support outbound authentication has passed SPF, DKIM and DMARC.

Indian counsel review is now recorded as complete. Management confirmed on 6 October 2026 that qualified Indian counsel reviewed the lawyer-ready controlled pack and approved it **without changes**. No counsel amendment or re-confirmation is required.

Evidence: `docs/legal-sales/COUNSEL_APPROVAL_RECORD.md`.

External customer execution is legally cleared under the reviewed pack. Public legal pages remain a separate runtime publication gate until staging verification and controlled publication are complete.

### B. Public Privacy / Terms / AUP publication

Status: **PENDING_DEPENDENCY**

The implementation is prepared behind a server-controlled publication gate:

- `/privacy` renders the controlled Privacy Notice;
- `/terms` renders the controlled SaaS Master Agreement;
- `/acceptable-use` renders the controlled Acceptable Use Policy;
- the public footer is pre-wired for Privacy, Terms and Acceptable Use links;
- the demo form is pre-wired to the Privacy Notice; and
- all legal pages and links remain unavailable until both `LEGAL_PAGES_PUBLISHED=true` and `LEGAL_EFFECTIVE_DATE` are configured.

Counsel approval and staging publication verification are complete. The controlled publication record is `docs/PUBLIC_LEGAL_PUBLICATION_EVIDENCE.md`. Staging now serves Privacy, Terms and AUP successfully with effective date **6 October 2026**, and desktop/mobile browser verification passed. The only remaining action for this gate is controlled production publication using `LEGAL_EFFECTIVE_DATE=2026-10-06` and `LEGAL_PAGES_PUBLISHED=true`, followed by production verification.

### C. Step 11 — First Real Paying Client

Status: **PENDING_DEPENDENCY**

The internal evidence process is prepared in `docs/FIRST_CLIENT_GO_LIVE_EVIDENCE.md`. For the first real institution, that record must tie together:

- qualified SaaS Sales process and a **WON** lead linked to the actual customer organization;
- agreed plan/scope and signed/accepted commercial documents;
- real payment/activation evidence;
- production tenant provisioning and aligned subscription;
- onboarding **READY / 100%**;
- required data/configuration and training;
- UAT/client acceptance;
- final handover/go-live approval; and
- successful post-go-live smoke validation.

Synthetic QA, demo and internal tenants do not satisfy this gate.

## 3. Downstream formal release

Step 12 — Formal Production Release remains downstream of first-client validation. The controlled execution record is `docs/FORMAL_COMMERCIAL_RELEASE_EVIDENCE.md`.

After Step 11 and a final GO decision:

- freeze release candidate;
- confirm all blockers are READY;
- run `pnpm launch:require-go`;
- confirm protected CI is green;
- create formal release version/tag;
- publish release notes;
- record rollback reference;
- perform production smoke test;
- declare the formal production release.

## 4. Go / Hold decision rule

The platform is **GO** only when every gate marked `blocking=true` in `config/launch-readiness.json` has status `READY`.

Anything else is **HOLD**.

A HOLD does not mean development has failed. It means a commercial launch dependency remains intentionally unresolved.

No person should manually change `declaredStatus` to GO without updating the underlying gate evidence.

## 5. Launch readiness ownership

| Area | Operational owner role |
| --- | --- |
| Product / engineering | Product & Engineering Lead |
| Production / monitoring | Platform Operations |
| Backup / DR | Platform Operations |
| Commercial pricing | Commercial Lead |
| Sales pipeline | Sales / GTM Lead |
| Legal execution | Company management + legal counsel |
| GST/payment particulars | Finance / authorized management |
| Client onboarding | Implementation Lead |
| First-client UAT | Client authority + Implementation Lead |
| Formal release | Product/Engineering + Management |

One person may hold multiple roles, but the responsibility must remain explicit.

## 6. No-go conditions

Do not commercially launch if any of the following is true:

- unresolved cross-tenant/security defect;
- protected CI failing;
- production readiness/database/Redis failing;
- critical worker repeatedly unhealthy;
- local backup failing/stale;
- verified off-site backup/restore evidence becomes stale, fails, or is no longer representative of the production backup path;
- legal company particulars are unverified;
- public legal notices are missing;
- contract commitments exceed implemented infrastructure;
- first-client validation has not been completed where required by the launch sequence;
- material P1/P2 incident remains open;
- a known critical migration/data-integrity issue exists.

## 7. Non-blocking items

The following are not automatically launch blockers unless they affect a contracted requirement:

- optional custom-domain setup for institutions that did not purchase it;
- SMS/WhatsApp where not contracted;
- custom reports/integrations not in signed scope;
- future native mobile apps;
- major dependency-version upgrades that are not needed for a verified security fix;
- cosmetic enhancements with safe workarounds.

## 8. Step 14 completion definition

Step 14 implementation is complete when:

- a machine-readable readiness source of truth exists;
- every launch domain has an owner and evidence;
- unresolved dependencies are explicit;
- CI validates the readiness manifest;
- a hard GO command exists;
- a launch-day runbook exists;
- no blocker is falsely marked READY;
- the current decision is generated consistently as GO or HOLD.

The **Step 14 control framework can be complete while the overall commercial launch remains HOLD**.
