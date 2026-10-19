# Adhyay SchoolOS V5 — Stage 7G2: Granular License Branch Reconciliation

The stacked commercial development path from #179 through #208 **did not incorporate parallel Draft PR #181** (branched directly from Stage 1). Its important client-level **AI Examiner** and **Workflow Automation** switches were missing even though later usage-metering work assumed distinct chargeable features. Stage 7G2 selectively integrates the relevant changes into the current linear V5 candidate; it does not merge either Draft PR into V4 main.

## Completed integration

- Separate child features `ai_examiner` (parent `examinations`) and `workflow_automation` (parent `communication`).
- A disabled parent always blocks its child, irrespective of child grant, trial or wildcard subscription. A previously bundled child *inherits* its paid parent entitlement unless an explicit child denial is recorded, preserving V4 compatibility.
- The platform-admin feature editor cannot turn a child on while its parent is blocked; rejected grants and all client-specific overrides remain audited and time-bound under existing rules.
- Server routes enforce separate AI Examiner and automation toggles after authentication. The asynchronous AI Examiner worker also rechecks the current parent and premium child entitlements immediately before credit reservation or an external provider call, so a queued job cannot bypass a later license revocation. Frontend navigation reads server-computed effective features and hides denied child modules. Navigation is **not** the security boundary.
- Paid module add-ons and signed quote/capture logic remain unchanged; no subscription or credit is granted by this integration.
- API, policy, navigation and regression test coverage added.

## Deliberately excluded parallel work

Draft PR #194 also diverges from the renewal-quote parent already used by Draft #193. It contains a read-only renewal recovery classification and may add useful diagnostics, but it was **not** blindly included because overlapping renewal state machines need an independent review. Independent coaching mode work is not merged into this V5 chain; it requires release scope, tenant isolation and acceptance checks before inclusion.

## Deployment gate

This branch is stacked on #208, remains Draft, and has no effect on frozen V4 main. The V5 GO/HOLD manifest remains **HOLD** until integration, full CI, staging recovery, real payments/providers, UAT, commercial pricing and owner signoff are completed.
