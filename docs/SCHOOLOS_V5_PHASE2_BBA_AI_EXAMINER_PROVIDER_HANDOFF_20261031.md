# SchoolOS V5 — BBA AI Examiner provider enablement & acceptance handoff (31 Oct 2026)

**Status: BLOCKED / NOT EXECUTED.** This is a credential-free configuration handoff for the separate Phase 1 security team and BBA acceptance owner. It is **not** permission to modify a running tenant, configure a paid provider, or mark AI grading PASS.

## Evidence already collected without provider execution

- BBA tenant `org_default` authenticated with SUPER_ADMIN, feature entitlement AVAILABLE.
- `GET /api/v1/ai-examiner/capabilities` returned `providerConfigured=false`, `evaluationExecutionAvailable=false`.
- Three BBA synthetic exam entries were visible; readiness endpoints readable for synthetic codes `BBA-UAT-EX-NDG-26`, `BBA-UAT-EX-RNE-26`, `BBA-UAT-EX-SHN-26`.
- **No AI answer-sheet evaluation, model output, review trace, checked-copy, marks approval or student result release has been witnessed for this BBA tenant.** The 0.45pp AI Examiner Phase 2 allocation remains entirely uncredited.
- Existing CI and policy contract tests must not substitute for live provider/teacher review UAT.

## Source-reviewed configuration contract (names only, no secret values)

As of the pinned V5 backend:
- Provider enablement needs **all three** runtime inputs `AI_EXAMINER_PROVIDER_URL`, `AI_EXAMINER_API_KEY`, `AI_EXAMINER_MODEL`.
- `apps/api/src/config.ts` applies `requireTogether` to this triplet. `apps/api/src/lib/ai-examiner-engine.ts` considers the provider configured only if each is nonempty.
- Provider mode is derived from URL path: `/responses` selects Responses mode, otherwise Chat Completions mode. Supported endpoint contract and model parameters must be verified with chosen provider before activation.
- Optional second-pass provider `AI_EXAMINER_SECOND_PASS_PROVIDER_URL`/`AI_EXAMINER_SECOND_PASS_API_KEY`/`AI_EXAMINER_SECOND_PASS_MODEL` and optional code runner have separate contracts; **do not enable by default**.
- Evaluations are queued by `POST /api/v1/ai-examiner/answer-sheets/:answerSheetId/evaluate` only after published question paper, activated rubric and submitted synthetic answer sheet. Without configured provider the route responds `503 AI_EXAMINER_PROVIDER_NOT_CONFIGURED` before queuing any work.
- Processing is asynchronous; `GET /api/v1/ai-examiner/evaluations/:evaluationId` supplies review state. Teacher/human approval and checked-copy finalization are separate from model-proposed marks.

## Security and deployment dependency — Issue #293 (P0)

The **current V5 API and Web image histories** were separately reported to contain sensitive database/Redis credentials. Do not inspect or move raw image history through this task. Any additional provider credential must **not** enter image build arguments, Docker history, labels or CI logs. Phase 1 must complete its incident containment, credential-scope and build provenance remediation before the board authorizes a new runtime provider setup. The deployment lock and source/image SHA are owned by authoritative Issue **#258**.

**Phase 2 MAY:** review source, develop credential-free fixture/test protocol, read already observed BBA status. **Phase 2 MAY NOT:** set or rotate provider/API/database/Redis secrets, edit Coolify build configuration, initiate staging deploy, alter V4 production, start a paid provider request while disabled.

## Gated acceptance protocol after security clearance

1. **Owner/Phase 1 confirmation:** Issue #293 remediation and image provenance reviewed; Issue #258 logs written approval for a specific target V5 staging revision, provider, limited usage budget, safe rollback and named responsible reviewer. Provider data-processing/retention terms must allow the synthetic test.
2. **Credential-safe read-only verification:** BBA SUPER_ADMIN logs into the correct staging tenant, confirms `GET /ai-examiner/capabilities` reports `providerConfigured=true`, `evaluationExecutionAvailable=true`; never print URL if it has embedded credentials and never print tokens.
3. **Synthetic only:** choose a BBA synthetic exam, use test-generated question paper, valid rubric whose maximum equals exam maximum, active rubric and a submitted synthetic answer sheet. Never upload identifiable children's answers.
4. **Single bounded evaluation:** only one `POST /answer-sheets/:answerSheetId/evaluate` and record 202 QUEUED; poll bounded times for provider processing. Ensure queued evaluation IDs and status transitions are attributed to exact tenant/role. Do not duplicate a queue on timeout without reading existing state.
5. **Review safety:** authorized BBA teacher opens question-level AI recommendations and artifacts; verify rubric alignment, review-needed threshold, invalid answer/prompt-injection protections, failure/retry and manual edit separation. The final marks must originate from a recorded **human approval**, not auto-release.
6. **Checked copy and student release:** once human approves, verify a final checked-copy/revision and the authorized student-facing result. Reject cross-branch/other-tenant sheet or evaluation access, unauthorized approval, duplicate queue, duplicate approval and version drift.
7. **Evidence:** sanitized output records actual timestamp (UTC), owner/witness, tenant, deployed SHA, synthetic exam/sheet/evaluation IDs (do not publish child PII), provider mode/model label, queue/result latency, trace, reviewed marks, any exceptions, and protected original artifact locator/checksum. Signed institutional UAT remains a distinct human action.
8. **Decision:** only credit any of the 0.45pp AI Examiner budget for the exact witnessed acceptance slices, and leave formal release Gate 7 PENDING until authorized human signoff. If provider remains disabled, record an explicit product-scope exception and a separate owner-approved adjustment to the launch policy; do not silently treat blocked execution as PASS.

**Current tracking:** Phase 2 3.70/5.00pp (74%) technically evidenced, 1.30pp remains (26%); AI Examiner remains 0/0.45pp. Last Phase 1 planning credit is 2.0pp but P0 #293 may alter risk-adjusted readiness. 0/10 formal gates verified; commercial GO HOLD.
