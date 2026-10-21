# SchoolOS V5 isolated staging: R2 backup credential isolation

**Scope:** Coolify application `96ffcu0jinuwlnaqxpltln4p`, V5 staging ONLY.
**Do not change:** frozen V4 production resources, their Compose source, databases or credentials.
**State:** Release HOLD until evidence-backed security, operational and commercial gates pass.

## Why this deployment requires a staging-only Compose file

Coolify 4.x managed Compose attaches a project-wide `env_file` to each service, potentially
exposing backup-only credentials in API, Web, PostgreSQL, Redis and Nginx.
Using empty-string environment overrides was not effective in the observed deployment.

`docker-compose.schoolos-v5-staging.yml` has no `BACKUP_AWS_ACCESS_KEY_ID` or
`BACKUP_AWS_SECRET_ACCESS_KEY` references. It mounts one **existing host credential file**
read-only **only into the backup container**; the normal `docker-compose.yml` remains
unchanged for V4 compatibility.

## Safe migration sequence (one operator action per verification)

1. **Before redeployment**, securely create a root-owned directory
   `/etc/schoolos/v5-staging` (0700) and credential file
   `/etc/schoolos/v5-staging/r2-aws-credentials` (0600). Keep file contents
   off GitHub, Coolify environment variables, shell history, chat and screenshots.
   Use an interactive editor on the server to populate the AWS CLI credentials format:

       [default]
       aws_access_key_id = <R2 ACCESS KEY ID>
       aws_secret_access_key = <R2 SECRET ACCESS KEY>

   The credentials must be R2-scoped to the `schoolos-v5-staging-backups` bucket.
   Do not display the completed file in terminal output.
2. In the **V5 staging application only**, select the reviewed new Draft PR commit as
   Git source and set Docker Compose location to
   `/docker-compose.schoolos-v5-staging.yml`, keeping the Compose deployment
   `Managed by Coolify`. Inspect the **deployable** Compose preview first:
   backup has only the read-only secret file mount, other services have none.
   Preserve existing domains, volumes, networks and service definitions.
3. Review the V5 application Environment Variables and **remove BOTH previous
   `BACKUP_AWS_ACCESS_KEY_ID` and `BACKUP_AWS_SECRET_ACCESS_KEY` entries** (including
   service-specific duplicate entries) once no longer referenced by the source.
   Removing them is essential: Coolify's global `env_file` otherwise continues to leak
   them to all containers. Do not alter other AWS variables without an audit.
   Deploy V5 staging only. Do not merge the Draft PR or promote to production.
4. Re-run masked, read-only container inventory. Verify `BACKUP_AWS_*` are **absent**
   from all V5 containers (including backup), and verify the backup mount is present
   only on backup with `RW=false`. Verify no other service has a mounted copy.
   Verify any regular `AWS_ACCESS_KEY_ID` is not equal to the dedicated R2 key.
   Do **not** infer runtime provenance just from the source branch configured in Coolify.
5. Verify backup job and Cloudflare R2 access by reading a known backup
   object and checking SHA-256. Confirm API/Web health; run an isolated recovery test
   only when necessary (previous Step 18B passed).
6. **Rotate the previously exposed dedicated R2 token:** create a new restricted token,
   replace the server-side credential file securely, verify backup upload/read/download
   with the replacement, then revoke the old token. Never paste credentials into chat.
   Verify automated nightly backup, 14-day retention and alerting separately.

## Behavior and deployment constraints

- Existing V4 Compose is unchanged. The shared backup script only uses the new
  credentials-file behavior when `AWS_SHARED_CREDENTIALS_FILE` is configured.
- If the specified file is missing/empty, the backup fails closed rather than
  falling back to Coolify-injected, potentially unrelated AWS credentials.
- The backup script clears AWS environment credentials before executing `aws`
  when the mounted file is configured. This is **not** a substitute for removing
  the old Coolify variables: Docker container configuration would still contain them.
- Cloudflare R2 bucket and endpoint remain non-secret staging config values.
- The staging Compose path is intentionally distinct from the frozen V4
  production Compose; any future consolidation requires V4 compatibility review.
- Coolify still distributes other application environment variables stack-wide.
  This change specifically isolates **R2 backup credentials**, not all possible
  tenant/API/database secrets. Broader container secret isolation remains a
  separate release-security gate.

**Release state remains HOLD regardless of a passing backup isolation test.**
