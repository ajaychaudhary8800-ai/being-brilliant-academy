# SchoolOS V5 — Stage 7F4 Scheduled Prepaid Video Room Cutoff

## Functionality
For **only** explicitly opted-in video billing institutions, a 30-second API worker locates prepaid `video_minutes` room reservations with meeting `endsAt <= now`. It calls the LiveKit provider `DeleteRoom` (not a client join/leave command), and only after a successful provider response does it mark the tenant meeting ENDED, lock the room, end open attendance sessions for operational visibility and record a platform audit event. If the provider request or database update fails, the worker reports an error and retries during the next run; it does **not** mark the room as successfully closed. In multi-instance deployments, some duplicate provider requests may occur; financial usage settlement remains idempotent and separately reviewed.

Operational `/health/operational` includes a `videoQuota` worker health field only when admission is explicitly enabled; the standard V4 operational endpoint is unchanged otherwise. No worker calls any provider or database query when `SCHOOLOS_VIDEO_ADMISSION_ENABLED` is false.

## Important qualifications
- The worker polls every 30 seconds rather than executing a provider-side immutable room-expiration policy. A provider outage, API crash, delayed timer or clock skew may permit a session to continue after its authorized budget. The provider's recovered signed events, NOT this worker's local close time, determine final charge eligibility. Over-budget evidence is blocked from automatic settlement.
- There is still no automated release of abandoned prepaid holds. A separately approved, conclusive provider-outcome maker/checker refund process remains required before commercial activation.
- V5 readiness also depends on test Razorpay quote payment, signed contract provenance and finance QA; staged migrations/restore, load/security UAT, error/restore drills, customer terms and owner commercial signoff. Developer CI alone is insufficient for a 100% launch declaration.
- Live classes outside the meeting-native token issuer require an independent video billing policy; this worker addresses only reserved native meeting rooms.
- This is an isolated Draft PR stacked on Stage 7F3; no V4 main merge, production environment changes, paid provider activations or customer charges.

## Operational acceptance procedure
1. On an isolated staging tenant with no real customers, enable all exact-tenant finance and video-evidence flags only after approval. Confirm worker health and `/health/operational` readiness.
2. With a legitimate paid quoted video balance, open a room near its scheduled end; confirm its prepaid budget is held exactly once.
3. Keep a host and pupil connected past scheduled `endsAt`; verify provider-side disconnection, room state ENDED, source-signed `participant_left` and `room_finished` events, and no premature debit or refund.
4. Repeat with the LiveKit API unreachable: confirm no fake success, explicit degraded worker health and successful recovery after connectivity returns.
5. Reconnect into the expired room; ensure no new token or secondary reservation can be issued.
6. Inspect provider-signed event duration and finance usage review; charge only inside the held budget after two-person approval, then verify refunded unused minutes and duplicate protection.
7. Verify backup, rollback (no destructive migrations), secrets, monitoring and disaster restore against staging before authorizing a commercial rollout.
