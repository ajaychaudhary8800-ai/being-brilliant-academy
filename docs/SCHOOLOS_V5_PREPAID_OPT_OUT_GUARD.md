# SchoolOS V5 Stage 7G7 — Persistent prepaid-room opt-out protection

## Production-critical downgrade bypass

A runtime billing flag or tenant allowlist removal could make an **already reserved** native LiveKit meeting appear to be unmetered. The token endpoint would then mint a four-hour unmetered LiveKit JWT, the /join endpoint would stop enforcing the existing hold, and a host end action would revert to best-effort DeleteRoom. This can defeat the prepaid cutoff guarantees even though the Stage 7G6 background worker continues to inspect historical reservations.

## Resolution

- Track a room's immutable historical prepaid allocation through the existing unique, tenant-scoped `SchoolOSUsageReservation` key (`video_minutes`, `video-meeting:<meetingId>`); read even if the original reservation has been finalized.
- Both `/meetings/native/:room/session` and `/meetings/native/:room/join` **fail closed** with 409 `SCHOOLOS_VIDEO_PREPAID_ROOM_OPTED_OUT` when a previously prepaid room's current opt-in is disabled. This does not block unrelated preexisting unmetered V4 meetings.
- `/meetings/native/:room/end` continues to require positive LiveKit provider termination proof whenever either current metering is enabled **or** the room has any historical prepaid reservation. Opt-out cannot bypass verified room termination. No provider errors leak to clients.
- This is tenant-bound, read-only with respect to billing and does not release, debit or reserve minutes. Stage 7G6 expiry worker remains independent of admission flags.
- Contract tests enforce that the historical-hold guard precedes token issuance and client attendance writes. Isolated PostgreSQL regression checks tenant isolation, historic hold detection, and absent/legacy rooms.

## Acceptance gaps

Exact-head CI must pass API tests, PostgreSQL, TypeScript, API/Web and container validation. Separate staging must validate toggling the global feature or exact-tenant allowlist *while connected*, rejecting another token/join, host-side verified end, worker expiry/retry under provider timeouts and commercial billing evidence. Do not activate live metering or change V4 production.
