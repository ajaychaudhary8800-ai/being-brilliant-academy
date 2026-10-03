-- ERP/LMS 3.1: freeze Question Bank content inside newly authored Learning Tests.
-- Nullable columns preserve every pre-3.1 test; legacy rows continue to fall back to the live question relation.
ALTER TABLE "LearningTestQuestion"
  ADD COLUMN IF NOT EXISTS "questionVersion" INTEGER,
  ADD COLUMN IF NOT EXISTS "questionSnapshot" JSONB;
