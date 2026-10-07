# Green Shine World School — First External Client Go-Live Track

**Product:** Being Brilliant ERP + LMS + CRM  
**Institution:** Green Shine World School  
**Institution type:** School  
**Rollout role:** Designated first external school client candidate for Step 11  
**Current status:** COMMERCIAL_ACCEPTANCE_PENDING  
**Proposal status:** HARD-COPY SUBMITTED — AWAITING ACCEPTANCE  
**Gate status:** NOT COMPLETE

This record is a client-specific execution companion to [FIRST_CLIENT_GO_LIVE_EVIDENCE.md](./FIRST_CLIENT_GO_LIVE_EVIDENCE.md). It does not mark any commercial, payment, UAT or go-live step complete by assumption.

## Proposal delivery record

Management confirmed on 8 October 2026 that proposal `GSWS-PRO-2026-001` was physically submitted as a hard copy at the Green Shine World School office. This records proposal delivery only. It is **not** evidence of commercial acceptance, signature, payment, subscription activation, WON status, UAT acceptance or go-live approval.

- Delivery method: Hard copy submitted at school office
- Proposal reference: `GSWS-PRO-2026-001`
- Proposed plan: PROFESSIONAL
- Proposed billing cycle: ANNUAL
- Proposed subscription amount: ₹149,990 before applicable GST
- Current commercial state: Awaiting client acceptance

## 1. Commercial qualification

Before provisioning as the Step 11 client:

- [ ] Create a real SaaS Sales lead for Green Shine World School.
- [ ] Confirm the contracting/legal entity and authorized sign-off representative.
- [ ] Confirm selected SaaS plan and billing cycle.
- [ ] Complete/accept the Order Form.
- [ ] Complete the applicable SaaS Agreement.
- [ ] Complete the implementation SOW.
- [ ] Complete DPA/SLA/support terms as applicable.
- [ ] Mark the SaaS Sales lead **WON** only after real commercial acceptance.

Record:

- SaaS Sales lead ID:
- Contracting entity:
- Selected plan:
- Billing cycle:
- Commercial acceptance date:
- Order Form reference:
- SaaS Agreement reference:
- SOW reference:

## 2. Real payment or activation evidence

At least one genuine commercial payment/activation condition must be evidenced. Test-mode Razorpay transactions, QA payments, synthetic invoices and waived demo invoices do not count.

- [ ] Real invoice issued or approved commercial activation condition recorded.
- [ ] Payment/activation evidence verified by finance.
- [ ] Payment status is captured/paid where payment is required before activation.

Record:

- Invoice number:
- Amount/currency:
- Payment provider/reference:
- Payment status:
- Paid/captured date:
- Finance verification date:

## 3. Production tenant provisioning

- [ ] Create the Green Shine World School production organization.
- [ ] Link the WON SaaS Sales lead through `wonOrganizationId`.
- [ ] Confirm subscription status and plan alignment.
- [ ] Tenant Super Admin completes secure account setup.
- [ ] Create at least one active branch/campus.
- [ ] Confirm shared workspace login.
- [ ] Configure branding and institution terminology.
- [ ] Configure custom domain/TLS only if contracted.

Record:

- Organization ID:
- Workspace slug:
- Subscription ID:
- Plan code:
- Shared access URL:
- Custom URL, if applicable:

## 4. School implementation scope

Configure and validate the contracted school workflows:

- [ ] Academic session and branch/campus structure.
- [ ] Classes/courses, sections/batches, subjects and classrooms.
- [ ] Staff/teacher users and role access.
- [ ] Student/parent records and access.
- [ ] Attendance.
- [ ] Homework/LMS.
- [ ] Examination/results workflow.
- [ ] Fees, receipts and defaulter workflow where contracted.
- [ ] Online fee gateway where contracted.
- [ ] Communication/notices.
- [ ] HR/payroll/finance only where included in the signed scope.
- [ ] Reports/analytics required for UAT.

## 5. Migration, training and UAT

- [ ] Initial data migration is COMPLETE or formally NOT REQUIRED.
- [ ] Client training is COMPLETE or formally NOT REQUIRED.
- [ ] Administrator workflow UAT passes.
- [ ] Teacher/staff workflow UAT passes where applicable.
- [ ] Student/parent workflow UAT passes where applicable.
- [ ] Fees/billing UAT passes where applicable.
- [ ] LMS/examination UAT passes where applicable.
- [ ] Client UAT acceptance is recorded.

Record:

- Migration status:
- Training completion date:
- UAT start date:
- UAT completion date:
- Client UAT approver:
- Accepted deferred items:

## 6. Go-live and Step 11 closure

Before this client can close the launch gate:

- [ ] Onboarding reports **READY / 100%**.
- [ ] Client go-live approval is recorded.
- [ ] Handover/acceptance is complete.
- [ ] Public legal links remain available.
- [ ] Monitoring/backup controls are green.
- [ ] No unresolved P1/P2 issue blocks launch.
- [ ] Production smoke validation passes.

Record:

- Go-live approval date:
- Production go-live timestamp:
- Handover/acceptance reference:
- Smoke-test timestamp:
- Smoke result:
- Client approver:
- Internal approver:

## Completion rule

Only after every mandatory condition in [FIRST_CLIENT_GO_LIVE_EVIDENCE.md](./FIRST_CLIENT_GO_LIVE_EVIDENCE.md) is evidenced may Green Shine World School be used to change Step 11 from PENDING_DEPENDENCY to COMPLETE and the first-paying-client gate to READY.
