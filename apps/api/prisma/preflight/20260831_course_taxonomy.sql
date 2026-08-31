-- Strictly read-only preflight for course taxonomy and specialization upgrade.
-- All existing courses require explicit classification; no value is guessed.

SELECT 'LEGACY_COURSE_REQUIRES_CLASSIFICATION' category,count(*)::bigint records FROM "Course";

SELECT c.id,c."organizationId",c.title,c."courseCode",c."type"::text "courseType",c."classLevel"::text,c.stream,category.name "legacyCategory"
FROM "Course" c LEFT JOIN "Category" category ON category.id=c."categoryId"
ORDER BY c."organizationId",c.id;

SELECT 'INVALID_COURSE_RELATIONSHIP' category,count(*)::bigint records FROM "Course" c
LEFT JOIN "Category" category ON category.id=c."categoryId"
LEFT JOIN "Branch" branch ON branch.id=c."branchId"
WHERE (c."categoryId" IS NOT NULL AND (category.id IS NULL OR category."organizationId"<>c."organizationId"))
   OR (c."branchId" IS NOT NULL AND (branch.id IS NULL OR branch."organizationId"<>c."organizationId"));

SELECT 'INVALID_COURSE_SUBJECT_RELATIONSHIP' category,count(*)::bigint records FROM "CourseSubject" link
LEFT JOIN "Course" course ON course.id=link."courseId"
LEFT JOIN "Subject" subject ON subject.id=link."subjectId"
WHERE course.id IS NULL OR subject.id IS NULL OR course."organizationId"<>link."organizationId" OR subject."organizationId"<>link."organizationId";

SELECT 'INVALID_TEACHER_SUBJECT_RELATIONSHIP' category,count(*)::bigint records FROM "TeacherSubject" link
LEFT JOIN "TeacherProfile" teacher ON teacher.id=link."teacherId"
LEFT JOIN "Subject" subject ON subject.id=link."subjectId"
WHERE teacher.id IS NULL OR subject.id IS NULL OR teacher."organizationId"<>link."organizationId" OR subject."organizationId"<>link."organizationId";

SELECT 'AMBIGUOUS_LEGACY_SPECIALIZATION' category,count(*)::bigint records FROM "TeacherProfile"
WHERE nullif(btrim(specialization),'') IS NOT NULL AND specialization ~* '(^|[[:space:]])(and|or)([[:space:]]|$)|[+/,;&]';

SELECT id,"organizationId",specialization FROM "TeacherProfile"
WHERE nullif(btrim(specialization),'') IS NOT NULL AND specialization ~* '(^|[[:space:]])(and|or)([[:space:]]|$)|[+/,;&]'
ORDER BY "organizationId",id;

SELECT 'BATCH_COURSE_INCONSISTENCY' category,count(*)::bigint records FROM "Batch" batch
LEFT JOIN "Course" course ON course.id=batch."courseId"
LEFT JOIN "Branch" branch ON branch.id=batch."branchId"
WHERE course.id IS NULL OR branch.id IS NULL OR batch."organizationId"<>course."organizationId" OR batch."organizationId"<>branch."organizationId"
   OR (course."branchId" IS NOT NULL AND course."branchId"<>batch."branchId");

SELECT 'DUPLICATE_NORMALIZED_SUBJECT' category,count(*)::bigint records FROM (
  SELECT 1 FROM "Subject" GROUP BY "organizationId",lower(btrim(name)) HAVING count(*)>1
) duplicate;

SELECT 'ALLOCATION_RELATIONSHIP_INCONSISTENCY' category,count(*)::bigint records FROM "TeacherAllocation" allocation
LEFT JOIN "Course" course ON course.id=allocation."courseId"
LEFT JOIN "Batch" batch ON batch.id=allocation."batchId"
LEFT JOIN "TeacherProfile" teacher ON teacher.id=allocation."teacherId"
LEFT JOIN "Subject" subject ON subject.id=allocation."subjectId"
WHERE course.id IS NULL OR batch.id IS NULL OR teacher.id IS NULL OR subject.id IS NULL
   OR course."organizationId"<>allocation."organizationId" OR batch."organizationId"<>allocation."organizationId"
   OR teacher."organizationId"<>allocation."organizationId" OR subject."organizationId"<>allocation."organizationId"
   OR batch."courseId"<>allocation."courseId" OR batch."branchId"<>allocation."branchId" OR teacher."branchId"<>allocation."branchId";
