# SchoolOS V5 — Stage 7G4: Provider-Confirmed Meeting End

## Release-critical bug closed

Before this change, `POST /api/v1/meetings/native/:room/end` suppressed all LiveKit `DeleteRoom` failures and **still** closed its meeting, recorded attendance as finished, and advanced recordings. The prepaid quota enforcement worker only retries meetings in `SCHEDULED`, `OPEN_FOR_JOIN` or `LIVE`. As a result, a failed host-initiated DeleteRoom could remove the room permanently from the worker queue even though the provider room continued running, increasing infrastructure cost and leaving provider billing reconciliation unreliable.

## New opt-in behavior

For organizations explicitly enabled for SchoolOS paid-video admission, the host/co-host end route must receive an accepted provider `DeleteRoom` response **before any** recording, attendance or meeting-close writes. If LiveKit is unavailable, times out, or rejects the delete, the route returns `503 SCHOOLOS_VIDEO_PROVIDER_END_UNCONFIRMED`. It does not mark the meeting ended. The existing scheduled disconnection worker remains capable of discovering the still-active meeting at the authorized session deadline.

For all existing unmetered V4 institutions, the prior best-effort provider deletion path remains unchanged. No new paid flag is enabled, no prepaid minutes are released/charged, and no financial decision is inferred merely from the local meeting status.

This is **fail-closed**, not an absolute guarantee of provider termination: the LiveKit API could complete a delete and then lose its response. A retry may see a missing room and require an independent ListRooms proof before local closure. The operator must investigate repeated 503s and keep the original hold pending verified provider evidence.

## Acceptance tests added

- A confirmed provider deletion permits room closure.
- LiveKit timeout, authorization failure, unknown provider exception and ambiguous errors fail with retriable 503, without disclosing provider exceptions.
- A route contract asserts provider deletion precedes recording updates, attendance closure and local meeting end.
- A regression contract verifies the old V4 fallback is still isolated.
- A worker contract asserts failed host-initiated termination leaves the local status eligible for provider retry.

## Pending before 100%

Real LiveKit staging timeout and missing-room tests, customer-priced contract signoff, full native classroom quota coverage, signed event and payment-provider UAT, staging restore, security/load QA and formal production approval. This Draft PR is stacked on #211. The previous engineering estimate was ~91%; green CI alone does not create release authorization. All ten final GO/HOLD manifest gates remain PENDING.
