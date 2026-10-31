# SchoolOS V5 — Phase 2 BBA ERP/LMS & AI Acceptance (30 October 2026)

**Owner-defined scope:** BBA three-branch UAT; academic, admissions, teacher allocation, timetable, attendance, examinations, teacher/student LMS, branch-admin authorization, LiveKit and AI Examiner. **Excluded:** Phase 1 security, secrets, Docker/Coolify/volumes, deployment and production changes.

**Source of status:** sanitized outputs supplied by the BBA authorized operator following authenticated, synthetic-data V5 staging tests. These are observed functional results, **not formal signed institutional acceptance or an independent audit**.

## Coordination and environment

- Issue #258 is the authoritative release board. Formal production release remains **HOLD**, **0/10 formally verified release gates**.
- Last operator-observed V5 staging API/Web revision: `b54dca5ae36a948f83012faa4a37354198fba083`.
- Genuine BBA tenant: `org_default`, slug `being-brilliant-academy`, coaching mode `BATCH`.
- UAT uses three **synthetic** BBA-tenant branches: `BBA-UAT-NDG`, `BBA-UAT-RNE`, `BBA-UAT-SHN`. These are *not* verified actual operational branch master records; zero manager accounts were created.
- Phase 2 development branch: `feature/v5-phase2-bba-acceptance-20261030`; **no merge, V5 staging deployment, Phase 1 infrastructure write, paid collection, paid-video activation or V4 production change** without separate coordinated approval.
- Any later V5 staging deployment must be coordinated via Issue #258 after Phase 1 infrastructure operations are clear.

## Evidence-indexed task allocation (provisional 5.00 percentage points of the original 20-point planning backlog)

| Task | Budget (pp) | Evidence observed | Credited (pp) | Remaining (pp) |
|---|---:|---|---:|---:|
| BBA tenant and 3 synthetic branch setup | 0.35 | BBA auth; three branches created/read back; zero BRANCH_ADMIN accounts | 0.35 | 0 |
| Academic/session, courses, batches, 5 synthetic admissions | 0.60 | Session 2026-27; 3 courses, mixed grades 5/6/7 and 3 batches, 5 enrollments; duplicates / invalid grade / branch mismatch rejected | 0.60 | 0 |
| Teacher and cross-branch allocations | 0.55 | Synthetic teacher, mapped active subject/course, 3 branches eligible/allocated; overlap 409 and admin access restriction | 0.55 | 0 |
| Timetable + attendance | 0.65 | Three class schedules; double-booking 409; five attendance records, duplicate 409, cross-branch 422, monthly report | 0.65 | 0 |
| Examinations and report cards | 0.65 | Three exams, statuses, negative validations; five generated/published synthetic results and report-card PDFs | 0.65 | 0 |
| Teacher homework and student LMS workflow | 0.40 | Corrected V2 operator run PASS: existing published NDG homework, teacher/2 student logins, own-student submission and readback, evaluation 8/10, cross-branch 422, impersonation 403, spoof 422, duplicate evaluate/re-submit 409 | 0.40 | 0 |
| Branch-admin authorization and branch isolation | 0.40 | Deferred manager provisioning left no BRANCH_ADMIN; UAT not executed | 0 | 0.40 |
| BBA LiveKit classroom and recording playback | 0.50 | Native LMS roles/attendance PASS (0.20pp); WebSocket PASS (0.05pp); publisher RTP PASS (0.05pp); two-peer same-browser teacher→student SFU receive PASS (0.05pp); **BBA synthetic Egress start/stop→R2 MP4→authenticated student LMS stream/HTML5 decode PASS**, 741108 bytes, 1280×720 (0.15pp). Independent device remains outside observed scope. | 0.50 | 0 |
| BBA AI Examiner workflow and evidence | 0.45 | BBA entitlement and 3 existing synthetic exam/readiness GETs PASS; **AI_PROVIDER_CONFIGURED=NO / AI_EVALUATION_EXECUTION_AVAILABLE=NO**. No live evaluation; source/readiness only. | 0 | 0.45 |
| Dated human institutional review, exception list, related-party waiver and signoff | 0.45 | Owner approval intent reported; original reviewed/signed evidence not recorded | 0 | 0.45 |
| **Phase 2 total** | **5.00** | **Operator-observed technical coverage only** | **3.70** | **1.30** |

