# Security Schedule

This schedule describes baseline controls for the Being Brilliant SaaS. It is deliberately factual and does not claim certifications that have not been obtained.

## 1. Tenant separation and authorization

- Organization/tenant context is enforced server-side for tenant-scoped operations.
- Role-based authorization is used for administrative, teacher, student, parent, accountant and employee workflows.
- Branch-level controls apply to branch-scoped operations where implemented.
- Platform-administration functions are separated from tenant administration.

## 2. Authentication

- Passwords are stored using one-way password hashing rather than plaintext.
- Access tokens/session checks are validated server-side.
- User active status and current role are revalidated for protected access.
- Password-reset/setup links are time-limited.

## 3. Network and application security

- Production access is intended to use HTTPS/TLS.
- Security headers and production CORS controls are configured by the application/reverse-proxy architecture.
- Rate limiting applies to sensitive/public API surfaces.
- Uploaded files are subject to application validation appropriate to supported workflows.

## 4. Audit and monitoring

- Material administrative/security-relevant actions are logged where the product provides audit events.
- Production readiness/health monitoring is maintained.
- Release changes pass automated test, typecheck/build and container validation gates before protected-branch merge.

## 5. Secure development

- Database migrations are version-controlled.
- Tenant-isolation/security regressions are covered by automated tests.
- Dependency and major-version changes should be reviewed rather than automatically adopted into production.
- Staging/testing is used for material workflow validation.

## 6. Data protection

- Access to Client Data is limited to authorized functionality/personnel.
- Production data should not be copied into uncontrolled development/test environments.
- Payment-card handling is delegated to the configured payment provider; the SaaS should not store full card credentials.

## 7. Backups and recovery

Backup procedures are maintained for the production deployment. Local backup verification has been implemented; stronger off-site DR commitments are not represented in this schedule unless subsequently verified and contracted.

Any stated RPO/RTO must come from an executed Order Form after a successful isolated restore drill.

## 8. Incident response

Provider will investigate suspected security incidents, contain affected access where appropriate, preserve relevant evidence, remediate confirmed vulnerabilities and notify Client as required by the DPA.

## 9. Subprocessors and infrastructure

Provider may use reputable infrastructure, email, monitoring, payment and communications providers. Specific data-residency, dedicated-infrastructure or subprocessor commitments require an Order Form term.

## 10. Client-side security responsibilities

Client is responsible for authorized-user lifecycle, endpoint/device security, secure credential handling, least-privilege assignment, lawful data entry and protection of exported files.

## 11. No implied certification

This schedule does not represent ISO 27001, SOC 2, PCI DSS certification or any other certification unless Provider separately supplies current evidence and the Order Form expressly references it.
