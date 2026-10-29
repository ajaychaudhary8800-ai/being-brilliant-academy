# Adhyay SchoolOS V5 — finance/legal decision sheet and commercial pilot terms
**Prepared 29 October 2026 · DOCUMENT FOR HUMAN REVIEW — NOT APPROVED, NOT SIGNED**

**Finance/legal reviewer appointed:** Madhuri Verma. Appointment was confirmed by the owner; her acceptance, legal credentials, independent counsel review and signatures **have not** been provided. No communication to her or to a customer was sent.

**Release state:** V5 commercial production **HOLD**; all 10 formal gates **PENDING**. Relevant development/staging operator-reported revision: `f736e64b0e1b332aabf20557025f10b3b602b97b`; immutable production RC, signed terms, and real provider-to-ledger artifact set are **not approved**.

## Decision A — keep internal BBA pilot separate from sales

**Recommended for decision, not approved:** classify Being Brilliant Academy as an **owner-operated, non-billable UAT pilot** with synthetic or explicitly authorized institution data in isolated V5 staging; do not auto-issue quotations, invoices, renewals or Razorpay payments to BBA. A coaching-mode UAT signatory (Ajay Chaudhary) is appointed, but no actual UAT acceptance is signed.

This is different from a *commercial* 60-day institutional pilot. BBA's internal UAT must not be counted as independent external-customer acceptance or provider revenue. Before using real student data, approve the appropriate internal data-processing access/retention policy and actual tenant configuration. A live BBA tenant identifier, branches, modules and any needed migration are **not verified** merely by the synthetic `schoolos-qa-coaching` fixture.

**Decision record:** Internal BBA pilot classification: `PENDING`; reviewer: Madhuri Verma; approved environment/tenant: `NOT ENTERED`; permitted data scope: `NOT ENTERED`; evidence/signature reference: `NOT ENTERED`.

See [BBA pilot UAT handoff](SCHOOLOS_V5_BBA_INTERNAL_PILOT_UAT_HANDOFF_20261029.md).

## Decision B — authoritative annual rate card and quotation semantics

Launch reference `SCHOOLOS-LAUNCH-2027-INDIA-V1`, in [source](../apps/api/src/lib/schoolos-pricing-reconciliation.ts), states:

| Plan | Annual base | Inclusive total **if** 18% GST applies | Onboarding **estimate only** (not approved as automatic add-on) |
| --- | ---: | ---: | ---: |
| Essentials | ₹49,900 | ₹58,882 | ₹9,999 |
| Growth | ₹99,900 | ₹1,17,882 | ₹14,999 |
| Professional | ₹1,49,990 | ₹1,76,988.20 | ₹24,999 |
| Enterprise | Custom signed quotation | To calculate per scope/tax | Custom |

The owner-supplied **23 October post-correction staging dry run** reported all three fixed annual tiers ALIGNED, `blocked=0`, `changed=0`. The earlier Growth ₹99,990 reference was historical drift, **not** newly proven drift. The staging audit ID and independent finance acceptance are absent. Do **not** apply another price change, replace historical quote snapshots, or treat a TEST invoice as revenue. Tax rates and invoicing language must be checked by the accountable finance/tax reviewer against actual applicability; the amounts above are illustrative, not a tax ruling.

**Decision record:** Accept rate card/version: `PENDING`; accept provenance and staging audit ID: `PENDING`; discounts/add-on approval policy: `PENDING`; finance reviewer decision/date/artifact: `NOT ENTERED`.

## Decision C — resolve onboarding conflict in one policy

**Recommended policy for Madhuri to approve, modify or reject:**

1. **Included standard remote onboarding** within the first annual term: one remote kickoff, guided tenant/branch setup, basic admin orientation and standard support documentation, subject to a separately stated fair-use scope.
2. **Optional separately scoped implementation** only when the signed SOW requests data migration, bulk setup, customization, on-site training, additional campuses or deeper integrations; the existing ₹9,999/₹14,999/₹24,999 tier figures remain **non-binding estimates** until approved against measurable deliverables.
3. No mandatory second fee imposed by surprise on a client who accepted an annual plan described as including remote onboarding; existing signed terms/quotations are not retroactively altered.
4. Assign tasks, timing, acceptance, cancellation/refund treatment and taxes to the scoped SOW. Do not imply that an estimated fee is already configured as an automated checkout product.

**Decision record:** Included onboarding wording: `PENDING`; standard support/training hours: `NOT ENTERED`; separately billable trigger/deliverables: `PENDING`; fee schedule: `PENDING`; signoff: `NOT ENTERED`.

## Decision D — 60-day external commercial pilot: contractual outline

Reference price from the code is **₹14,999 ex applicable GST / 60 days** (₹17,698.82 at an illustrative 18%). It is **not** an implemented annual SaaS checkout variant; a real commercial pilot must not be charged using the annual checkout by manipulating quote duration or invoice status.

