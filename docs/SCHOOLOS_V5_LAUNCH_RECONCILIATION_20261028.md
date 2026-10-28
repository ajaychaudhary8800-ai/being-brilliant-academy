# V5 commercial launch reconciliation — 28 October 2026

## Scope and evidence standard

Application candidate and operator-reported deployed API/Web revision:
`c8c80151b6f0919552d60c5cb71af1b92d319ff5`.
Cumulative development PR: #262; security implementation: merged #276; security tracking: #275.
This is a reconciliation of connector observations and owner-supplied terminal/UI evidence, not an independent signed release approval. No credentials or student records are included.

The documentation/manifest commit containing this report is NOT a newly deployed application revision.
The release candidate remains the pinned application source above. All ten formal gates remain PENDING and declaredStatus remains HOLD.
The existing validator prohibits evidence entries on PENDING gates; this report holds provisional observations outside those signoff arrays. Do not weaken the validator or fabricate reviewer identities.

## Completed work to carry forward

| Area | Evidence and scope | Remaining limit |
| --- | --- | --- |
| Source/CI | GitHub PR #262 head matched the candidate. Four exact-source workflows SUCCESS: [CI](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/actions/runs/40549283311), [sandbox](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/actions/runs/40549283373), [external QA](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/actions/runs/40549283315), [upgrade rehearsal](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/actions/runs/40549283325). | Attributed review/build provenance remains separate from workflow success. |
| Deployment | Owner reported successful controlled V5 redeploy; supplied Docker audit shows API/Web revision labels match candidate. | Labels are self-reported metadata; preserve deployment/build logs for independent provenance review. |
| Credentials | Owner removed four global LiveKit keys after Compose reload. Audit showed NONE in Docker Config.Env for nginx, web, api, migrate, backup, postgres and redis. API-only read-only LiveKit/Razorpay mounts; backup-only read-only R2 mount. | API entrypoint loads credentials into its process; Docker Config.Env absence is expected. Replacement authentication/runtime-match checks now passed; owner confirms both old provider credentials revoked (see rotation update below). |
| Persistence | Exact existing postgres-data, redis-data, app-storage and backups volumes remain mounted under project 96ffcu0jinuwlnaqxpltln4p; API/backup share app-storage. | Mount identity does not independently prove every historical row/file is intact. Leave backup's extra anonymous volume untouched. |
| Service/migration | Five core services healthy; backup running/starting in supplied snapshot. Migration stopped with exit 0; SQL showed 114 applied, 0 unresolved. | Do not treat stopped migration health=unhealthy as execution failure. SQL does not independently compare every migration file to the database. |
| Backup | Health script exit 0 and success marker present. Reviewed script verifies no failure marker, referenced directory/SHA256SUMS existence and configured freshness. | This does not recompute checksums, retrieve offsite objects, restore data or prove Docker health later became healthy. |
| Billing controls | Razorpay test; video admission, settlement, zero release and webhook flags false. | No live payment or monetization authorization. |
| Functional QA | Owner confirms Live Classes, teacher/student access, recording to LMS playback already completed. Owner confirms Razorpay TEST and reconciliation completed. | Retain owner-confirmed completion; retrieve prior detailed artifacts instead of repeating tests or inventing dates/coverage. |
| AI Examiner | Owner explicitly reports QA completed in V4. | Carry forward V4 evidence; assess only material V5 deltas before any narrowly justified check. |
| UI | Owner screenshots show QA Coaching admin/LMS pages load; learning view identifies SUPER ADMIN. | These screenshots alone do not prove separate role permissions or school-tenant UAT. Prior owner confirmation is recorded separately. |

## Remaining closure register

These are missing evidence/signoff items, not assertions that all underlying work is unperformed.
Suggested accountable roles are assignments to confirm, not claims of actual approval.