**Provisional Phase 2 completion: 74%; Phase 2 remaining: 26%.** Original 20-point planning backlog after only Phase 2 credits: `20.00 - 3.70 = 16.30` points. Last documented Phase 1 credit (2.00 points) gives a **provisionally reconciled combined backlog of 14.30 points** (`20 - 3.70 - 2.00`), subject to Phase 1's newer P0 #293 security incident and re-estimation. Formal gates: **0/10 VERIFIED**.

## Observed functional details and follow-ups

### Passed, reuse without retesting

1. Branch creation on real BBA tenant with deferred manager provisioning; synthetic addresses/emails.
2. Five synthetic students; grade eligibility, unique admission number, and authorized branch/batch tuple.
3. Teacher eligibility across three coaching branches with confirmed subject links and active allocations; overlapping allocations rejected HTTP 409.
4. Three timetable schedules; teacher cross-branch time conflict rejected HTTP 409; attendance five records and readback, cross-branch rejection and monthly report.
5. Three exams, invalid marks and branch/exam conflicts rejected; five synthetic report-card PDFs.
6. Teacher/student homework LMS (corrected V2 script): owner-executed BBA test with NDG published homework, synthetic NDG student submit and teacher readback/evaluation 8/10 PASS, student ID spoof blocked HTTP 422, cross-branch RNE submission rejected HTTP 422 due academic-history context mismatch, max marks exceeded HTTP 422, duplicate evaluation HTTP 409 and post-evaluation resubmission HTTP 409. Result `BBA_HOMEWORK_LMS_UAT=OBSERVED_REQUIRES_HUMAN_REVIEW`. The initial script's invalid local due date format and wrong expected cross-branch HTTP status were corrected in UAT input/expectation only, no application or infrastructure change.

**Known functional defect:** On 30 October, the `POST /admin/timetables/weekly/preview` preflight originally omitted the effective allocation check used by `POST /admin/timetables`. An upcoming allocation start date caused the single save to fail with HTTP 422 `TEACHER_SUBJECT_NOT_ALLOCATED` while preview showed no conflict. The operator changed **only synthetic** allocation effective dates to 2026-10-30 and confirmed the BBA single-slot save and all three timetable+attendance scenarios PASS. This *did not* fix the preview/save parity in code. Draft PR #290 on the isolated Phase 2 branch adds the existing effective-allocation guard to shared weekly preview/save and a static contract regression. Exact-head GitHub CI was observed SUCCESS at commit `dd44785f34470e6dc6f4072d292d68491738a7de`; V4 rehearsal/sandbox/external QA were SKIPPED for the PR branch and must not be described as PASS. Coordinated staging proof still required; **do not deploy during Phase 1**.

### BBA read-only LiveKit and AI preflight (operator observed 30 October 2026)

Validated deployed V5 API/Web image revision `b54dca5...` and real BBA admin `org_default`. Three synthetic BBA branches visible; `meetings/options` included all three, participants readable, `GET /meetings` returned zero records. **Meetings are staff-only**; zero Meetings does not establish absence of LMS native LiveClass records. `GET /ai-examiner/capabilities` available, provider **NOT configured** and evaluation execution **NOT available**. Three prior published synthetic BBA exams appear in AI Examiner read-only list and all three readiness GET endpoints returned objects. No video, provider egress, AI grading, production or deployment action occurred. This is discovery evidence, not LiveKit/AI final acceptance.

The subsequent native classroom UAT was **owner-executed successfully** using `schoolos_v5_bba_native_live_class_uat_20261030.py --create` on the pinned V5 staging BBA tenant. Three synthetic LiveClasses created with PUBLISHED status (NDG/RNE/SHN), readback 3; synthetic teacher login PASS and tokens for three classrooms PASS, two synthetic students authenticated/token PASS, each own-branch student joined and left with attendance recorded; RNE student denied access to NDG room HTTP 404; student denied teacher moderation HTTP 403. **No actual LiveKit signaling WebSocket, audio/video, Egress, recording playback or AI inference** was exercised. Allocate **0.20pp of 0.50pp LiveKit task** to API/identity/attendance acceptance, and an additional **0.05pp** to the observed BBA signaling handshake, plus **0.05pp** for measured synthetic publisher RTP; preserve **0.05pp for subscribed peer inbound RTP/decoded frames** and **0.15pp for recording/R2/LMS playback evidence**. Human witness remains pending. `BBA_NATIVE_LMS_CLASSROOM_API_UAT=OBSERVED_REQUIRES_HUMAN_REVIEW`.