**Recommended offer structure to review, not a sale-ready offer:**

| Term | Recommended review position | Required human or technical clearance |
| --- | --- | --- |
| Eligibility | One identified, independently authorized external institution; genuine signed scoped pilot order | Customer signatory authority and institution/tenant link |
| Start | 60 consecutive calendar days beginning only on a documented agreed activation milestone | Provider/support and customer agreement; technical entitlement support |
| Scope | A narrowly named subset of currently proven ERP/LMS/coaching or school modules | Verify actual plan/module entitlement; no automatic assumption of available capacities |
| Capacity | Branch, student, teacher, storage, communication and migration limits **explicitly entered on SOW** | Finance/product verifies platform-enforced limits before offering |
| Standard onboarding | Include only the approved standard remote package; custom implementation a separately approved scoped estimate | Decision C |
| AI/video | Paid video admission/settlement and unapproved AI metering **remain OFF**; no “unlimited” promises | Product/provider and margin review before contractual inclusion |
| Collection | Only a separately approved, legally documented and supported collection/invoicing path | Finance evidence for actual TEST→live security, tax, receipt and reconciliation; no bypass of contract controls |
| Refund/early exit | Unambiguously state start trigger, cancellation/refund conditions, service discontinuation, available data export and deletion duties | Legal/privacy and finance approval |
| Conversion | No automatic annual renewal or payment authority; send optional quoted annual scope before pilot expiration | Customer opt-in, contract/renewal support, applicable notice/consent |
| Support | Name contact, support hours, severity response/priority, exclusions and any planned downtime under signed SLA | Operations duty cover and approved contractual commitments |
| Outcome criteria | Define agreed UAT scenarios, defect severity threshold, handover evidence, success/exit decision | Customer sponsor plus accountable product/QA owner |

Pilot price and term alone do **not** demonstrate a revenue product or mandate collection. No charge, provider activation or invoice creation is authorized by this table.

**Decision record:** Pilot included modules: `NOT ENTERED`; capacities: `NOT ENTERED`; 60-day start: `PENDING POLICY`; refund/exit and annual conversion: `PENDING`; supported collection path: `PENDING`; legal approval: `NOT ENTERED`.

## Decision E — contracts, privacy and financial evidence

Review **actual controlled template** [client handover/acceptance certificate](legal-sales/11_CLIENT_HANDOVER_ACCEPTANCE.md), [implementation kit](CLIENT_IMPLEMENTATION_KIT.md), current subscription/Order Form/SOW/DPA/Privacy/SLA versions and all V5-specific AI, recording, data retention, breach-response, support and liability changes.

Do not use a customer handover certificate to approve a **preproduction** UAT by changing its production-acceptance meaning. The BBA internal-pilot UAT is separately labelled in its handoff. For external commercial customers, the signed provider and client copies must be restricted; only approved sanitized evidence references and hashes belong in the repository.

Finance acceptance must map **actual** Razorpay TEST order/payment/refund or dispute IDs to the **genuine** QA contract, tenant, invoice, callback signatures and immutable ledger. [Exact-source synthetic integration evidence](SCHOOLOS_V5_PROVIDER_EVIDENCE_MAP_20261029.md) verifies failure, replay, refund and renewal *code paths* but does not prove actual provider lifecycle; retrieve the pre-existing operator-reported TEST proof before requesting any new transaction. Document scope of any unavailable dispute/renewal evidence and do not claim it passed.

**Decision record:** controlled document versions reviewed: `NOT ENTERED`; privacy/DPA opinion: `PENDING`; GST/receipt/refund treatment: `PENDING`; provider-to-ledger acceptance: `PENDING`; outside-counsel review required? `PENDING DECISION`; attributed finance/legal decision: `NOT ENTERED`.

## One-page human approval record — currently uncompleted

| Item | Named accountable reviewer | Decision | Dated evidence/signature reference |
| --- | --- | --- | --- |
| A. BBA internal pilot, data scope | Madhuri Verma | **PENDING** | — |
| B. Annual plans and tax treatment | Madhuri Verma | **PENDING** | — |
| C. Standard onboarding versus extras | Madhuri Verma | **PENDING** | — |
| D. External 60-day pilot contract/collection | Madhuri Verma, qualified counsel if required | **PENDING** | — |
| E. V5-specific privacy/DPA and finance ledger | Madhuri Verma, independent qualified reviewer if needed | **PENDING** | — |

**Minimum review instruction:** read existing artifacts first, decide each item explicitly, record any exception and approved version, then supply a **genuine** dated approval/rejection through the authorized confidential channel. Appointment is not signature. This document is not legal or tax advice or independent counsel certification.

**Commercial Gate 9: PENDING. Customer Gate 7: PENDING. Security Gate 6: PENDING. No production or paid release GO.**
