# SchoolOS V5 — Phase 1 Redis runtime-argv containment and credential rotation rehearsal

**Scope: Staging V5 source only.** No staging/production changes, password rotation, host-volume changes, real customer login, provider operation or deployment. #281/#292/#293 and release board #258 remain open. A modified Docker Compose file does not prove the currently deployed service has changed.

## Source change

The earlier `docker-compose.schoolos-v5-staging.yml` passed the interpolated plaintext `REDIS_PASSWORD` as `redis-server --requirepass <secret>` and placed it in the healthcheck `redis-cli -a <secret>` arguments. Docker `Config.Cmd` / process command-line inspection can expose such argument values to operators with container access.

The new **staging-only** Redis image uses the official `redis:7-alpine` base with a small shell entrypoint. At container startup, it requires a supplied `REDIS_PASSWORD` of at least 32 characters, computes a SHA-256 password verifier in process memory, and writes **only the hash** to an ACL file inside a dedicated **64KiB, non-persistent tmpfs**. It starts the official Redis entrypoint with `--aclfile /run/schoolos-v5-redis-auth/users.acl`, not with plaintext `--requirepass` arguments.

The healthcheck supplies `REDISCLI_AUTH` as a transient environment assignment, not a `-a` process argument. The `redis_data` external persistent volume mapping is **unchanged**, including exactly `96ffcu0jinuwlnaqxpltln4p_redis-data`. The non-staging `docker-compose.yml` is intentionally **unmodified**.

**Remaining exposure:** the plaintext Redis password is still present in the Redis service's *runtime environment* `REDIS_PASSWORD`; principals who can `docker inspect` or access privileged container internals can see it. It is not a substitute for full secret-scoping or password rotation. New source images must be reviewed for malicious/injected build args and no historical exposed artifacts may be used. Nothing here revokes the old credential or establishes artifact custody.

## Isolated test

The dedicated GitHub Action `V5 Redis Runtime ACL and Rotation Synthetic Rehearsal` uses a disposable local Docker network with no external network connectivity and generates two random synthetic 64-hex passwords. It:

1. Builds the new staging-only Redis image and validates script/Compose source.
2. Starts Redis using the synthetic old credential with the ACL held in tmpfs and a separate disposable Docker data volume.
3. Verifies the password does **not** occur in process command-line arguments (the runtime container environment is separately classified as exposed).
4. Persists one synthetic Redis key, stops the container, and recreates it with a **different** newly generated credential and the same disposable data volume.
5. Confirms the old synthetic credential fails, the new one succeeds and the previously written key survives.
6. Destroys the synthetic Redis container and volume; does not emit passwords, password hashes or container environment data.

This test proves only a **source/isolated technical capability**, never that real PostgreSQL or Redis credentials have been rotated or that production data can be recovered.

## Preconditions for any real shared staging rollout

**Do not deploy this source simply because CI is green.**

- Phase1 #292 must deliver an approved signed, immutable, *independently retrieved* and real-checkpoint-compatible rollback pair; existing #319/#323 source tools do not by themselves satisfy this.
- Confirm BBA Phase2 staging lock released and approved exclusive downtime window, named operator and security witness in Issue #258.
- Protect historical Web image, old archives and logs; identify current PostgreSQL, Redis and affected user access audiences. Preserve protected encryption/Vault/payment key continuity and avoid blind encryption key rotation.
- Generate **new** high-entropy Redis credential (at least 32 characters), keep it in protected operator-only custody; distribute to Redis + API Redis URL and other clients together, **outside** Docker build args, GitHub or logs.
- Similarly perform the separate **actual PostgreSQL role password change** and coordinated client updates: changing environment `POSTGRES_PASSWORD` on an existing volume alone is insufficient.
- Review effective Coolify Compose/container injection, all mapped volumes and source/image IDs. Rebuild with clean reviewed recipes and commit/image manifest provenance, check image history and layers, then deploy only under the signed recovery plan.
- Validate healthy API/Redis/PostgreSQL/backup/migrations using **boolean-only** checks, reject old Redis and PostgreSQL credentials, verify new connections and unchanged source/volumes. Re-audit six non-API container secret scopes.
- Abort without deployment/rotation if any credential audience, backup, private OCI retrieval, rollback, provider setting, signed authorization or staged health prerequisite is uncertain. Preserve original signed approval record privately.

**Release status:** `PHASE1_ACCEPTANCE=HOLD`, `DEPLOYMENT_AUTHORIZATION=HOLD`, `COMMERCIAL_GO=HOLD`. This PR changes source only. Neither customer data nor shared staging were touched.

Redis ACL hash syntax and `#<sha256>` support are documented by Redis: https://redis.io/docs/latest/management/security/acl/.
