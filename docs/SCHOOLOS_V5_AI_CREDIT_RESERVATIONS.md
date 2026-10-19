# SchoolOS 5.0 — Stage 7E1: AI Credit Reservation Foundation

Status: Draft development. Not activated in any deployed AI Examiner worker.

## Implementation
- Additive, rollback-aware PostgreSQL SchoolOSUsageReservation model, linked to institution and purchased usage balance. Strict SQL tenant/metric guard, immutable reservation identity, legal state constraints and unique (tenant, metric, requestKey).
- `reserveSchoolOSAIExaminerCredit`: server-only atomic admission for one proposed AI Examiner evaluation credit; enforces active subscription, purchased balance sourced from a signed-quote PAID invoice with a CAPTURED payment, no finance hold, and available units. Concurrency uses the existing institution + usage metric advisory lock.
- `commitSchoolOSAIExaminerCredit`: creates precisely one immutable CONSUME usage event for provider-confirmed billable work; replay is idempotent and committed charges cannot be released.
- `releaseSchoolOSAIExaminerCredit`: restores one reserved unit only for a conclusive non-billable failure with a documented release reason. Replays are idempotent. An unconfirmed/timed-out provider call must NOT automatically release credits.
- Failed or concurrent over-quota reservations never authorize a provider invocation. Any repeated RESERVED invocation also returns `admitted:false` and must not cause another provider request.
- The ledger's `consumedUnits` temporarily includes reserved plus committed credits. Future usage dashboards must split pending reservations from final billable consumption.

## Explicit commercial gates
- Pricing definition `EXAMINER_EVALUATION_V1` (proposed 1 credit per evaluation) needs commercial approval, including whether provider attempts, retries, second-pass verification and code execution count independently.
- No provider runtime hookup yet: the AI Examiner worker currently calls its primary and optional independent providers without a reservation. Wiring cannot be certified without a provider-result state machine and recovery/reconciliation for abandoned reservations.
- No credit auto-expiry refund, automatic release, paid provider activation, new REST debit endpoint, LiveKit usage billing, main deployment or V4 changes.
- Financial-risk reviews continue to block consumption, and original paid grant validity remains authoritative.

## Operational considerations
Do not automatically release stale RESERVED credits. Establish an independently verified provider outcome, transition to COMMITTED when billable, or document a conclusive non-billable reason for RELEASED. Later finance controls should surface pending reservations and reviewed actions.
