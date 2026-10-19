# SchoolOS V5 Stage 7F1 — Signed LiveKit Usage Evidence (Draft)

## Scope
Introduces verifiable LiveKit event provenance and **non-billable** room-duration previews. There is no debit from any purchased video-minute balance in this stage.

- Raw `application/webhook+json` body is inspected **before** Express JSON parsing.
- Signed JWT authorization must match configured LiveKit API key, HS256 API secret and binary SHA-256 hash of the exact raw webhook body. Body size limited to 64 KiB.
- Deployment gate `SCHOOLOS_VIDEO_WEBHOOK_ENABLED` defaults to false. `SCHOOLOS_VIDEO_EVIDENCE_TENANT_IDS` is an exact organization-ID allowlist, initially unset. No wildcard can enable any tenant.
- Only `participant_joined`, `participant_left` and `room_finished` signed provider events become durable evidence. All other signed provider events are ignored without billing side effects.
- Provider room must resolve to **exactly one meeting**. Participant identity must match an assigned meeting participant from that same tenant. Ambiguous room names and cross-tenant identities fail closed.
- Each signed provider event is stored once by provider event ID and immutable SHA-256 payload digest. Duplicate genuine retries are idempotent; conflicting IDs are rejected. PostgreSQL guards reject tenant mismatch, unknown participants, and UPDATE/DELETE of evidence rows.
- Platform SUPER_ADMIN can inspect bounded room-based evidence previews through `GET /api/v1/platform/schoolos/video-evidence/:organizationId/:meetingId`. Other roles cannot access the preview. No customer-originated POST can supply billable evidence.

## Proposed measurement — not a contracted tariff
A meeting is provisionally a billable **room** when the provider verifies concurrent media connections from the host and at least one other distinct participant. Preview seconds cover intervals where this condition holds. Total seconds are rounded up once per complete room session, not once per participant, connection or recording. A verified `room_finished`, all matching provider join/leave pairs, and a bounded duration are required. Any missing, unmatched or duplicate events yield `RECONCILIATION_REQUIRED`, not an optimistic estimate.

Client-invoked meeting `/join` and `/leave` attendance logs, requested LiveKit access tokens, scheduled meeting time and recording duration are **not** valid billing evidence.

## Operational limitations and next stage
LiveKit webhooks have delivery retries but are not guaranteed. Missing events must be reconciled with provider-side records before billing; do not infer ended connections from local attendance. Cross-tenant or ambiguous rooms cannot be billed. The actual per-tenant video-minute quote, whether room-minutes vs participant-minutes, rate granularity, refunds and subscription rollover all require finance approval.

Next stage 7F2 will add provider-side closed-session reconciliation, separately approved prepaid video reservation/settlement, and end-to-end tests. Stage 7F1 intentionally has **no automatic metering charge, payment capture, configuration change on servers, merge or production deployment**. Frozen V4 remains unchanged.

Provider reference: https://docs.livekit.io/intro/basics/rooms-participants-tracks/webhooks-events/
