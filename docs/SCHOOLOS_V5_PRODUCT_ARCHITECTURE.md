# Adhyay SchoolOS 5.0 — Product architecture and dependency plan

**Status:** development plan, not a claim of completed release or approved deployment.
**Protected V4 baseline:** `main` at `50dfdeb4f99c5cdbaf1d5a9502c709fbbf2798f6` when V5 work started on 18 October 2026.
**Commercial objective:** modular multi-tenant ERP/LMS with configurable customer-specific packages, quotation workflow and measurable SaaS operating cost. January 2027 is the stated launch campaign target, not a release guarantee.

## Existing platform — extend, don't duplicate

- Next.js + Express, Prisma/PostgreSQL, Redis, authentication and tenant separation.
- SaaS plans/limits, subscription billing, institution-owned student fee payments, admin/teacher/student/parent portals.
- ERP (admissions, academics, attendance, fees, HR, finance, library, inventory, transport, hostel).
- LMS/live classes, AI Examiner/checked copy, meetings, automation, connected campus, reports.
- Platform super admin and commercial legal pack.

Use existing plan entitlements and `requireCommercialFeature` route guards as the V5 product policy foundation. Keep the identity provider, student fee gateway, and SaaS gateway logically separate.

## V5 proposed customer capability roadmap

| Workstream | Deliverable | Prerequisites and nonnegotiable gates |
| --- | --- | --- |
| Modular licensing | Tenant feature catalog, parent dependencies, toggle states, expiring trials and override audit | Tenant authorization, server-side guards, legacy compatibility |
| Sales-to-cash | Approved rate card, item price/version, quote preview, draft/revision, approver, order form, invoices | Contract verification, signed approvals, verified payment before paid activation |
| Adaptive academics | Teacher copilot, curriculum mapping, assignments, study plans, question-bank intelligence | Human review, role-aware retrieval, approved curriculum content |
| AI Examiner quality | More reliable multi-modal grading, handwriting/diagrams, rubric and confidence gates | Regression benchmarks, reviewer overrides, audit, checked-copy evidence |
| Student experience | Guided practice, doubt tutor, learning risk flags and parent insight | Child-safety policy, student permissions, no automatic high-stakes decisions |
| Principal/management insights | Cash flow, attendance risk, admissions funnel, staffing and actionable summaries | Grounded data source, citations, transparent calculations |
| Automated workflows | Rules, document intake, reminders, multi-step approvals | Existing automation worker, tenant isolation, rate limits, kill switch |
| Video and live teaching | Attendance/recording governance, minutes, storage, streaming usage meters | Provider consent, storage retention, per-tenant quota enforcement |
| Integration layer | School website forms, SMS/WhatsApp, devices, third-party tools | Scoped credentials, webhooks with signature verification, retry/idempotency |
| Configurable niche templates | School, coaching, training centre, internship supervisor | Separate scope boundaries for clinical/medical records; do not treat ERP as health EHR |

## Current development slices

- **Stage 1 / PR #179:** per-tenant feature overrides with platform-only management UI, explicit deny, 60-day maximum unpaid module trial, audit history and tenant settings protection. Backend route denials and sidebar hides supported modules.
- **Stage 2 / PR #180:** platform-only internal draft quotations, integer-paise/GST calculations, snapshotting, append-only version records, optimistic draft edits. Drafts do not issue orders or grant access.
- **Stage 3 / PR #181:** separate AI Examiner and Workflow Automation customer switches. Children inherit parent plan access for backwards compatibility; parent denial always wins.
- **No PR above is authorised for production:** all remain independent or stacked Draft PRs and must pass complete CI plus deployment gates.

## Required V5 quality and release sequence

1. Confirm exact product and pricing catalogue with commercial sign-off; reconcile old rate cards with the updated October 2026 proposal. Preserve existing signed-contract terms.
2. Complete feature route inventory for every customer-facing API and UI; close bypasses, especially student/teacher interfaces and shared infrastructure.
3. Define billable usage dimensions (student seats, AI tokens/credits, video minutes, storage, WhatsApp/SMS sends). Meter accurately before charging.
4. Add licensed quota enforcement at API/storage/worker boundaries and tenant cross-access negative tests.
5. Implement feature dependencies, trial expiration policy, quotation approvals, issued order forms, immutable signatures/evidence and exact plan effective dates.
6. Link payment capture or approved enterprise contract to activation in an idempotent transaction. Never grant paid features on checkout initiation or a draft quote.
7. Add teacher/admin copilots and examiner enhancements incrementally with evaluation datasets and human-review gates.
8. Validate data protection, parent-child privacy, AI processing retention, auditability, DR/backups and rollback.
9. Run staging migration rehearsal and synthetic new-customer onboarding through the full quote-to-access process.
10. Obtain explicit production release authorization and preserve V4 rollback baseline.

## Commercial design constraints

- **Price/cost truth:** use approved INR paise, documented GST handling and provider pass-through charges; don't invent per-feature rate cards.
- **No accidental clinical expansion:** Internship management for a psychologist may use appointment and trainee workflows only after privacy review; clinical histories, psychometric results and health records need separate specialist product/security review and explicit informed consent.
- **No V4 stability regression:** isolated feature branches, deterministic tests, additive migrations and rollback-first release.
- **No unmetered unlimited AI/video:** hard per-tenant monthly caps and anomaly alerts are required before premium AI/video bundles are sold.
