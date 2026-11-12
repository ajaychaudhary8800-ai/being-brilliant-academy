# SchoolOS V5 Phase 1 — Rebuild and RETAIN previous OCI candidates on a private owner builder

**13 November 2026. New source-only capability. NO production or shared VPS execution; NO Cloudflare upload or credential rotation.**

## Why a private rebuild is the next real milestone

The actual V5 staging image cache was examined read-only: 40 images, current API/Web source revision-label parity, **zero eligible matching older labelled pairs**, 2 unlabelled possible API and 9 unlabelled possible Web candidates. Older cached Docker images may contain historical PostgreSQL/Redis secrets (#293) and must not be exported, reused, signed or published.

Draft #333 independently built previous-source API/Web OCI files **in GitHub Actions only**, verified their actual OCI byte layout and bounded pattern scans (the 17-layer API image and 10-layer Web image), then destroyed those files. Drafts #334–#336 prepared source-only offline signing, private R2 preflight, and an **owner-acknowledged, default-disabled** no-overwrite publisher. None of those tools can create the missing **owner-retained fresh OCI files**.

`scripts/schoolos-v5-private-prior-oci-local-builder.py` addresses that concrete gap. It only runs on a separate **trusted, dedicated, owner-controlled non-root Linux builder** with a private `0700` output directory. It must **never** run on the historical shared staging VPS, production servers, a machine containing live V5 secrets or inside CI. Running it without its exact opt-in switch produces a fixed disabled status and does no work.

## Required operator review / inputs

Run from a Git checkout that contains two independently reviewed commits:

- Immutable previous V5 application source `b54dca5ae36a948f83012faa4a37354198fba083`.
- Exact current controls commit SHA (`V5_OWNER_CONTROLS_SHA`), reviewed before execution. Source and control files are read from **Git objects only**, not the dirty checkout.
- Review and record the **multi-arch or linux/amd64 immutable digest** for the publicly fetched `node:22-alpine` base image. Provide it privately as `V5_OWNER_APPROVED_NODE22_ALPINE_DIGEST=sha256:<64-lowercase-hex>`. This script will NOT guess or dynamically select a Docker base digest: the digest must be approved independently, and base tag/digest changes from historic builds are a recorded recipe delta.
- New owner-only private output directory under a **Linux POSIX filesystem** mode 0700 and owned by the nonroot builder user, given as `V5_OWNER_PRIVATE_BUILD_DIR`. Never use Windows `/mnt/c` or `/mnt/d` if WSL mount permissions do not enforce POSIX modes. Do not use the VPS or any directory with existing archive files.
- An explicitly approved isolated rebuild, declared in the builder process environment as `V5_OWNER_PRIVATE_BUILDER_ACK=I_APPROVE_PRIVATE_PRIOR_OCI_BUILD_NOT_PUBLICATION`. This does **not** authorize Cloudflare writes, signer creation, credential rotation or deployment.

Only after reviewing those controls, the operator may invoke:

```bash
python3 scripts/schoolos-v5-private-prior-oci-local-builder.py --execute-owner-private-build
```

Never paste sensitive paths, private image bytes or environment credential values into chat, GitHub issues or logs.

## Technical execution and audit boundaries

The builder does not clone branches, change Git HEAD, merge PRs, modify a staging database or reuse Docker image TARs from the old VPS. It:

1. Enforces nonroot trusted Linux and refuses any populated `CI` or `GITHUB_ACTIONS`, missing precise owner acknowledgement, unpinned commit/digest, insecure output directory or pre-existing output files. It deliberately requires a supplied `sha256:` pinned base digest, not floating `node:22-alpine`.
2. Confirms both Git revisions exactly and the immutable Git blob SHA1 of the actual old API Dockerfile (`58c374752a88aa6e0aeae068ec6cbcdd1e147f98`), old Web Dockerfile (`b945ffcb733a3cc76b35d8dddabe0f1c1bdb0b85`) and approved public-docs purge helper (`ba3041ce4bf89c548f154db15af71d87bbb195a6`).
3. Materializes the old tree via `git archive` to a private temporary directory. Extraction refuses symlinks, hard links, devices, traversal, duplicate members and oversized entries; controls are fetched from the approved Git commit only. Modifies Dockerfile recipes **only in that private temporary context** to pin both `FROM node:22-alpine` bases and add the same hash-pinned public documentation removal step proven in prior isolated CI. These are **recipe deltas**, not a claim of byte-identical historic binary recovery.
4. Builds `linux/amd64` API and Web into **new private OCI image-layout TARs**, with Buildx `--pull --no-cache --provenance=false --sbom=false` and only public `SCHOOLOS_BUILD_REVISION` and relative `NEXT_PUBLIC_API_URL=/api/v1` build args. The Docker daemon, external base image registry, package mirrors and Dockerfile build instructions can execute code, therefore only use a dedicated clean builder with **no live secrets** and restricted access. `--pull` can contact public registries: this is **not an offline build**, and changing dependencies can invalidate historical compatibility despite a pinned source commit.
5. Performs the existing bounded stream scan over every OCI layer, rejecting selected private paths, PEM files and CI canary patterns, then verifies the complete real TAR layout/index/config/content-addressed layer digests, compressed/decompressed rootfs DiffIDs and expected source SHA through the existing prior OCI candidate validator.
6. Promotes the verified files using exclusive hard links only into the owner private directory, never overwriting existing records. Keeps `api.oci.tar`, `web.oci.tar`, and **`candidate-receipt.json` (UNSIGNED)**. Deletes only the newly created private temporary Git/build contexts after completion. Does not expose paths or file bytes in output; all logs and external command stderr are suppressed. There is **no GitHub artifact, R2 PUT, private signer invocation, SSH or deployment**.

**These files remain unsigned, and even if this owner-run later passes, they are only owner-local private OCI candidates.** The build recipe, base-image digest, source-to-image provenance and actual semantic rootfs contents still require review before the separate #334 pinned detached signature step. It is not possible to cryptographically prove a malicious package did not include secrets simply by matching patterns. Also verify actual runtime process/API/Web recovery on an isolated checkpoint before treating this image pair as a compatible rollback.

## Evidence classification

- The newly added synthetic tests mock Git archive and Docker build calls and validate fail-closed CLI default, owner/private/CI controls, pinned Docker recipes, safe extraction, no-overwrite/private promotion, and **simulated** retained outputs. **The owner builder has NOT run on real OCI images here** and these tests are not evidence that public dependencies are reproducible today.
- Until the operator's real private build finishes, there are **no retained previous-version OCI image TARs**. Do not run #334/#335/#336 as if such artifacts existed.
- After source pin review and real build, the owner-controlled signer (#334), read-only Cloudflare R2 prepublication (#335), conditional owner-approved uploader (#336) and independent actual S3 full-byte readback form the remaining custody sequence. None is allowed to run implicitly from this builder.
- Historical PostgreSQL/Redis credential rotation (#293) is strictly held until actual protected rollback and controlled staging maintenance are authorized. No production or BBA customer impact is permitted.

**Release board #258: 0/10 formally verified. Issues #281/#292/#293 remain open. `DEPLOYMENT_AUTHORIZATION=HOLD`, `COMMERCIAL_GO=HOLD`.**
