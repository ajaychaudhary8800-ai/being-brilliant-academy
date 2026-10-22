# SchoolOS V5 — Stage 7F6: Supervised Zero-Usage Video Hold Release

## Delivered (draft, disabled)
A meeting that was prepaid for video room-minutes but generated **zero verified billable overlap** can now enter a separate two-person reconciliation workflow. This is a financial credit **hold restoration**, not a bank/card refund.

The request and finalization endpoints are platform-finance-only:
- POST `/api/v1/platform/schoolos/video-zero-release/:organizationId/:meetingId`
- POST `/api/v1/platform/schoolos/video-zero-release/:organizationId/:reviewId/decision` (`{"decision":"APPROVE"|"REJECT","reviewComment":"..." }`).

Both operations are controlled by separate OFF-by-default `SCHOOLOS_VIDEO_ZERO_RELEASE_ENABLED` and exact-tenant `SCHOOLOS_VIDEO_ZERO_RELEASE_TENANT_IDS`, in addition to the previously approved video-webhook, finance and admission controls.

## Conservative provider-evidence admission

A proposal requires an institution-owned **ENDED** meeting, an existing RESERVED paid room-minutes hold, a signed provider `participant_joined` for the original host, a matching `participant_left` for that host, and a signed `room_finished`. There may be no other signed participant event; calculated overlapping room-minutes must be **exactly zero**. The session end, scheduled end **and receipt of the last signed provider webhook** must each be at least **72 hours** old. A delayed webhook restarts the cooling-off window. The provider event snapshot hash, event count and timestamps are immutable.

The proposer and checker must be two different platform administrators, neither may be the room host. A detailed external provider outcome reference and explanation are mandatory. Before final release, the checker must obtain a successful LiveKit `ListRooms` response proving the room is **not currently active**. Provider unavailability, an ambiguous response, a still-running room, changed signed evidence, an active finance risk hold, an already consumed or released reservation, or a failed ledger balance consistency check **blocks release**. A 72-hour waiting period by itself is not sufficient.

On approved release, one DB transaction rechecks all stored evidence, restores held prepaid minutes once, marks the usage reservation RELEASED, finalizes the maker-checker financial review and creates a complete financial audit trail. The DB prevents any future signed webhook event insert into a room whose review is final SETTLED or RELEASED. Normal usage settlement cannot process zero-minute proposals.

A REJECT decision finalizes the review without changing credits.

## Unresolved business risks / acceptance gates

This proof standard is intentionally narrow and conservative. **A signed host-only session, an empty current provider room list and a 72-hour delay do not independently prove the provider has never billed or omitted a webhook.** The independent finance team must validate the supporting external provider evidence reference and the agreed tariff; audit controls do not inspect reference content. Until a verified LiveKit provider-session ledger/export can be reconciled against webhook completeness, release activation remains disabled. Unknown or ambiguous sessions remain RESERVED for human investigation.

Before commercial activation: live LiveKit sandbox tests for room state and missing/out-of-order/late webhook scenarios; end-to-end Razorpay TEST paid credit source verification; security and dispute workflow acceptance; branch chain consolidation; staging backup/restore and migrations; operational alerting; customer pricing/terms signoff; production owner approval.

This Draft PR is stacked on PR #206. Frozen V4 main remains unchanged. No server configuration or customer payment is modified.
