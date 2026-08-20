ALTER TABLE "Announcement"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'ANNOUNCEMENT',
  ADD COLUMN "category" TEXT,
  ADD COLUMN "isPinned" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "requiresAcknowledgement" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Announcement_kind_isArchived_publishedAt_idx" ON "Announcement"("kind", "isArchived", "publishedAt");
