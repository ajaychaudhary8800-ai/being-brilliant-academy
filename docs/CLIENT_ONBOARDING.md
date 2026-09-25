# Real Client Onboarding

This runbook is for onboarding a paying school, coaching institute, academy, training centre, or other education organization onto the Being Brilliant SaaS platform. Use [COMMERCIAL_PACKAGING_PRICING.md](./COMMERCIAL_PACKAGING_PRICING.md) as the authoritative standard plan, pricing, capacity and feature matrix before provisioning.

## Client information to collect before provisioning

Collect these items before creating the organization:

- Organization display name and legal name.
- Organization email and phone.
- Primary client administrator name and email.
- Institution type and preferred academic group terminology: Section, Batch, Group, or custom label.
- Timezone, locale, currency, and academic-year start month.
- Selected SaaS plan and commercial status.
- Trial end date or subscription end date when applicable.
- Logo and preferred primary/secondary brand colours.
- Whether the client wants a custom domain.
- Target go-live date.
- Initial data-import requirement, source system, and scope: students, staff, fees, courses/classes, subjects, historical balances, and other required masters.
- Training contact details and users who require handover/training.
- Authorized sign-off contact.
- Branch/campus setup details using `/client-kit/branches-data-collection.csv`.

Never request or store the tenant administrator's password. The platform sends a secure setup link.

## Provisioning sequence

1. Platform Super Admin opens **Admin -> Organizations -> New Organization**.
2. Enter organization identity, tenant slug, administrator email, plan, terminology, timezone, branding, and optional domain.
3. Create the organization.
4. The platform atomically creates the organization, Super Admin user, and SaaS subscription.
5. The administrator receives a one-time password-setup link.
6. Upload the organization logo if supplied.
7. Open **Onboarding** for the organization and monitor the readiness checklist.
8. Create at least one branch/campus for the client.
9. Complete or mark **Not required** for initial data migration.
10. Complete or mark **Not required** for client training.
11. Verify subscription/billing alignment in **SaaS Billing**.
12. If a custom domain is purchased, configure client DNS and Coolify/TLS after the client supplies domain control or the required DNS records are added.
13. Mark **Go-live approved** only after operational acceptance.
14. The organization is ready when the onboarding panel reports **READY / 100%**.

## Computed readiness checks

The platform automatically evaluates:

- Organization is active.
- Subscription is currently valid and the Organization/SaaS subscription ledger is aligned.
- Tenant Super Admin has completed secure account setup.
- At least one active branch/campus exists.

The platform operator records:

- Initial data migration: Not started, In progress, Complete, or Not required.
- Client training: Not started, In progress, Complete, or Not required.
- Target go-live date.
- Go-live approval.
- Internal onboarding notes.

The custom domain is optional and does not block shared tenant access.

## Access model

Every tenant can use the shared application login with its workspace slug:

`/login/admin?workspace=<tenant-slug>`

A custom tenant domain is available only when the assigned plan includes the `custom_domain` entitlement and DNS/TLS has been configured.

## Handover rule

Do not treat a client as fully onboarded only because the tenant record exists. Final handover requires the onboarding readiness panel to show all required checks complete.

## Security controls

- Never share tenant passwords with platform staff.
- Use the secure setup/resend-setup workflow.
- Keep plan and subscription changes in SaaS Billing so the commercial ledger cannot drift.
- Do not enable features outside the assigned plan.
- Do not reuse one client's custom domain, logo storage, users, or tenant data for another client.
- Keep production client data separate from staging/QA tenants.


## Implementation kit

For requirements collection, migration templates, UAT, domain handover, support classification, security responsibilities and final sign-off, use [CLIENT_IMPLEMENTATION_KIT.md](./CLIENT_IMPLEMENTATION_KIT.md).

Platform operators can also open **Admin -> Implementation Kit** for downloadable templates and the printable go-live checklist.


## Contract pack gate

Before production go-live for an external paying client, confirm that the commercial/legal pack in [legal-sales/README.md](./legal-sales/README.md) has been completed for that client.

At minimum:
- signed/accepted Order Form;
- applicable SaaS Agreement;
- Implementation SOW;
- DPA where Client Personal Data is processed;
- agreed SLA/support terms;
- approved privacy/grievance and support contacts;
- final handover/acceptance certificate.

Do not mark contractual onboarding complete merely because the technical readiness panel is READY / 100%.
