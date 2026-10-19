# SchoolOS V5 Stage 7F5 — Expired Room Cutoff Query Hardening

## Verified risk removed

Earlier Stage 7F4 selected only the first 250 *oldest global RESERVED video credits* before determining whether their meetings were expired, active or opted in. As a result, long-lived future reservations or disabled tenants could prevent an expired paid room from ever reaching the LiveKit provider disconnection worker. This could leave video running past the reserved budget.

The cutoff worker now selects **only** room and reservation pairs that match:
- a permitted, exact organization ID from the operator-only admission allowlist AND all independent video billing/provider gates;
- a verified RESERVED video_minutes record with the precise `video-meeting:<meetingId>` request key;
- that same institution's meeting in SCHEDULED, OPEN_FOR_JOIN, or LIVE status;
- a meeting whose scheduled end is already reached.

The SELECT uses bound parameters and a join against the authoritative meeting table, and orders by earliest scheduled end **before** applying its 1–100 result limit. This avoids starvation from future meetings or other tenants. Provider DeleteRoom is still invoked before any local status change; failed disconnection does not bill, refund or falsely mark the room ended.

## Remaining production limitations

This eliminates one starvation failure mode; it does **not** create an absolute provider-side room TTL. LiveKit CreateRoom supports timeouts while empty, but not a guaranteed maximum session duration in the current documented API. A 30-second application worker remains best effort during outages, multiple replicas and provider throttling. Failed provider disconnects must be monitored with alerts and failure dashboards; there are no automatic credit releases.

Commercial release remains gated on end-to-end provider sandbox QA, supervised abandoned-hold reconciliation with authoritative provider evidence, signed quote/payment verification, complete staged migration and restore, security/load/UAT signoff, and approved AI/video tariffs. Frozen V4 main is unaffected.

## QA

The new isolated PostgreSQL integration scenario constructs four rooms: future eligible, expired eligible, expired non-allowlisted, and ended eligible. With LIMIT 1 the candidate query must yield the expired eligible room only, independently of the older noneligible reservations. Unit/contract tests verify the disabled worker remains inert, provider-first deletion, no financial consumption in the worker, and operational health reporting.
