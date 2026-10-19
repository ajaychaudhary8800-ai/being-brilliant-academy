# SchoolOS V5 RC6 — fail-closed release promotion

**Problem:** Historic V4 production image publishing can be manually triggered on a V5 branch, and the V2 shared staging workflow accepts manual dispatch. Both are unsafe shortcuts around customer acceptance and separate staging.

**Fixes:** V5 head must pass the `check-schoolos-v5-promotion.mjs` check before images are built or published. Require v5 release tag (not workflow_dispatch), valid 10/10 evidence-gate READY, pinned approved candidate source SHA that is a Git ancestor, and no API, web, Prisma, workflow or script mutations after the accepted source; only independently reviewed release-evidence JSON and the release manifest can be added later. Checkout full git history for the ancestry/diff check. A V5 manifest in the legacy shared staging workflow always stops the run before packaging or SSH operations. Existing V4 without V5 manifest continues without any new restrictions.

The V5 manifest is still **HOLD**, release candidate SHA null, 0/10 verified. This engineering safety control is not a production release or staging acceptance. Protected production GitHub environment approval is additionally required even after 10 gates are verified.

To sign off later: freeze reviewed source SHA, run real isolated staging migration/restore, provider and coaching UAT, collect independent gate evidence, change only `config/schoolos-v5-release-gates.json` and `release-evidence/v5/` in an evidence-only commit, and tag that commit `v5.X.Y` after separate owner authorization.
