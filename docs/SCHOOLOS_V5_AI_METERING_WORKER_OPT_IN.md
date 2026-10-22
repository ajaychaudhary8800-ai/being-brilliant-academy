# SchoolOS V5 Stage 7E2 — AI Examiner Metering (Opt-In)

The worker now supports metering only for institution IDs explicitly listed in `SCHOOLOS_AI_METERING_TENANT_IDS`. Unset by default; `*` is never a wildcard. This draft does not authorize activation of charges.

Before calling the AI provider, the worker atomically reserves one paid AI credit. Admission requires active subscription, available verified prepaid credits, and no financial risk hold. A repeated reservation cannot authorize a repeated provider call.

Once evaluation results are durably persisted for teacher review, the worker commits the held credit to the immutable usage event ledger. If the provider attempt or settlement outcome is ambiguous, the credit remains held for independent finance reconciliation. No automatic retry or refund occurs. A billing exception cannot overwrite an already persisted evaluation.

Tenant and platform administrators can see pending reservation counts and amounts in existing usage reports. Available units are net of both pending holds and settled uses. Video usage metering remains disconnected.

Commercial approval of one-credit-per-evaluation pricing, external provider failure reconciliation, and QA sign-off are prerequisites for enabling the allowlist. Do not merge or deploy to V4 production.
