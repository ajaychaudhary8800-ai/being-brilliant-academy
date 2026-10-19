# SchoolOS V5 — Stage 7G5: Signed LiveKit Provider Flow Acceptance

## What this stage verifies

This stage expands beyond policy-unit tests and direct database inserts by exercising the actual **signed LiveKit webhook ingestion service**, immutable PostgreSQL provider evidence, preview algorithm and human finance-review proposal from end to end in isolated test infrastructure.

The test proves:
- Raw event bodies pass authenticated LiveKit HS256 signature and byte-for-byte SHA-256 checks.
- Provider events delivered **out of chronological order** are stored safely and later evaluated in provider-event order.
- Duplicate signed webhook delivery is idempotent (STORED once, then REPLAY), but a reused provider event ID with different signed bytes is rejected.
- Unsigned or tampered events cannot create evidence, and uninvited identities, unknown rooms and disabled institutions cannot influence a customer's billing.
- Complete signed host/student overlap produces correctly rounded room-minutes, and a terminal `room_finished` is always treated as **room-scoped** even if the provider attaches incidental participant metadata.
- Finance-maker proposals pin the signed snapshot without debiting any purchased minutes.
- Valid provider events delivered **after** a proposal invalidate its approval proof, even when the calculated amount remains unchanged. An independent checker must not approve or reject a stale evidence snapshot.
- All evidence remains tenant-isolated and no financial CONSUME ledger rows are added during these tests.

## Safety / scope

This is an **isolated PostgreSQL integration test** using local test LiveKit HS256 credentials and synthetic tenant identities. It does not call the live LiveKit cloud service and does not activate any actual customer billing, server configuration or production migrations. It is useful evidence of software integration behavior, **not** evidence that LiveKit guarantees complete webhook delivery or that Razorpay paid video credits work end to end.

## Remaining commercial acceptance

Live staging must still validate real provider events, webhook replay and outage behavior, disconnected-room evidence, paid quote-linked Razorpay TEST grants, approved prepaid balance settlement (not only a proposal), quota-enforcement retries, and zero-use release with independent provider billing-source evidence. Finance/legal pricing, institutional UAT and a production-owner GO decision remain mandatory.

The V5 release-candidate manifest stays HOLD until signed independent proof covers those acceptance gates. This Draft PR builds on Stage 7G4 #213; V4 main remains frozen.
