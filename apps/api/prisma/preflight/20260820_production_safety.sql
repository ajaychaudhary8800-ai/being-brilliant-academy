-- READ-ONLY preflight for the 20260820 ERP/LMS migrations.
-- Run against a restored production backup first. Any returned issue row must
-- be resolved explicitly before `prisma migrate deploy`.
BEGIN TRANSACTION READ ONLY;

SELECT 'unexpected_leave_status' AS issue, "status" AS key, count(*) AS affected
FROM "LeaveRequest"
WHERE "status" NOT IN ('PENDING','APPROVED','REJECTED','CANCELLED')
GROUP BY "status";

SELECT 'duplicate_subject_name_ci' AS issue, "organizationId" AS key,
       lower(btrim("name")) AS detail, count(*) AS affected
FROM "Subject"
GROUP BY "organizationId", lower(btrim("name")) HAVING count(*) > 1;

SELECT 'allocation_subject_not_exactly_one' AS issue, a.id AS key,
       count(s.id)::text AS detail, 1 AS affected
FROM "TeacherAllocation" a
LEFT JOIN "Subject" s ON s."organizationId" = a."organizationId"
 AND lower(btrim(s."name")) = lower(btrim(a."subjectName"))
GROUP BY a.id HAVING count(s.id) <> 1;

SELECT 'generated_subject_id_collision' AS issue, a.id AS key, s.id AS detail, 1 AS affected
FROM "TeacherAllocation" a JOIN "Subject" s
  ON s.id = 'c' || substr(md5(a."organizationId" || '|' || lower(btrim(a."subjectName"))), 1, 24)
WHERE s."organizationId" <> a."organizationId"
   OR lower(btrim(s."name")) <> lower(btrim(a."subjectName"));

SELECT 'generated_subject_code_collision' AS issue, a.id AS key, s."code" AS detail, 1 AS affected
FROM "TeacherAllocation" a JOIN "Subject" s
  ON s."code" = 'TA-' || upper(substr(md5(a."organizationId" || '|' || lower(btrim(a."subjectName"))), 1, 12))
WHERE s."organizationId" <> a."organizationId"
   OR lower(btrim(s."name")) <> lower(btrim(a."subjectName"));

SELECT 'inactive_course_subject_used_by_allocation' AS issue, a.id AS key,
       cs."courseId" || ':' || cs."subjectId" AS detail, 1 AS affected
FROM "TeacherAllocation" a JOIN "Subject" s
  ON s."organizationId" = a."organizationId" AND lower(btrim(s."name")) = lower(btrim(a."subjectName"))
JOIN "CourseSubject" cs ON cs."courseId" = a."courseId" AND cs."subjectId" = s.id
WHERE NOT cs."isActive";

SELECT 'allocation_course_subject_org_inconsistency' AS issue, a.id AS key,
       cs."organizationId" AS detail, 1 AS affected
FROM "TeacherAllocation" a JOIN "Subject" sub
  ON sub."organizationId" = a."organizationId" AND lower(btrim(sub."name")) = lower(btrim(a."subjectName"))
JOIN "CourseSubject" cs ON cs."courseId" = a."courseId" AND cs."subjectId" = sub.id
WHERE cs."organizationId" <> a."organizationId";

SELECT 'allocation_relationship_inconsistency' AS issue, a.id AS key,
       concat_ws(',',
         CASE WHEN br."organizationId" <> a."organizationId" THEN 'branch_org' END,
         CASE WHEN s."organizationId" <> a."organizationId" THEN 'session_org' END,
         CASE WHEN c."organizationId" <> a."organizationId" THEN 'course_org' END,
         CASE WHEN b."organizationId" <> a."organizationId" THEN 'batch_org' END,
         CASE WHEN t."organizationId" <> a."organizationId" THEN 'teacher_org' END,
         CASE WHEN b."branchId" <> a."branchId" THEN 'batch_branch' END,
         CASE WHEN b."courseId" <> a."courseId" THEN 'batch_course' END,
         CASE WHEN b."academicSessionId" <> a."academicSessionId" THEN 'batch_session' END,
         CASE WHEN t."branchId" <> a."branchId" THEN 'teacher_branch' END) AS detail, 1 AS affected
FROM "TeacherAllocation" a
JOIN "Branch" br ON br.id=a."branchId" JOIN "AcademicSession" s ON s.id=a."academicSessionId"
JOIN "Course" c ON c.id=a."courseId" JOIN "Batch" b ON b.id=a."batchId"
JOIN "TeacherProfile" t ON t.id=a."teacherId"
WHERE br."organizationId" <> a."organizationId" OR s."organizationId" <> a."organizationId"
   OR c."organizationId" <> a."organizationId" OR b."organizationId" <> a."organizationId"
   OR t."organizationId" <> a."organizationId" OR b."branchId" <> a."branchId"
   OR b."courseId" <> a."courseId" OR b."academicSessionId" <> a."academicSessionId"
   OR t."branchId" <> a."branchId";

SELECT 'migration_state' AS issue, migration_name AS key,
       COALESCE(finished_at::text, 'NOT_FINISHED') AS detail,
       CASE WHEN rolled_back_at IS NULL THEN 0 ELSE 1 END AS affected
FROM "_prisma_migrations"
ORDER BY started_at;

ROLLBACK;
