# School Class Teacher and Subject Teacher Responsibilities

## School mode: `Organization.groupLabelType = SECTION`
- Each active school section has **one Class Teacher** configured in **Sections → Add/Edit Section**, stored in existing `Batch.teacherId` (no schema migration).
- **Subject Teachers** come from the existing active **Teacher Allocation** records, by section and subject. A Class Teacher may also teach subjects.
- A subject allocation or timetable alone does **not** permit school daily student attendance. Only the designated Class Teacher may create, bulk-create, or correct that section's attendance as a teacher.
- Super Admin and scoped Branch Admin retain attendance authority. All existing academic enrollment, holiday and approved-leave validations remain enforced.
- Legacy school sections without an appointed Class Teacher are admin-managed until assignment. Historical `Attendance.markedById` is retained.
- Teacher Portal includes sections assigned as Class Teacher in the roster, even if the teacher has no current subject allocation.
- Class Teacher reassignment changes teacher write rights for subsequent requests; historic corrections after reassignment are handled by administrators.

## Coaching mode: `groupLabelType = BATCH`
The existing batch teacher label, subject allocation, timetable and attendance permissions remain unchanged.

## Required staging checks
1. Appoint T1 as Class Teacher of Class 6 / Section A and T2 as its subject teacher.
2. T1 can mark daily attendance even without an allocation; T2 receives HTTP 403 on single/bulk/PATCH.
3. T1 cannot mark Section B; Super Admin and scoped Branch Admin can administer attendance.
4. Active sections require a Class Teacher when created/edited. Existing attendance history is unchanged.
5. Coaching attendance still works for a teacher scheduled/allocated to the batch.
6. Verify teacher dashboard and school Section detail: Class Teacher separate from Subject Teachers.
7. Verify cross-branch and cross-tenant isolation, approved-leave, and holiday restrictions.
