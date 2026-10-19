# SchoolOS V5 Stage 7F3 — Prepaid LiveKit Video Room Admission

## Scope implemented

In the existing `meetings/native/:room/session` token issuance and `/join` operations, **only explicitly opted-in institutional tenants** must reserve a complete scheduled room budget before receiving a LiveKit token or attendance join. The reservation is serialized across concurrent rooms using the same advisory usage lock as paid credits; provider webhook ingestion and manual settlement share a room lock. A room's reserved usage key is `video-meeting:<meetingId>`: duplicate participant joins reuse the reservation without another debit.

Stage 7F2 finance approval has been integrated with these holds: it **requires** an existing tenant-specific RESERVED prepaid quota, rechecks signed LiveKit evidence and the time budget, bills actual provider-confirmed minutes, and restores only the unused part of the hold within the same ledger transaction. Final settlement sets the immutable reservation status COMMITTED, writes exactly one CONSUME event, and records the difference in financial audit logs. A late provider event after settlement is rejected. If the provider's confirmed event duration exceeds the reserved budget, no automatic charge occurs: finance must reconcile.

Subscription, verified provider-paid signed-quotation grant, provider finance hold, distinct organization/billing period, available balance, tenant identity, actual scheduled meeting status and duplicate request-key constraints are checked **before** the first reservation. Meeting token lifetime is also shortened to the scheduled room end.

Read-only billing endpoints separately expose `pendingAIReservations` and `pendingVideoReservations`. The latter explicitly has no automatic release.

## Conservative policy

Preauthorizes from ten minutes before `startsAt` until `endsAt` (rounded up to whole room-minutes), maximum **240** reserved minutes. This protects against concurrent-room overspend and double consumption, but does not enforce a provider-side hard disconnect after the scheduled end. A room can be connected beyond its token JWT expiry; therefore **cost leakage is still possible** until a scheduled LiveKit DeleteRoom enforcement worker has been separately tested and activated. Provider sessions over budget are withheld from automatic settlement.

## Four independent, initially OFF finance/provenance gates

`SCHOOLOS_VIDEO_WEBHOOK_ENABLED=false` and exact tenant list `SCHOOLOS_VIDEO_EVIDENCE_TENANT_IDS`.
`SCHOOLOS_VIDEO_SETTLEMENT_ENABLED=false` and exact tenant list `SCHOOLOS_VIDEO_SETTLEMENT_TENANT_IDS`.
`SCHOOLOS_VIDEO_ADMISSION_ENABLED=false` and exact tenant list `SCHOOLOS_VIDEO_ADMISSION_TENANT_IDS`.

An operator must enable **all** corresponding settings for the exact institutional tenant after customer tariffs and financial controls have been approved. The code accepts no wildcard. With defaults, the existing V4 LiveKit meeting behavior is unchanged.

## Release blockers (not marked READY)

1. Provider-side room disconnect at hard authorized usage limit, including worker restarts/recovery; protect video cost exposure if provider session continues past planned end.
2. Supervised proof-backed cancellation/release of reserved video holds when a provider call never became billable. Unknown outcomes must remain held.
3. Browser/LiveKit acceptance across host/cohost/student, reconnect, clock-skew, dropped/duplicate/out-of-order webhooks, late provider delivery, concurrency and expired terms, with no cross-tenant leakage.
4. Confirm if customer contract bills **room-minute** versus **participant-minute** and exact granularity, overage pricing, holiday/rollover policy, refund adjustments and GST invoices.
5. Test Razorpay payments against test tenant with a real verified signed quote before finance approval, then check 24h ledger and operational reconciliation.
6. Confirm other LiveKit token endpoints (live classes) use an appropriate separate policy. This code gates **native meetings only** and does not charge classroom streams.
7. Audit Draft PR dependency chain, eliminate conflicting older Draft work, validate staging migration from latest V4 data backup, backup/restore, security and load QA, and formal commercial signoff.

**Do not report Version 5.0 as 100% or production-ready on the basis of this PR.** V4 main is frozen, and this PR is draft, unmerged and undeployed. No environment variables, paid services or production records have been changed.
