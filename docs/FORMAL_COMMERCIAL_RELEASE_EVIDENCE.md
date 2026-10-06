# Step 12 — Formal Commercial Release Evidence

**Product:** Being Brilliant ERP + LMS + CRM  
**Purpose:** controlled record for the formal commercial production release after Step 11 and the final GO decision.  
**Precondition:** do not complete this record while any blocking launch gate is not READY.

## 1. Release identity

- Release version/tag:
- Exact release commit SHA:
- Previous known-good release/tag:
- Rollback reference:
- Release owner:
- Release date/time:
- Production environment:

The release tag must point to the exact commit that passed protected CI and the final launch gate.

## 2. Final GO evidence

Before creating the formal release:

- [ ] Step 11 first real paying client evidence is COMPLETE.
- [ ] `pnpm launch:require-go` passes.
- [ ] Protected CI is green on the exact release commit.
- [ ] No open P1/P2 incident blocks release.
- [ ] Legal execution gate is READY.
- [ ] Public Privacy/Terms/AUP gate is READY.
- [ ] Off-site DR gate is READY.
- [ ] Production monitoring is green.
- [ ] Latest backup is healthy/current.
- [ ] Management has authorized the formal release.

Record:
- Launch-gate run/reference:
- CI run:
- Management authorization reference:
- Open accepted non-blocking risks:

## 3. Deployment evidence

- Deployment platform/path:
- Deployment revision/commit:
- Deployment started:
- Deployment completed:
- Database migration result:
- API container result:
- Web container result:
- Backup container result:
- Reverse proxy/TLS result:

Do not mark deployment successful merely because it was queued or started.

## 4. Production smoke validation

Immediately after deployment verify:

- [ ] Production homepage.
- [ ] `/api/health/ready`.
- [ ] `/api/health/operational`.
- [ ] Login.
- [ ] One representative protected workflow.
- [ ] SaaS Sales/public demo intake.
- [ ] Billing/subscription surface.
- [ ] Public Privacy, Terms and Acceptable Use pages.
- [ ] Footer/demo-form legal links.
- [ ] External monitor green/recovered.
- [ ] Backup service healthy.

Record:
- Smoke-test timestamp:
- Tested by:
- Result: PASS / FAIL
- Incident/reference if failed:

## 5. Release notes

Record a concise customer-facing summary:

- release scope:
- material capabilities:
- known limitations:
- operational notes:
- migration notes:
- support/escalation notes:

Do not claim certifications, RPO/RTO commitments, client references or unsupported capabilities.

## 6. First 24-hour follow-up

- [ ] External monitoring reviewed.
- [ ] Error logs/request IDs reviewed.
- [ ] Nightly staging QA reviewed.
- [ ] Backup completion reviewed.
- [ ] First-client critical workflows checked.
- [ ] Support reports reviewed.
- [ ] Material defects have owners.

## 7. Final Step 12 decision

Step 12 may be changed from **BLOCKED_DEPENDENCY** to **COMPLETE** only when:

1. Step 11 is COMPLETE;
2. the final launch gate is GO;
3. protected CI is green;
4. management explicitly authorizes the release;
5. the exact tagged commit is deployed through the controlled production path;
6. production smoke validation passes; and
7. rollback evidence is recorded.

**Final Step 12 decision:** COMPLETE / NOT COMPLETE  
**Decision date:**  
**Approved by:**  
**Release/tag:**  
**Exact commit:**  
**Evidence reviewed:**  
