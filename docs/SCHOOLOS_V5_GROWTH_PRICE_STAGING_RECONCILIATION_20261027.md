# SchoolOS V5 Growth annual rate drift — isolated staging only

**State: HOLD.** This is a reviewable V5-only finance control, **not** a production
release, deployment instruction, signed authorization, payment activation, or
evidence of a real customer transaction. Cumulative V5 Draft #262 remains
separate from frozen V4 production.

## Verified reference and scoped discrepancy

The approved 18 October 2026 V5 launch reference is Essentials ₹49,900/year,
Growth ₹99,900/year, Professional ₹149,990/year and Enterprise custom. The
prior V5 staging operator report listed Growth at ₹99,990/year with **zero
quotes and invoices**; this report did not independently prove zero linked
subscriptions or an unchanged staging database. The code therefore **does
not assume the change is safe**. It refuses unrecognized prices and any
existing Growth quotation, invoice or subscription.

The V4 September migration historically seeded Growth ₹89,990/year. This
reconciliation is intentionally **not** a migration or general plan update:
it never changes V4, existing subscription terms, invoices, quotations,
monthly rates, GST policy, onboarding estimates or the proposed pilot.

## Operator prerequisites (manual, not simulated)

1. Finance independently approves the **Growth annual price change in the
   isolated V5 staging database only**, and records an authentic approval
   reference and approver identity outside GitHub. Resolve the onboarding
   included-versus-separately-billable conflict before customer offers.
2. Trusted operator verifies the actual isolated V5 Coolify project, DB host
   `postgres`, database `schoolos_v5_staging`, user `schoolos_v5_user`,
   exact HTTPS staging origin, Razorpay TEST mode and all four disabled
   video admission/settlement/webhook/zero-release flags. Preserve the
   staging database backup and rollback plan before any mutation.
3. Run the **read-only** command from the reviewed V5 API container or a
   trusted environment with the correct Prisma client and exact staging
   environment variables:

   ```sh
   node apps/api/scripts/schoolos-v5-growth-price-reconcile.mjs --check
   ```

   From `apps/api`, use
   `node scripts/schoolos-v5-growth-price-reconcile.mjs --check`.
   Never run this against production or a reused V4 database.

4. Review the printed status, existing dependency counts and source SHA.
   `ALIGNED_NO_CHANGE` needs no correction. `CHANGE_SAFE_STAGING_ONLY`
   means the code sees zero dependencies; **it is not independent finance
   authorization**. Any `BLOCKED_*` status requires a human investigation.
5. Only after the operator's separately recorded approval, the operator
   may set these variables in the trusted shell (not a PR or CI secret):

   ```sh
   export SCHOOLOS_V5_GROWTH_PRICE_APPROVAL=V5_STAGING_GROWTH_99900_APPROVED
   export SCHOOLOS_V5_GROWTH_APPROVER_EMAIL='<actual-finance-approver-email>'
   export SCHOOLOS_V5_GROWTH_APPROVAL_REFERENCE='<actual-approval-reference>'
   node scripts/schoolos-v5-growth-price-reconcile.mjs --apply
   ```

   The approval marker is an **operator claim**, not a cryptographic
   signature. No real approver details are stored in this repository.
   The script rechecks plan and all three dependencies inside a
   `Serializable` transaction, performs a one-row compare-and-swap,
   and creates a staging audit record in the same transaction. If
   the price changed concurrently, it aborts. It does not send payment,
   modify historical contracts, or change entitlements.

6. Run `--check` again and have finance independently verify the
   audit record and the complete Essentials/Growth/Professional/Enterprise
   pricebook. Review provider TEST payment acceptance separately.

## Required CI evidence

`node --test apps/api/scripts/schoolos-v5-growth-price-reconcile.test.mjs`
from repository root runs without a database and checks target isolation,
unsafe video/payment flags, explicit approval, zero-dependency policy,
idempotency and compare-and-swap conflicts. This is **synthetic unit
evidence**, not an actual staging read or mutation.

Do **not** mark any of the 10 formal release gates VERIFIED on this basis.
Actual V5-only staging operator execution, independent finance signoff,
real Razorpay TEST provider proof, authentic customer UAT and explicit
production owner GO remain pending. Keep
`config/schoolos-v5-release-gates.json` at `HOLD`.
