# SchoolOS V5 coaching mode — staging UAT and release gate

**Scope:** Draft PR #202; cross-branch coaching teachers and mixed-grade batches. This is a verification plan, **not** deployment authorization. Keep the V4 production baseline frozen.

## Environment and fixtures

- Apply the additive Prisma migration in an isolated staging database restored from a verified sanitized backup.
- Establish two **different institutions** (A and B). Under institution A, create coaching branches A1 and A2, one teacher whose home branch is A1, and branch administrators scoped to A1 and A2 independently.
- Configure institution A in `BATCH` coaching mode and institution B as a `SECTION` school. Use separate users, school sessions, courses, classrooms, subjects, and grade-specific students for both.
- Verify rollback backups and recoverability first. Use only synthetic student data, not production credentials or real student PII.
- Record deployment commit SHA, target database migration count, API/Web container digests, CI run, tester, and execution date.

## Acceptance scenarios

| ID | Scenario | Expected outcome |
| --- | --- | --- |
| C01 | A1 coaching teacher assigned to active batch in A2 | Assignment succeeds inside institution A |
| C02 | A2 branch admin allocates A1 teacher to A2 batch | Succeeds with A2 target branch authorization |
| C03 | A1-only admin tries to modify A2 batch | HTTP 403 or tenant-hidden 404 |
| C04 | Teacher from institution B selected in institution A | Rejected |
| C05 | Cross-branch coaching teacher gets timetable periods in A1 and A2 that do **not** overlap | Both are saved and visible in teacher portal |
| C06 | Concurrent creation of overlapping A1/A2 timetable periods for same teacher/session | At most one active overlapping lesson; the other returns conflict or transaction retryable failure |
| C07 | Editing an A2 lesson to overlap A1 appointment | Blocked; previous schedule preserved |
| C08 | Restoring archived lesson overlapping an active A1/A2 lesson | Blocked; remains archived |
| C09 | Teacher LMS, homework, attendance, examinations for allocated A1/A2 batches | Authorized access works; unrelated branches excluded |
| C10 | Create coaching batch accepting grades 5, 6, 7 | Saved with eligible grades `[5,6,7]` |
| C11 | Admit students with grades 5, 6, and 7 to same batch | Three admissions succeed, actual per-student grades persist |
| C12 | Admit grade 8 or omit grade for restricted batch | 422; no student inserted |
| C13 | Correct grade 5 to 6 in a full batch | Grade updates without consuming another seat |
| C14 | Attempt to restrict existing batch to grades incompatible with enrolled students | Conflict; existing students unchanged |
| C15 | Legacy or exam-preparation coaching batch with no configured grade limits | Remains unrestricted and backward compatible |
| C16 | Bulk promotion / transfer of mixed-grade student records | Each student gets requested valid grade; invalid grade is rejected; no partial corruption |
| C17 | School-mode teacher from school branch B1 allocated to B2 | Rejected (unchanged original restriction) |
| C18 | School-mode batch supplied coaching-only grade array | Rejected |
| C19 | Super Admin from institution A reads/updates institution B batch or timetable | Denied (403 or hidden 404) |
| C20 | Institution A chooses institution B's identically named academic session | Rejected |
| C21 | Timetable list/dashboard/export/options requested under institution A | No institution B records or choices |
| C22 | Record timetable create/edit/status audit events | Correct institution and actor ID; no cross-tenant events |
| C23 | Repeat smoke tests for existing school attendance, timetable, LMS and student admissions | No school-mode regressions |
| C24 | Run PostgreSQL migrations, all API/unit/integration tests, TypeScript, Web build and container build on exact candidate SHA | CI must be green and provenance pinned |

## Exit criteria

1. All C01–C24 scenarios pass and are documented with redacted request/response evidence, no unresolved critical/high issues.
2. QA validates cross-tenant isolation, concurrent teacher scheduling, coaching-only grade policy, legacy data compatibility, and absence of school-mode regressions.
3. Reviewers sign off exact source commit, schema migration, recovery plan, deployment plan and commercial entitlements.
4. Merge/deployment are performed **only after separate explicit authorization**. Do not assume that a passing CI constitutes staging or production approval.

## Evidence table

| Test ID | Result (PASS/FAIL/BLOCKED) | Evidence location | Tester/date |
| --- | --- | --- | --- |
| C01–C24 | NOT EXECUTED — staging credentials and authorization required | — | — |

**Truthfulness:** Automation in GitHub Actions verifies build/tests; it does not substitute for application-level staging UAT with actual accounts and two separately configured institutions.
