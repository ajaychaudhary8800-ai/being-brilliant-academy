# School Class-wise Timetable — Implementation and QA

## Product decision
**School** organizations (groupLabelType = SECTION): Build Class-wise Timetable in Timetable Management. Choose Branch → Class → Section, then Monday–Saturday (Sunday optional). Each day lists all configured bell slots chronologically: assign a teacher-subject allocation and a classroom per empty teaching period. Existing lessons are visible read-only in the board and remain editable via the standard timetable table.

**Coaching** organizations (BATCH): retain existing Add Single Period and Add Weekly Schedule workflows, unchanged.

## Non-teaching blocks vs instructional subjects
Use **Academic Operations → Period Configuration** to define each school day's bell slots. Set BREAK, with a custom label, for Assembly, Lunch, Recess or announcements. These are shared by the branch/academic session/day; no teacher, subject, or classroom is booked. Set TEACHING for instructional periods.

Configure Physical Education/PT, Music, Art, Library, Activity, Sports and similar scheduled lessons as regular **subjects**, then create appropriate **Teacher Allocations** for the class/section. They must consume teacher capacity and participate in collision detection. Optional session-specific special events beyond this bell model require a separate scoped design; do not create fake subjects for lunch.

## Rules and limitations
- Existing Timetable, TimetablePeriod and TeacherAllocation models reused; no data migration.
- **All school-day saves are additions**, not destructive replacement. Already scheduled teaching periods are read-only in the board; use existing timetable Edit/Archive for changes.
- An active configured bell schedule and active room(s) are required before adding lessons.
- Atomic POST on a single school section + day. Server reconstructs course/branch/session/times from owned section; client cannot provide those values.
- Teacher/subject must have an active section allocation; room must be active at that branch.
- Overlap checks for section, teacher, classroom across sections; archived exact-slot uniqueness checked. Preview and transaction-save each validate with branch advisory lock and serializable isolation.
- Role guard: organization Super Admin or authorized Branch Admin. Explicit school-only and org isolation.
- Weekly allocation totals shown for context; scheduling above allocated period totals is not blocked by this feature. Follow up with automated warnings if required.
- **Do not merge or deploy** without isolated QA. Current ERP production remains unchanged.

## Staging acceptance
1. In school tenant, configure bell slots Monday with 7 TEACHING and 2 BREAK labelled Assembly and Lunch; Tuesday with a different bell sequence. Verify chronological day rows and labelled breaks. Check coaching tenant sees no school planner.
2. Add active classrooms and teacher allocations for Math, English, PT and Music in a synthetic class/section; ensure only correct section allocations appear in dropdown.
3. Preview and save 7 Monday lessons atomically; verify all entries appear in regular timetable. Switch to Tuesday and repeat.
4. Try overlapping teacher in another section, room conflict, occupied section period, duplicate period request, break period payload, invalid allocation, foreign tenant section and unauthorized Branch Admin. Each must reject without writing partial entries.
5. Verify teacher/student views and export of unchanged underlying teaching timetable; breaks appear via branch bell configuration, not as fake lessons.
6. Check no existing timetable rows or scheduled teachers change during opening/previewing board.
