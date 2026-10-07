# Being Brilliant Academy — Production Reference Tenant

**Product:** Being Brilliant ERP + LMS + CRM  
**Institution:** Being Brilliant Academy  
**Institution type:** Coaching institute / academy  
**Rollout role:** First production coaching reference implementation  
**Current status:** PREPARATION  
**Commercial-launch rule:** This internal/reference tenant does **not** satisfy the Step 11 first real external paying client gate.

## Purpose

Being Brilliant Academy is the anchor implementation used to validate the production operating model for a coaching institution. It should run the same tenant isolation, SaaS subscription, onboarding, security, billing, payment, LMS, examination and portal controls used for external customers.

## Production readiness track

Complete the following in the production tenant before declaring the BBA reference implementation operational:

- [ ] Confirm the production organization record and workspace slug.
- [ ] Confirm subscription/entitlement alignment.
- [ ] Confirm tenant Super Admin secure account setup.
- [ ] Create and validate required branches/campuses.
- [ ] Configure academic sessions, courses/programs, batches, subjects and classrooms.
- [ ] Configure required teachers/staff and role access.
- [ ] Import or verify representative student records.
- [ ] Configure fees and finance workflows.
- [ ] Configure institution Razorpay gateway where online fee collection is required.
- [ ] Validate student/parent online payment, verified webhook capture and receipt generation.
- [ ] Validate LMS content/material access.
- [ ] Validate homework and examination workflows.
- [ ] Validate teacher, student, parent and administrator portals.
- [ ] Validate notices/communication and reports required for daily operations.
- [ ] Record migration status as COMPLETE or NOT REQUIRED.
- [ ] Record training status as COMPLETE or NOT REQUIRED.
- [ ] Complete representative UAT.
- [ ] Record go-live approval.
- [ ] Reach onboarding READY / 100%.
- [ ] Complete production smoke validation.

## Evidence record

Do not put passwords, payment secrets, private contact details, student personal data or bank credentials in this repository.

Record only non-secret operational references:

- Production organization ID:
- Workspace slug:
- Plan:
- Subscription status:
- Branch/campus count:
- Migration status:
- Training status:
- UAT completion date:
- Go-live approval date:
- Production smoke result:
- Internal implementation owner:

## Completion rule

This record may be marked **OPERATIONAL** only after onboarding reports READY / 100%, representative production workflows pass, and there is no unresolved P1/P2 blocker.

BBA remains a reference implementation and must not be used as evidence for the external-paying-client launch gate.