| Priority | Closure item | Suggested accountable role | Acceptance |
| --- | --- | --- | --- |
| 1 | Review completed credential rotation (#275) | Infrastructure owner + security reviewer | Operator authentication, R2 write/read/delete and running-process matches passed; owner confirms old LiveKit and R2 recording credentials revoked. Retain independent security review and assess any other historical exposure separately. No repeat rotation required. |
| 2 | Independent offsite recovery | Infrastructure owner + independent recovery reviewer | Retrieve an existing backup from offsite into an isolated recovery target, verify database/uploads checksums and restoration, record counts and elapsed RPO/RTO, prove recovery-key availability. No restore into V4/V5 live volumes; no volume deletion. |
| 3 | Reconcile functional/security evidence | QA + security + finance reviewers | Locate prior accepted classroom/provider/payment/tenant artifacts, map their actual scope and source to each gate. Request only uncovered or materially changed acceptance criteria. |
| 4 | Commercial and customer acceptance | Finance/legal accountable reviewers + external customer sponsor | Approved actual pricebook and commercial policies, contract/privacy/DPA/tax review, signed customer UAT and onboarding acceptance. Prior agreements must be retrieved, not recreated blindly. |
| 5 | Operational readiness | Operations owner | Resolve or explicitly disposition incident #240, confirm alerts/support/SLA/on-call, retention and recovery procedures, immutable rollback artifacts and customer communication responsibilities. |
| 6 | Production release | Owner | Review exact target/domain/tag, migration scope, maintenance window, rollback thresholds and nine authentic gate approvals; give separate explicit production GO. |

## Execution rules

- Do not repeat completed CI, deployment, migrations, classroom or payment QA merely because formal signoff arrays are empty.
- Do not mark gates VERIFIED from this AI-authored reconciliation or blanket owner completion statements.
- Attach genuine reviewer-approved gate records using the existing validator schema and exact candidate SHA.
- New source changes require proportionate validation and candidate reconciliation; documentation-only bookkeeping does not imply an application redeploy.
- No merge into main, production mutation, real payment activation or paid-video activation is authorized.
- Planning estimate remains 80% complete, 20% remaining; not a measured acceptance score.

## Next operational sequence

1. Review this reconciliation and gather existing acceptance artifacts using their original references.
2. Obtain independent review of the completed #275 rotation evidence below; do not repeat completed rotation.
3. Execute only the missing independent offsite restore on a preidentified isolated target.
4. Finish pricing/legal/customer/operations signoffs and prepare a concrete cutover/rollback packet.
5. Run the unchanged release validator against authentic evidence; request owner GO only when the packet is ready.

## Credential rotation update — 28 October 2026

Operator-supplied results in the launch session:

- Initial replacement LiveKit attempt returned HTTP 401; previous credentials were restored and verified PASS. The corrected replacement then authenticated successfully before installation. This failed attempt is resolved, not a current outage.
- Replacement LiveKit pair was authenticated with read-only ListRooms, saved to the existing protected API file and matched against the actual running Node process. API healthy. Owner confirmed old LiveKit key revoked; unrelated key left unchanged.
- Replacement R2 token restricted to schoolos-v5-staging-recordings, Object Read & Write. New credentials passed read authentication and a unique synthetic-object write/read/delete test before installation. Existing objects were not modified by that test.
- Existing protected file updated only for recording access key/secret; private rollback copy retained. Backup credentials were not changed.
- Final operator output: V5_API_RESTARTED=YES; V5_API_HEALTH=healthy; LIVEKIT_API_KEY_PROCESS_MATCH=PASS; LIVEKIT_API_SECRET_PROCESS_MATCH=PASS; LIVEKIT_RECORDING_S3_ACCESS_KEY_ID_PROCESS_MATCH=PASS; LIVEKIT_RECORDING_S3_SECRET_ACCESS_KEY_PROCESS_MATCH=PASS; OTHER_SERVICES_RESTARTED=NO; CREDENTIAL_VALUES_PRINTED=NO.
- Owner subsequently confirmed revocation of old SchoolOS-V5-Recording token (issued 24 October); replacement token retained. Revocation is owner-reported, not independently queried through provider APIs. No post-revocation provider call is claimed.
- Rotations are operationally completed on this evidence; formal security gate remains pending attributed review and any remaining tenant/privacy/load scope. Issue #275 is not automatically closed by this report.
- Runtime startup script also runs migrate deploy before importing the server on API restart; no explicit additional migration command was requested during rotation. Earlier recorded database count remains 114 applied/0 unresolved; no new post-rotation SQL count is claimed.

Next priority: independent recovery from the existing offsite V5 backup; do not create another backup merely to repeat the already-passed backup check. Identify the restore target and available resources before performing restore mutations.
