# SchoolOS 5.0 — Granular premium-module switches (Stage 3)

This work extends Stage 1 (PR #179) and is independent of the Stage 2 quotation draft branch.

Added per-client modules: **Ranpal AI Examiner** (child of Examinations) and **Workflow Automation** (child of Communication). Both are optional within their existing parent modules, and they inherit parent plan eligibility to keep the existing V4 licensed tenants operational.

Server-side route guards now independently enforce these switches. Parent denial always blocks the child, even if the child override is enabled. Quotation, subscription activation and payment logic are unchanged. The client navigation hides disabled sub-modules using effective per-tenant feature policy.

Limitations: this PR does **not** split LiveKit meetings, LMS live teaching, storage quotas, connected campus, core fees or portal modules; those require full route inventories and explicit policy/usage work.

Do not deploy Stage 3 without Stage 1 commercial override schema and related API tests passing. Draft-only; no production merge.
