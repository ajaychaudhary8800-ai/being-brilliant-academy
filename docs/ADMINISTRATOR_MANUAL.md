# Administrator manual

## Access and tenant safety

Sign in at `/login` with a Super Admin or Branch Admin account. Super Admin can provision organizations; Branch Admin is restricted to its organization and permitted branches. Never share accounts. Use a password manager and revoke sessions when staff leave.

## Daily operations

Use `/admin` for operational totals and the sidebar for admissions, students, academics, fees, examinations, HR, finance, transport, library, hostel, communication, inventory, reports, and organization settings. Search before creating a record, resolve validation errors rather than duplicating data, and archive records before permanent deletion. Paid, issued, enrolled, occupied, or otherwise referenced records may not be deleted.

## Users and permissions

Create the minimum role required. Confirm organization and branch before saving. Test a new account in a private browser session. Disable an account and revoke sessions immediately when access is no longer required. Review audit logs after privileged changes.

## Finance and payments

Reconcile captured provider payments against invoices and the general ledger daily. Never mark a payment paid from an email or screenshot. Investigate failed webhook signatures and duplicate transaction IDs. Lock closed financial periods before reports are distributed.

## Communications

Respect notification preferences and use scheduled delivery for non-urgent messages. Email, SMS, WhatsApp, and push records remain queued until their configured provider worker accepts them. Do not include sensitive student information in bulk messages.

## Operational checks

Check `/api/health/ready`, Grafana, backup completion, disk usage, failed notification deliveries, overdue payments, and expiring documents daily. Test a restore in an isolated environment at least quarterly.

