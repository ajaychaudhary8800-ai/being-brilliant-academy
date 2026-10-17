# School class-wise timetable planner (Issue #176)

## Availability and scope

- In SCHOOL mode (`Organization.groupLabelType=SECTION`), the Timetable Management page exposes **Class-wise Planner**.
- Coaching/academy mode retains the established add-single-period and multi-day weekly-schedule dialogs.
- No existing timetable entries or Subject Master records are rewritten or migrated.
- This development branch is staging-only; do not merge or deploy to production without separate approval.

## Workflow

1. Configure the school bell periods for each weekday in **Academic Operations → Periods**.
   - `TEACHING`: a lesson requiring a course Subject, assigned teacher and classroom.
   - `BREAK`: label with Assembly, Lunch, Recess or another non-teaching school-wide event. These appear on every section's day grid without fictitious subjects or teachers.
   - For actual instructed PT, Music, Art, Library, etc., create or reuse a confirmed academic Subject and its existing teacher allocation, then schedule as `TEACHING`.
2. Set up Class, active Section, teacher subject allocations and a branch classroom.
3. Go to Timetables → Class-wise Planner; select Branch → Class → Section.
4. Use Monday to Sunday tabs (Monday–Saturday normal) to inspect the sequential bell timetable.
5. In open teaching cells choose a subject/teacher allocation and classroom; existing lessons are read-only here.
6. Select **Preview day** to check backend conflicts, allocation warnings and section scope.
7. Select **Save day** to create selected lesson cells in one serializable transaction. A failed entry rolls back the entire class-day save. Return to Tuesday and repeat.

## Server guarantees

- `POST /admin/timetables/class-day/preview` and `POST /admin/timetables/class-day` validate consistent branch, class, section, session and weekday; reject duplicate periods and overlapping time ranges within one request.
- Only SCHOOL-mode organizations can use the class-day endpoints.
- Check tenant scope and active section before write; existing branch-admin restrictions apply.
- Existing validated teaching-period configuration, class/teacher/room conflicts, archived exact-slot collision, and subject-course relationships are enforced.
- Writes serialize by branch advisory lock and use serializable PostgreSQL transactions; an audit entry is written per created period.
- The existing /admin/timetables endpoints, exports and coaching workflows remain available.

## Limitations to address before release graduation

- School bell schedule management currently remains in Academic Operations, not inline inside the class grid.
- Period cells with existing lessons remain read-only in the class editor; use legacy detailed timetable actions to edit/archive.
- Default room is required. If a school has not configured a classroom, it must create one before lessons can be scheduled.
- Optional custom activities with assigned supervisor/room but no academic Subject are not yet modelled; do not represent these as graded subjects. School-wide non-teaching blocks can already use named BREAK labels.
- Day copying, one-click full-week publishing and class-filtered print/export require separate implementation and QA.
- Real production attendance/data should not be used for QA; use staging synthetic classes.

## Acceptance checklist

- Class 8A Monday and Tuesday show sequential 1–7 teaching slots with Assembly and Lunch in the right places.
- Administrator selects subject and teacher from active allocations, previews clashes and saves multiple teaching slots together.
- A teacher/classroom booked simultaneously in another section triggers a conflict with zero partial writes.
- Coaching timetable UI and backend regression tests pass.
- Verify server-side branch/tenant isolation, role scope, archived-slot rules, audit creation, and SQL rollback in staging.
