# Off-site Disaster Recovery Evidence — 6 October 2026

## Scope

This record captures the launch-readiness evidence for the production off-site backup and isolated restore control.

It does not define or promise a contractual RPO/RTO. Any contractual recovery objective must be approved separately and reflect the production service, data size, infrastructure and client agreement.

## Backup source

- Provider: Cloudflare R2 (S3-compatible object storage).
- Bucket: `being-brilliant-production-backups`.
- Backup tested: `20261006T020001Z`.
- Scheduled off-site backup history was visible for consecutive daily backups from 25 September through 6 October 2026.
- The tested backup was downloaded from R2 rather than read only from the local backup volume.

## Integrity verification

The R2 copy contained:

- `SHA256SUMS`
- `database.dump`
- `files.tar.gz`

Checksum verification result:

```text
database.dump: OK
files.tar.gz: OK
```

## Isolated restore drill

The restore was performed in the production backup container using a temporary PostgreSQL cluster that was isolated from the production PostgreSQL service.

Isolation controls:

- temporary PostgreSQL data directory: `/tmp/bba-dr-pg`
- loopback-only host: `127.0.0.1`
- temporary port: `55432`
- temporary database: `bba_dr_restore`
- restored file archive directory: `/tmp/bba-dr-files`
- no production database URL was used for the restore target
- no live production file-storage path was used as the restore target

The temporary server reported:

```text
127.0.0.1:55432 - accepting connections
```

The off-site backup was downloaded again into the temporary drill workspace and the SHA-256 checks were re-run before restore.

## Restore results

- PostgreSQL custom-format dump restored successfully into the isolated database.
- File-storage archive extracted successfully.
- Measured core restore duration for database restore plus file extraction: **7 seconds**.
- Restored file-storage footprint: **4.5 MB**.

Database validation:

| Check | Result |
| --- | ---: |
| Public tables | 258 |
| Prisma migration rows | 73 |
| Organizations | 7 |
| Users | 33 |
| Student profiles | 11 |
| Teacher profiles | 10 |

Representative role validation:

| Role | Restored users |
| --- | ---: |
| SUPER_ADMIN | 7 |
| BRANCH_ADMIN | 1 |
| TEACHER | 10 |
| STUDENT | 11 |
| PARENT | 1 |

These counts demonstrate that representative administrative, teacher, student and parent records were present in the restored database.

## Cleanup verification

After validation:

- the isolated PostgreSQL instance was stopped cleanly;
- the temporary PostgreSQL cluster was removed;
- the downloaded temporary R2 backup copy was removed;
- the temporary restored file tree was removed.

Final port check:

```text
127.0.0.1:55432 - no response
```

This confirms the temporary restore environment was shut down and removed.

## Readiness conclusion

The production off-site backup control has verified evidence for:

1. scheduled upload to real off-site object storage;
2. retrieval from the off-site provider;
3. checksum integrity of the off-site copy;
4. isolated PostgreSQL restore;
5. isolated file-storage restore;
6. representative restored-record validation;
7. measured core restore time; and
8. safe cleanup without changing the live production database.

The launch-readiness **offsite-dr** gate can therefore move to **READY** for the current technical launch standard.

The broader commercial launch decision remains **HOLD** until all other blocking gates are READY.