**AI dependency:** Because the actual BBA staging capability reports `AI_PROVIDER_CONFIGURED=NO`, do not run evaluations or claim AI Examiner functional PASS. Provider enablement would need a separately coordinated, secured configuration review in Issue #258 after Phase 1 safety ownership; no credential changes by Phase 2.

### BBA LiveKit provider signaling observation — 30 October 2026

The owner reported two attempts to launch `schoolos_v5_bba_livekit_signaling_uat_20261030.py` from `/root`: the first returned **file not found** (script had not been uploaded); the second successfully executed with expected deployed API/Web revision, BBA SUPER_ADMIN login, existing BBA native-class fixture, a native API token-scoping assertion and `LIVEKIT_SIGNALING_WS=PASS_FRAME_RECEIVED`. The probe did not create a room, rotate a credential, start a camera or microphone, publish media, start recording or change infrastructure. `BUSINESS_DATA_WRITES=NO` and `PRODUCTION_CHANGED=NO` were reported. This supports signaling-only protocol reachability under a BBA room-scoped token—not actual RTP media, quality under load, media egress, LMS playback, or signed institution review. Credit 0.05pp of the LiveKit allowance for this distinct positive result; do not repeat the passed WebSocket check.

### Phase 2 host media-client inventory (owner observed 30 October 2026)

On V5 staging VPS `srv1880999`, the owner executed a read-only Python inventory: `livekit`, `aiortc`, `playwright`, `selenium`, `chromium`, `chromium-browser`, `google-chrome`, `firefox`, and `ffmpeg` **all NOT_INSTALLED**. The run explicitly reported `CHECK_TYPE=READ_ONLY`, `PACKAGES_INSTALLED=NO`, `STAGING_CHANGED=NO`. This shows only absence in the probed VPS Python/PATH environment, **not** lack of provider media functionality.

Do not install media dependencies on the shared V5 server or alter Phase 1 resources. The one-shot loopback SSH-tunneled synthetic browser RTP **send-only** harness was **operator-executed successfully**. Output: `LIVEKIT_BROWSER_ROOM_CONNECT=PASS`, `SYNTHETIC_VIDEO_TRACK_PUBLISH=PASS`, `SYNTHETIC_AUDIO_TRACK_PUBLISH=PASS`, `VIDEO_RTP_BYTES_SENT_IN_WINDOW=29167`, `AUDIO_RTP_BYTES_SENT_IN_WINDOW=114013`, `LIVEKIT_SYNTHETIC_OUTBOUND_RTP=PASS`, `LIVEKIT_TEST_CLEANUP=PASS`, `LIVEKIT_CAMERA_MICROPHONE_USED=NO`, `PRODUCTION_CHANGED=NO`. This supports **publisher RTP only**, not proof of peer receipt or recording. Credit exactly **0.05pp**. Remaining LiveKit 0.15pp concerns Egress/R2/LMS playback. The two-participant BBA teacher-publisher/NDG student-subscriber browser test was **owner-executed successfully**, with separate LiveKit participant identities in a single browser. Student subscriber received 14105 video / 109398 audio RTP bytes, 121 / 442 packets and 119 decoded video frames. Both video/audio SFU receiver cases PASS; cleanup PASS. **Independent physical device** and **recording/playback** remain NOT_TESTED. It rotates passwords only for two previously established synthetic Phase 2 accounts (not real-user/provider/Phase 1 credentials). One-time loopback URL and tokens must remain private.

### BBA synthetic media outbound RTP — 30 October 2026

Owner-reported successful Windows browser test via a one-time local SSH token page: WebRTC room connect PASS; synthetic video and audio track publish PASS; **29167 video RTP bytes** and **114013 audio RTP bytes** sent in measured window; overall outbound PASS; cleanup PASS; no camera or microphone, provider Egress, recording, production or Phase 1 infrastructure change. Receiving peer RTP/decoded frames **NOT** tested; recording/R2/LMS **NOT** tested. Only 0.05pp of LiveKit allocation credited.

