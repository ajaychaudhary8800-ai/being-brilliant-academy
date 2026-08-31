-- Read-only production preflight. Run manually before prisma migrate deploy.
-- Any non-zero blocker count must stop deployment for explicit data review.

WITH normalized AS (
  SELECT "organizationId", lower(btrim("name")) normalized_name, count(*) count
  FROM "Subject" GROUP BY "organizationId", lower(btrim("name"))
)
SELECT 'DUPLICATE_NORMALIZED_SUBJECT' category, count(*)::bigint records
FROM normalized WHERE count > 1;

SELECT 'INVALID_RELATIONSHIP' category, count(*)::bigint records
FROM "TeacherAllocation" a
LEFT JOIN "Branch" b ON b.id = a."branchId"
LEFT JOIN "AcademicSession" s ON s.id = a."academicSessionId"
LEFT JOIN "Course" c ON c.id = a."courseId"
LEFT JOIN "Batch" g ON g.id = a."batchId"
LEFT JOIN "TeacherProfile" t ON t.id = a."teacherId"
LEFT JOIN "Subject" sub ON sub.id = a."subjectId"
WHERE b.id IS NULL OR s.id IS NULL OR c.id IS NULL OR g.id IS NULL OR t.id IS NULL OR sub.id IS NULL
   OR b."organizationId" <> a."organizationId" OR s."organizationId" <> a."organizationId"
   OR c."organizationId" <> a."organizationId" OR g."organizationId" <> a."organizationId"
   OR t."organizationId" <> a."organizationId" OR sub."organizationId" <> a."organizationId"
   OR g."branchId" <> a."branchId" OR g."courseId" <> a."courseId"
   OR g."academicSessionId" <> a."academicSessionId" OR t."branchId" <> a."branchId";

SELECT 'DUPLICATE_ACTIVE_ALLOCATION' category, count(*)::bigint records
FROM (
  SELECT 1 FROM "TeacherAllocation" WHERE status = 'ACTIVE'
  GROUP BY "organizationId", "teacherId", "subjectId", "batchId", "academicSessionId"
  HAVING count(*) > 1
) duplicates;

SELECT 'INCONSISTENT_TIMETABLE_PERIOD' category, count(*)::bigint records
FROM (
  SELECT 1 FROM "Timetable"
  GROUP BY "organizationId", "branchId", "academicSessionId", "day", "periodNumber"
  HAVING count(DISTINCT ("startMinute", "endMinute")) > 1
) periods;

SELECT CASE
    WHEN a."subjectId" IS NULL THEN 'MISSING_SUBJECT'
    WHEN a."subjectName" ~* '(^|[[:space:]])(and|or)([[:space:]]|$)|[+/,;&]'
      OR lower(btrim(a."subjectName")) IN ('science', 'mathematics physics', 'physics mathematics', 'math physics', 'physics math') THEN 'AMBIGUOUS'
    WHEN lower(btrim(a."subjectName")) = lower(btrim(s.name)) THEN 'SAFELY_MAPPABLE'
    ELSE 'INVALID_RELATIONSHIP'
  END category,
  count(*)::bigint records
FROM "TeacherAllocation" a
LEFT JOIN "Subject" s ON s.id = a."subjectId" AND s."organizationId" = a."organizationId"
GROUP BY 1 ORDER BY 1;

SELECT a.id, a."organizationId", a."subjectName", a."subjectId"
FROM "TeacherAllocation" a
WHERE a."subjectName" ~* '(^|[[:space:]])(and|or)([[:space:]]|$)|[+/,;&]'
   OR lower(btrim(a."subjectName")) IN ('science', 'mathematics physics', 'physics mathematics', 'math physics', 'physics math')
ORDER BY a."organizationId", a.id;
