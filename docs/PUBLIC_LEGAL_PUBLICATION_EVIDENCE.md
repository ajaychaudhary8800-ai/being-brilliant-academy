# Public Legal Publication Evidence

**Product:** Being Brilliant ERP / LMS / CRM  
**Approved legal effective date:** 6 October 2026  
**Counsel approval:** COMPLETE — approved without changes  
**Current gate:** PENDING_RUNTIME_ACTIVATION

## 1. Counsel dependency

Indian counsel review is recorded as complete in `docs/legal-sales/COUNSEL_APPROVAL_RECORD.md`.

The reviewed pack was approved without changes for:
- external customer signature;
- public Privacy Notice publication;
- public SaaS Terms publication; and
- public Acceptable Use Policy publication.

## 2. Runtime publication controls

The application is already implemented with fail-closed public legal routes. Publication requires both:

```env
LEGAL_EFFECTIVE_DATE=2026-10-06
LEGAL_PAGES_PUBLISHED=true
```

Required routes:
- `/privacy`
- `/terms`
- `/acceptable-use`

Required public links:
- footer Privacy;
- footer Terms;
- footer Acceptable Use; and
- demo-form Privacy link.

## 3. Staging activation attempt — 6 October 2026

A temporary GitHub Actions workflow successfully built and pushed an approved web image:

`ghcr.io/ajaychaudhary8800-ai/bba-web:legal-02607186428e`

The automated staging activation could not connect to the staging server because the protected GitHub staging SSH secrets are not configured. The run failed before any remote staging mutation occurred.

Evidence:
- GitHub Actions run: `37489451736`
- Build/push step: SUCCESS
- Staging SSH step: FAILED — missing server host
- Staging verification step: SKIPPED

The temporary one-time workflow was then removed from the branch and is not intended for merge.

## 4. Required manual Coolify staging action

Because this deployment is managed through Coolify rather than the disabled GitHub SSH path, set these two environment variables on the **staging Web service only**:

- `LEGAL_PAGES_PUBLISHED=true`
- `LEGAL_EFFECTIVE_DATE=2026-10-06`

Then redeploy the **staging Web service** through the normal Coolify staging path.

Do not modify production yet as part of the staging verification step.

## 5. Staging verification checklist

After staging Web redeploy:

- [ ] `https://main-staging.beingbrilliantedu.com/privacy` returns 200 and renders the Privacy Notice.
- [ ] `https://main-staging.beingbrilliantedu.com/terms` returns 200 and renders the SaaS Terms.
- [ ] `https://main-staging.beingbrilliantedu.com/acceptable-use` returns 200 and renders the AUP.
- [ ] Privacy effective date displays 6 October 2026.
- [ ] Footer Privacy link works.
- [ ] Footer Terms link works.
- [ ] Footer Acceptable Use link works.
- [ ] Demo form Privacy link works.
- [ ] Desktop presentation checked.
- [ ] Mobile presentation checked.

## 6. Production publication

After staging verification is complete, apply the same runtime values to the production Web service and redeploy through the normal controlled production path.

Production publication must then be verified for:
- all three public legal routes;
- footer links;
- demo-form privacy link; and
- normal production health.

## 7. Gate completion rule

The `public-legal-pages` gate may become READY only after:
1. counsel approval is recorded;
2. staging activation is successful;
3. staging verification passes;
4. production publication is completed through controlled deployment; and
5. production public-page verification passes.

Until then the overall commercial launch remains HOLD.
