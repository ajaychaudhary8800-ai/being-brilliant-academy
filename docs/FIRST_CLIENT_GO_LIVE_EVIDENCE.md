# Step 11 — First Real Paying Client Evidence Record

**Product:** Being Brilliant ERP + LMS + CRM  
**Purpose:** controlled evidence checklist for the first real external paying institution.  
**Status rule:** this record must not be completed using QA, demo, synthetic or internal tenants.

This checklist converts the existing SaaS Sales, billing, organization provisioning, onboarding, implementation/UAT and legal controls into one auditable first-client go-live record.

## 1. Client identity

Record only after a real institution has commercially committed.

- Institution legal/display name:
- SaaS Sales lead ID:
- Won organization ID:
- Tenant slug:
- Selected plan:
- Billing cycle:
- Target go-live date:
- Authorized client sign-off contact:
- Internal implementation owner:

The SaaS Sales lead must be marked **WON** and linked through `wonOrganizationId` to the actual customer organization.

## 2. Legal and commercial acceptance

Before treating the customer as commercially accepted, record:

- Indian counsel-approved controlled legal pack version/date:
- Signed/accepted Order Form reference:
- SaaS Agreement reference:
- Implementation SOW reference:
- DPA reference where personal data is processed:
- SLA/support terms reference:
- Any negotiated deviations/approvals:
- Commercial acceptance date:

Do not place bank credentials, payment secrets or private personal contact data in this repository. Store returned signed PDFs and other approved client evidence in the Platform Super Admin **Commercial Document Vault** (`/admin/commercial-documents`); record only non-sensitive references in this repository.

## 3. Paying-client evidence

At least one real payment/activation condition must be evidenced.

Record:

- Invoice number:
- Invoice status:
- Payment provider/reference:
- Payment status:
- Amount/currency:
- Captured/paid date:
- Activation condition used where payment was not required before provisioning:
- Finance verification owner/date:

A trial, internal test payment, sandbox payment, waived synthetic invoice or QA tenant does not satisfy the **paying client** gate.

## 4. Platform provisioning evidence

Verify in the platform:

- [ ] Customer organization is active.
- [ ] SaaS Sales lead is **WON** and linked to this organization.
- [ ] Subscription status is valid for production access.
- [ ] Organization subscription and SaaS subscription ledger are aligned.
- [ ] Assigned plan matches the commercial Order Form.
- [ ] Tenant administrator completed secure account setup.
- [ ] At least one active branch/campus exists.
- [ ] Shared tenant access works.
- [ ] Custom domain, if contracted, is configured and TLS-valid.

Record:

- Organization ID:
- Subscription ID:
- Plan code:
- Subscription status:
- Shared access URL:
- Custom URL, if applicable:

## 5. Data migration and configuration

Record the actual production-client scope.

- [ ] Required masters are configured.
- [ ] Required users/roles are configured.
- [ ] Initial data migration is **COMPLETE** or formally **NOT REQUIRED**.
- [ ] Opening balances / fee data are verified where applicable.
- [ ] Branding and institution terminology are approved.
- [ ] Client-specific integrations in signed scope are verified.

Migration source/system:
- Migration batch/reference:
- Validation owner/date:
- Exceptions accepted by client:

## 6. Training and UAT

- [ ] Client training is **COMPLETE** or formally **NOT REQUIRED**.
- [ ] UAT scope covers contracted critical workflows.
- [ ] Client has tested representative administrator workflow.
- [ ] Client has tested representative teacher/staff workflow where applicable.
- [ ] Client has tested representative student/parent workflow where applicable.
- [ ] Billing/fees workflow tested where contracted.
- [ ] LMS/exam workflow tested where contracted.
- [ ] Client UAT acceptance is recorded.

Record:

- UAT start/date:
- UAT completion/date:
- UAT evidence/reference:
- Open accepted defects/workarounds:
- Client UAT approver:

## 7. Go-live and handover

The organization onboarding panel must report **READY / 100%** before final handover.

- [ ] Data migration ready.
- [ ] Training ready.
- [ ] Subscription valid/aligned.
- [ ] Tenant administrator activated.
- [ ] Branch/campus requirement met.
- [ ] Go-live approved.
- [ ] Final handover/acceptance certificate completed.
- [ ] Support contacts and escalation process provided to client.
- [ ] Privacy/Terms/AUP public links are live and counsel-approved.
- [ ] Production monitoring is green.
- [ ] Latest backup/DR evidence remains valid.
- [ ] No unresolved P1/P2 issue blocks go-live.

Record:

- Go-live approval date:
- Production go-live timestamp:
- Handover/acceptance reference:
- Client approver:
- Internal approver:

## 8. Post-go-live smoke validation

Immediately after go-live verify:

- [ ] Production login.
- [ ] Tenant isolation / correct workspace.
- [ ] One representative protected workflow.
- [ ] One representative client-admin workflow.
- [ ] Critical contracted module availability.
- [ ] Billing/subscription access.
- [ ] API readiness/operational health.
- [ ] Monitoring remains green.
- [ ] No material client-impacting error is open.

Record:

- Smoke-test timestamp:
- Tested by:
- Result: PASS / FAIL
- Incident/reference if failed:

## 9. Step 11 completion decision

Step 11 may be changed from **PENDING_CLIENT** to **COMPLETE** only when all of the following are true:

1. the institution is a real external customer;
2. commercial acceptance is evidenced;
3. the required payment/activation condition is evidenced;
4. the SaaS Sales lead is WON and linked to the customer organization;
5. onboarding reports READY / 100%;
6. UAT/client acceptance is evidenced;
7. production go-live and smoke validation are successful; and
8. there is no unresolved launch-blocking legal, security or operational condition.

**Final Step 11 decision:** COMPLETE / NOT COMPLETE  
**Decision date:**  
**Approved by:**  
**Evidence reviewed:**  

Do not mark the first-paying-client launch gate READY from synthetic records or operator assumption.
