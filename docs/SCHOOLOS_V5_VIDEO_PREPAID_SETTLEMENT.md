# SchoolOS V5 — Stage 7F2: Video-Minute Prepaid Settlement (Draft)

## Delivered
- `SchoolOSVideoUsageReview` is an additive, tenant-bound maker/checker ledger. One immutable review per meeting records event count, proposed whole room-minutes, the exact signed event snapshot SHA-256, evidence reference and reviewer justification.
- Platform SUPER_ADMIN (home institution `org_default`) can list and propose reviews. A **different** platform SUPER_ADMIN (not the meeting host) must approve or reject a pending proposal. No self-approval, repeated decisions, tenant-originated charge endpoint, or automatic financial actions.
- Approval recomputes signed LiveKit provider evidence **inside the same DB transaction** and rejects added/missing/modified event snapshots or changes in event count, amount or provider session window.
- Requires a nonexpired active institution subscription, no active invoice financial risk holds, and one purchased video-minute balance bucket covering the *entire provider session*. Its source grant must originate from a captured provider payment against a PAID signed-quotation invoice. The prepaid decrement, unique usage-event creation, review finalization and audit log are atomic, sharing the existing `schoolos-usage:<tenant>:video_minutes` lock.
- Provider webhooks and finance approval share a **per-room transaction advisory lock**; late events cannot race a finalized review. DB triggers disallow edits/deletes of reviews and reject new provider events for already SETTLED sessions.
- API paths (all under `/api/v1`): `GET /platform/schoolos/video-reviews/:organizationId`, `POST /platform/schoolos/video-reviews/:organizationId/:meetingId`, `POST /platform/schoolos/video-reviews/:organizationId/:reviewId/decision`.

## Release gates — disabled by default
- `SCHOOLOS_VIDEO_SETTLEMENT_ENABLED=false` and **no** `SCHOOLOS_VIDEO_SETTLEMENT_TENANT_IDS` configured. Both must be explicitly authorized and combined with the existing signed-webhook / video evidence tenant gates. `*` has no wildcard meaning.
- No automatic video usage deduction. A human platform approver must initiate an explicit settlement, and approving cannot capture payments.
- Proposed commercial policy `VIDEO_ROOM_MINUTES_V1`: one chargeable room-minute per started minute containing both the host and another distinct, signed connected participant. This is **not yet customer-approved pricing**.
- User-claimed attendance logs, scheduled room duration, recording duration and browser join requests are not billing evidence.
- Historical period rollover, video session quota admission before LiveKit room access, zero-credit room interruption, late provider event reconciliation and LiveKit cost-per-unit analysis remain to be completed before any customer activation.
- No production configuration edits, migrations applied to servers, paid provider calls, releases, merges or changes to frozen V4 main.

## Tests
Signed snapshot hashing, changes in evidence, unauthorized roles, maker/checker separation, repeated reviews, DB immutability, no charging while feature disabled, provider webhook serialization, full regression and Docker build checks.
