# SchoolOS V5 — Stage 7G6: Residual prepaid LiveKit room cutoff after feature disable

## Defect addressed

Previously, the quota worker returned immediately when `SCHOOLOS_VIDEO_ADMISSION_ENABLED` was switched off or a tenant was removed from the admission allowlist. The server timer also skipped the worker entirely. This creates an enforcement bypass: an already connected LiveKit room with a previously approved `video_minutes` reservation can remain active beyond its authorized `endsAt` if new admissions are disabled mid-session.

## Fix

- Admission feature flags and exact-tenant allowlists continue to govern **new** reservations and joins; there is no change to `authorizeSchoolOSPrepaidVideoRoom`.
- The 30-second safety worker ALWAYS inspects only **expired, active** meetings with a matching `RESERVED video_minutes` / `video-meeting:<meetingId>` hold. These already-issued holds remain enforceable after allowlist/feature disable.
- Candidate SQL excludes `org_default`, binds reservation and meeting to the same tenant and room, orders expired meetings before `LIMIT`, and supports scoped administrative queries without changing their existing empty-list semantics.
- The worker must obtain positive LiveKit DeleteRoom success or independently verify room absence before marking a meeting ended. Provider uncertainty remains failed and retryable; **no** usage capture, payment, ledger debit or credit release is performed.
- Operational worker health is exposed when admissions are enabled **or** a residual prepaid room is being processed, so provider cutoff failures cannot be hidden solely by turning off new admissions. With no feature and no residual room, the preexisting V4 operational health response shape remains unchanged.

## Automated QA

- Unit contracts confirm that neither the worker nor its timer skips outstanding prepaid rooms after feature disable.
- Isolated PostgreSQL test verifies unscoped residual cutoff selection includes expired eligible and de-allowlisted tenants, excludes future and ended meetings, and limits correctly; scoped and empty-array behavior is retained.
- Full TypeScript, PostgreSQL, container and API/Web CI must pass for the immutable PR head. CI is not real provider UAT.

## Remaining acceptance and safety

Requires staging LiveKit end-to-end proof for mid-call disable, webhook reconciliation under provider outage, effective shutdown latency, maker/checker finance settlement, and Razorpay TEST quote-paid hold proof. The 30-second polling strategy cannot guarantee instantaneous disconnect under outage; over-budget billed sessions fail closed. No merge, V4 production mutation, secrets change, external activation or deployment in this Draft PR.
