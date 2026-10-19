# SchoolOS V5 RC3 — V4 academic data preservation and mixed-grade backup/recovery

The existing V4→V5 rehearsal verified organizations and one admin but did not exercise actual branch, batch and pupil records. RC3 expands the **GitHub-hosted isolated PostgreSQL** drill:

1. Build frozen V4 at immutable SHA `50dfdeb4f99c5cdbaf1d5a9502c709fbbf2798f6`.
2. Seed synthetic V4 school branch, academic session, Grade 7 batch, student User and StudentProfile.
3. Back up and restore frozen V4, then apply all **114 V5 migrations** with Prisma.
4. Verify legacy school batch `coachingGrades=[]`, student `coachingGrade=NULL`, original `className="Class 7"`: the new coaching module does not silently alter school records.
5. Update only the upgraded synthetic DB to `coachingGrades=[5,6,7]` and `coachingGrade=7`; back up and restore the upgraded database. Verify both new fields and school `className` persist without changing the V4 source.
6. Record synthetic evidence artifact and immutable commit; refusal guard allows only GitHub Actions localhost test PostgreSQL. Never touch staging or production data.

The action remains automated **synthetic QA**, not staging customer UAT, legally accepted DR, or production GO. The V5 release manifest stays HOLD with 10 mandatory signed evidence gates.