### Teacher-to-student SFU receive witness — 30 October 2026

Owner-executed Windows browser dual-peer test on previously created BBA NDG native classroom: synthetic teacher audio/video publication PASS; distinct student participant subscribed to both tracks; incoming student RTP during measurement: **video 14105 bytes / 121 packets / 119 decoded frames**, **audio 109398 bytes / 442 packets**; `BBA_SYNTHETIC_TEACHER_TO_STUDENT_VIDEO_RTP=PASS`, `BBA_SYNTHETIC_TEACHER_TO_STUDENT_AUDIO_RTP=PASS`, `LIVEKIT_TWO_PEER_SFU_MEDIA=PASS_SAME_BROWSER`, cleanup PASS. Camera/microphone not used; recording not created; production unchanged. This validates teacher→student SFU media within a single browser only, **not independent remote-device reception or recording/playback**. Credit 0.05pp; LiveKit remaining 0.15pp.

### BBA synthetic Egress → R2 → LMS recording/playback witness — 31 October 2026

Operator-pasted sanitized test output: `TEST_READY=YES`, BBA room connect PASS, synthetic video/audio publish PASS, **LiveKit Egress start and stop PASS**, authenticated BBA student LMS R2 MP4 stream PASS; **MP4 741,108 bytes**, browser HTML5 MP4 decode PASS, **1280×720** video dimensions; synthetic cleanup PASS. No physical camera/microphone used, AI provider configuration unchanged, production unchanged, commercial GO HOLD. The explicit marker `BBA_LIVEKIT_R2_LMS_RECORDING_UAT=PASS_SYNTHETIC` supports **0.15pp** of previously reserved LiveKit recording/R2/LMS playback credit. It does not prove independent-device media, cross-tenant recording access-denial, human UAT signature or formal release readiness.

**Related security dependency:** Issue **#293** records sensitive credentials embedded in a V5 Web image build history discovered by Phase 1. Do not deploy/rebuild/rotate credentials through Phase 2. The technical test result does not supersede the P0 security blocker.

### Outstanding scenarios and acceptance criteria

- **Homework/LMS:** **COMPLETED technical UAT**, using existing BBA synthetic teacher and students. Full successful corrected V2 run recorded by owner, with the results above. Final human acceptance and signed institutional record still pending. Do not rerun these passing tests.
- **Branch Admin:** No user accounts were created by deferred manager mode. Test must use supported account setup/provisioning and a verifiably controlled test inbox; do **not** reclassify real students/teachers, insert SQL identities, forge credentials, or assume another user's login.
- **LiveKit:** BBA synthetic three-branch Native LiveClass API, WebSocket signaling, outbound video/audio RTP, two-peer same-browser SFU video/audio reception, Egress start/stop, R2 MP4 delivery and authenticated student LMS HTML5 decode are all **operator-observed PASS**. Do not repeat provider tests. Independent physical-device media and cross-tenant MP4 denial were not witnessed by this specific run; reconcile applicability as institutional exceptions. Keep paid-video flags OFF. No real children's media.
- **AI Examiner:** Use a synthetic BBA-tenant exam; verify feature entitlement, answer-sheet input and grading/review traceability, role segregation and student-facing result release. Distinguish AI assistive outputs from human-validated marks. Keep identifiable children and real high-stakes grading out of UAT.
- **Human signoff:** Authorized BBA sponsor to review all observed runs, add exact date and source/tenant, defect disposition, related-party conflict waiver and protected original evidence locator/hash. Do not invent signatures; Gate 7 cannot be formally closed by an automated script.

## Phase 2 stop and go conditions

- No V4 production changes, shared staging deployment or Phase 1 security/infrastructure operations.
- Do not close a formal gate without its independent/or human-accountable source evidence and applicable documented signoff.
- A code PR may be reviewed/CI-tested on an isolated feature branch but **must not be merged/deployed** while concurrent Phase 1 is modifying infrastructure.
- Do not re-execute passing academic, admissions, timetable, attendance or examination tests simply to inflate coverage.
