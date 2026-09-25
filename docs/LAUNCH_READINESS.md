# Step 14 — Final Launch Readiness

**Product:** Being Brilliant ERP + LMS + CRM  
**Owner:** Platform leadership / commercial operations  
**Effective:** 25 September 2026  
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

## 2. Current hard launch blockers

### A. Step 5 — Off-site Backup & Disaster Recovery

Status: **PENDING_DEPENDENCY**

Before full commercial launch:

- configure real off-site object storage;
- verify scheduled off-site upload;
- verify off-site checksum/integrity;
- complete isolated restore;
- record measured recovery evidence;
- only then define contractual RPO/RTO where appropriate.

Local backup health does not satisfy this requirement.

### B. Corporate/legal execution particulars

Status: **BLOCKED_EXTERNAL**

Before the first external signature or public legal publication, verify:

- registered office;
- CIN;
- GSTIN;
- authorized signatory;
- contract notices email;
- privacy/grievance contact;
- support email/phone;
- approved support hours;
- bank/payment details used on quotations;
- Indian counsel review of the controlled legal pack.

Do not infer or invent these values from unverified directories.

### C. Public Privacy / Terms / AUP publication

Status: **PENDING_DEPENDENCY**

The current public SaaS website does not expose approved Privacy/Terms/AUP links.

After corporate particulars and counsel review:

- publish the approved Privacy Notice;
- publish applicable public SaaS/Terms terms;
- publish Acceptable Use Policy;
- add footer links;
- link appropriate policy text at the demo/contact form;
- verify mobile/desktop accessibility.

Do not publish draft legal templates as final legal notices.

### D. Step 11 — First Real Paying Client

Status: **PENDING_DEPENDENCY**

A real institution must complete:

- qualified sales process;
- agreed plan/scope;
- signed/accepted commercial documents;
- required payment/activation condition;
- tenant provisioning;
- data/configuration;
- UAT;
- client approval;
- go-live;
- post-go-live smoke validation.

Synthetic QA tenants do not satisfy this gate.

## 3. Downstream formal release

Step 12 — Formal Production Release remains downstream of first-client validation.

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
- Step 5 remains unresolved for the agreed launch standard;
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
