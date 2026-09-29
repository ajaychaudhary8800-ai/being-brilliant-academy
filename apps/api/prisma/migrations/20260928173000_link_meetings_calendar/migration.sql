-- Link meeting occurrences to the ERP internal calendar.
ALTER TABLE "Meeting" ADD COLUMN "calendarEventId" TEXT;
CREATE UNIQUE INDEX "Meeting_calendarEventId_key" ON "Meeting"("calendarEventId");
