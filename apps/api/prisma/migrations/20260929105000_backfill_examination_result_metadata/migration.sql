-- Backfill result metadata for finalized answer-sheet / AI Examiner results created
-- before grade, GPA and rank normalization was shared with the publication workflow.
WITH ranked AS (
  SELECT
    "id",
    RANK() OVER (
      PARTITION BY "examinationId"
      ORDER BY "marksObtained" DESC
    )::integer AS computed_rank
  FROM "ExaminationResult"
  WHERE "marksObtained" IS NOT NULL
    AND "generatedAt" IS NOT NULL
)
UPDATE "ExaminationResult" AS result
SET
  "grade" = CASE
    WHEN result."percentage" >= 90 THEN 'A+'
    WHEN result."percentage" >= 80 THEN 'A'
    WHEN result."percentage" >= 70 THEN 'B+'
    WHEN result."percentage" >= 60 THEN 'B'
    WHEN result."percentage" >= 50 THEN 'C'
    WHEN result."percentage" >= 40 THEN 'D'
    ELSE 'F'
  END,
  "gpa" = CASE
    WHEN result."percentage" >= 90 THEN 10
    WHEN result."percentage" >= 80 THEN 9
    WHEN result."percentage" >= 70 THEN 8
    WHEN result."percentage" >= 60 THEN 7
    WHEN result."percentage" >= 50 THEN 6
    WHEN result."percentage" >= 40 THEN 5
    ELSE 0
  END,
  "rank" = COALESCE(result."rank", ranked.computed_rank)
FROM ranked
WHERE result."id" = ranked."id"
  AND result."percentage" IS NOT NULL
  AND (
    result."grade" IS NULL
    OR result."gpa" IS NULL
    OR result."rank" IS NULL
  );
