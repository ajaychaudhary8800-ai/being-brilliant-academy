# SchoolOS V5 RC1 — Consolidated coaching + video/finance integration

**Source coaching:** Draft PR #202, `712b5a3b05a0cedfe687498ee77373713981f6f6`, CI #1605 SUCCESS (1,112 tests / zero failures).
**Consolidated V5 parent:** Draft PR #215, `b9ca037734c6eee10ebea7ca1b448a67f5f31c8e`, GitHub CI #1606 SUCCESS.
**Common ancestor:** `a2b30f813e95f563dfbb1d2077a05dc9c705a2e4` (existing Stage 7F1 LiveKit signed evidence). Do not deploy or merge this integration directly into production main.

## Conflict assessment

The coaching PR changes 29 files relative to the common ancestor. 28 paths are unmodified in the existing RC stack: their exact audited Git blob contents can be integrated without overwriting other V5 changes. The only concurrent change is `apps/api/prisma/schema.prisma`: retain the 7F1–7G6 AI/video/financial schema, then add the two coaching-specific fields:
- `Batch.coachingGrades Int[] @default([])` for optional allowed mixed-grade membership.
- `StudentProfile.coachingGrade Int?` for individual class level inside a shared batch.

Add the coaching PR's unchanged, additive migration `20261019120000_coaching_multibranch_multigrade` after the 113 existing V5 migrations. No existing rows are rewritten. No destructive schema changes.

## Functional acceptance scope

- In `groupLabelType=BATCH` mode, same-institution teacher allocations can target multiple branches; branch admin must have permission for **target** branch, school `SECTION` mode retains old restriction.
- Cross-branch timetable writes use serializable transactions, deterministic locking and retry on P2034; conflicting same-teacher concurrent writes must allow at most one booking.
- One coaching batch can contain class-5, class-6 and class-7 pupils while keeping each StudentProfile's individual class level. Invalid/unselected grade, exceeding capacity and grade narrowing that strands existing students are rejected.
- Tenant, branch, session, subject, teacher and batch authorization must remain server-enforced including global-admin code paths; clients in different tenants cannot see or modify each other's records.
- Normal school LMS/ERP/teacher workflows remain unchanged; same-tenant coaching access continues through homework, attendance, examinations and timetable display.
- Retain 7G1–7G6 release gates and signed LiveKit/financial integrity. Coaching changes do not introduce new billable features or change customer subscription entitlements.

## Automated and manual evidence gates

1. GitHub CI must run full API tests (including isolated PostgreSQL), Prisma migrations, schema generation, TypeScript, build, container image validation, release HOLD policy and runtime smoke tests against this exact merge commit.
2. Confirm pinned merge commit has both PR #215 and coaching PR #202 as Git parents, preserving commit ancestry and avoiding duplicate migration application.
3. Staging DB backup/restore and upgrade rehearsal must be rerun with coaching migration (V4 baseline 100 -> V5 now 114 migrations), including representative coaching records; synthetic historical 100->113 migration QA is superseded for this candidate.
4. Complete `docs/SCHOOLOS_V5_COACHING_STAGING_UAT.md` for role-specific school/coaching acceptance plus signed Razorpay TEST, video/AI provider integration, finance and operational recovery UAT.
5. Keep `config/schoolos-v5-release-gates.json` on HOLD. All ten independent release gates remain pending until executed evidence supports their outcome.

**Release boundary:** Draft only. No V4 main merge, production data modification, customer billing activation, staging deployment without authorization/verification, or production GO claim.
