BEGIN;

-- The existing id-only foreign keys make each parent unambiguous. Reconcile only
-- legacy org_default rows, and reject every non-default conflict before DDL.
CREATE TEMP TABLE _communication_tenant_targets (
  row_tid tid NOT NULL,
  parent_organization_id text NOT NULL
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.reconcile_communication_tenant(table_name text, links jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  link jsonb;
  parent_table text;
  foreign_key text;
  bad_rows bigint;
  corrected_rows bigint;
BEGIN
  TRUNCATE _communication_tenant_targets;
  FOR link IN SELECT value FROM jsonb_array_elements(links) AS item(value) LOOP
    parent_table := link->>0;
    foreign_key := link->>1;
    EXECUTE format(
      'SELECT count(*) FROM %I c LEFT JOIN %I p ON p."id" = c.%I WHERE c.%I IS NOT NULL AND p."id" IS NULL',
      table_name, parent_table, foreign_key, foreign_key
    ) INTO bad_rows;
    IF bad_rows > 0 THEN
      RAISE EXCEPTION '3A2 preflight: %.% has % missing parent row(s)', table_name, foreign_key, bad_rows;
    END IF;
    EXECUTE format(
      'INSERT INTO _communication_tenant_targets SELECT c.ctid, p."organizationId" FROM %I c JOIN %I p ON p."id" = c.%I WHERE c.%I IS NOT NULL',
      table_name, parent_table, foreign_key, foreign_key
    );
  END LOOP;

  SELECT count(*) INTO bad_rows FROM (
    SELECT row_tid FROM _communication_tenant_targets
    GROUP BY row_tid HAVING count(DISTINCT parent_organization_id) > 1
  ) conflicts;
  IF bad_rows > 0 THEN
    RAISE EXCEPTION '3A2 preflight: % has % row(s) whose referenced parents belong to different organizations', table_name, bad_rows;
  END IF;

  EXECUTE format(
    'SELECT count(*) FROM %I c JOIN (SELECT row_tid, max(parent_organization_id) AS parent_org FROM _communication_tenant_targets GROUP BY row_tid) p ON c.ctid = p.row_tid WHERE c."organizationId" <> p.parent_org AND c."organizationId" <> %L',
    table_name, 'org_default'
  ) INTO bad_rows;
  IF bad_rows > 0 THEN
    RAISE EXCEPTION '3A2 preflight: % has % non-default organizationId value(s) conflicting with authoritative parents', table_name, bad_rows;
  END IF;

  EXECUTE format(
    'UPDATE %I c SET "organizationId" = p.parent_org FROM (SELECT row_tid, max(parent_organization_id) AS parent_org FROM _communication_tenant_targets GROUP BY row_tid) p WHERE c.ctid = p.row_tid AND c."organizationId" = %L AND p.parent_org <> %L',
    table_name, 'org_default', 'org_default'
  );
  GET DIAGNOSTICS corrected_rows = ROW_COUNT;
  RAISE NOTICE '3A2 tenant reconciliation: % updated % legacy default row(s)', table_name, corrected_rows;
END;
$$;

-- Parent rows are reconciled before their children. Optional branch/batch
-- targets contribute only when present; two different parent tenants fail.
SELECT pg_temp.reconcile_communication_tenant('MessageThread', '[ ["User", "createdById"] ]');
SELECT pg_temp.reconcile_communication_tenant('Notification', '[ ["User", "userId"] ]');
SELECT pg_temp.reconcile_communication_tenant('NotificationPreference', '[ ["User", "userId"] ]');
SELECT pg_temp.reconcile_communication_tenant('Announcement', '[ ["User", "authorId"], ["Branch", "branchId"], ["Batch", "batchId"] ]');
SELECT pg_temp.reconcile_communication_tenant('Circular', '[ ["Branch", "branchId"] ]');
SELECT pg_temp.reconcile_communication_tenant('CalendarEvent', '[ ["Branch", "branchId"], ["Batch", "batchId"] ]');
SELECT pg_temp.reconcile_communication_tenant('PortalMessage', '[ ["User", "senderId"], ["User", "recipientId"], ["MessageThread", "threadId"] ]');
SELECT pg_temp.reconcile_communication_tenant('NotificationDelivery', '[ ["Notification", "notificationId"] ]');
SELECT pg_temp.reconcile_communication_tenant('AnnouncementRead', '[ ["Announcement", "announcementId"], ["User", "userId"] ]');
SELECT pg_temp.reconcile_communication_tenant('MessageThreadMember', '[ ["MessageThread", "threadId"], ["User", "userId"] ]');
SELECT pg_temp.reconcile_communication_tenant('CircularVersion', '[ ["Circular", "circularId"] ]');
SELECT pg_temp.reconcile_communication_tenant('CircularAcknowledgement', '[ ["Circular", "circularId"], ["User", "userId"] ]');
SELECT pg_temp.reconcile_communication_tenant('CircularDownload', '[ ["Circular", "circularId"], ["User", "userId"] ]');
SELECT pg_temp.reconcile_communication_tenant('CalendarEventRsvp', '[ ["CalendarEvent", "eventId"], ["User", "userId"] ]');

-- Circulars and events may have no branch/batch. They still require an
-- existing organization, rather than an unconstrained tenant label.
DO $$
DECLARE bad_rows bigint;
BEGIN
  SELECT count(*) INTO bad_rows FROM "Circular" c LEFT JOIN "Organization" o ON o.id = c."organizationId" WHERE o.id IS NULL;
  IF bad_rows > 0 THEN RAISE EXCEPTION '3A2 preflight: Circular has % organizationId value(s) without an Organization', bad_rows; END IF;
  SELECT count(*) INTO bad_rows FROM "CalendarEvent" e LEFT JOIN "Organization" o ON o.id = e."organizationId" WHERE o.id IS NULL;
  IF bad_rows > 0 THEN RAISE EXCEPTION '3A2 preflight: CalendarEvent has % organizationId value(s) without an Organization', bad_rows; END IF;
END;
$$;

CREATE UNIQUE INDEX "Notification_organizationId_id_key" ON "Notification"("organizationId", "id");
CREATE UNIQUE INDEX "NotificationPreference_organizationId_userId_key" ON "NotificationPreference"("organizationId", "userId");
CREATE UNIQUE INDEX "Announcement_organizationId_id_key" ON "Announcement"("organizationId", "id");
CREATE UNIQUE INDEX "MessageThread_organizationId_id_key" ON "MessageThread"("organizationId", "id");
CREATE UNIQUE INDEX "Circular_organizationId_id_key" ON "Circular"("organizationId", "id");
CREATE UNIQUE INDEX "Circular_organizationId_number_key" ON "Circular"("organizationId", "number");
CREATE UNIQUE INDEX "CalendarEvent_organizationId_id_key" ON "CalendarEvent"("organizationId", "id");

ALTER TABLE "Notification" DROP CONSTRAINT "Notification_userId_fkey";
ALTER TABLE "NotificationPreference" DROP CONSTRAINT "NotificationPreference_userId_fkey";
ALTER TABLE "NotificationDelivery" DROP CONSTRAINT "NotificationDelivery_notificationId_fkey";
ALTER TABLE "Announcement" DROP CONSTRAINT "Announcement_authorId_fkey";
ALTER TABLE "Announcement" DROP CONSTRAINT "Announcement_branchId_fkey";
ALTER TABLE "Announcement" DROP CONSTRAINT "Announcement_batchId_fkey";
ALTER TABLE "AnnouncementRead" DROP CONSTRAINT "AnnouncementRead_announcementId_fkey";
ALTER TABLE "AnnouncementRead" DROP CONSTRAINT "AnnouncementRead_userId_fkey";
ALTER TABLE "PortalMessage" DROP CONSTRAINT "PortalMessage_senderId_fkey";
ALTER TABLE "PortalMessage" DROP CONSTRAINT "PortalMessage_recipientId_fkey";
ALTER TABLE "PortalMessage" DROP CONSTRAINT "PortalMessage_threadId_fkey";
ALTER TABLE "MessageThreadMember" DROP CONSTRAINT "MessageThreadMember_threadId_fkey";
ALTER TABLE "MessageThreadMember" DROP CONSTRAINT "MessageThreadMember_userId_fkey";
ALTER TABLE "Circular" DROP CONSTRAINT "Circular_branchId_fkey";
ALTER TABLE "CircularVersion" DROP CONSTRAINT "CircularVersion_circularId_fkey";
ALTER TABLE "CircularAcknowledgement" DROP CONSTRAINT "CircularAcknowledgement_circularId_fkey";
ALTER TABLE "CircularAcknowledgement" DROP CONSTRAINT "CircularAcknowledgement_userId_fkey";
ALTER TABLE "CircularDownload" DROP CONSTRAINT "CircularDownload_circularId_fkey";
ALTER TABLE "CircularDownload" DROP CONSTRAINT "CircularDownload_userId_fkey";
ALTER TABLE "CalendarEvent" DROP CONSTRAINT "CalendarEvent_branchId_fkey";
ALTER TABLE "CalendarEvent" DROP CONSTRAINT "CalendarEvent_batchId_fkey";
ALTER TABLE "CalendarEventRsvp" DROP CONSTRAINT "CalendarEventRsvp_eventId_fkey";
ALTER TABLE "CalendarEventRsvp" DROP CONSTRAINT "CalendarEventRsvp_userId_fkey";

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("organizationId", "userId") REFERENCES "User"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("organizationId", "userId") REFERENCES "User"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_notificationId_fkey" FOREIGN KEY ("organizationId", "notificationId") REFERENCES "Notification"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_authorId_fkey" FOREIGN KEY ("organizationId", "authorId") REFERENCES "User"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- PostgreSQL's column-list SET NULL preserves the required tenant column.
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_branchId_fkey" FOREIGN KEY ("organizationId", "branchId") REFERENCES "Branch"("organizationId", "id") ON DELETE SET NULL ("branchId") ON UPDATE CASCADE;
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_batchId_fkey" FOREIGN KEY ("organizationId", "batchId") REFERENCES "Batch"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AnnouncementRead" ADD CONSTRAINT "AnnouncementRead_announcementId_fkey" FOREIGN KEY ("organizationId", "announcementId") REFERENCES "Announcement"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnnouncementRead" ADD CONSTRAINT "AnnouncementRead_userId_fkey" FOREIGN KEY ("organizationId", "userId") REFERENCES "User"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortalMessage" ADD CONSTRAINT "PortalMessage_senderId_fkey" FOREIGN KEY ("organizationId", "senderId") REFERENCES "User"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PortalMessage" ADD CONSTRAINT "PortalMessage_recipientId_fkey" FOREIGN KEY ("organizationId", "recipientId") REFERENCES "User"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PortalMessage" ADD CONSTRAINT "PortalMessage_threadId_fkey" FOREIGN KEY ("organizationId", "threadId") REFERENCES "MessageThread"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MessageThread" ADD CONSTRAINT "MessageThread_createdById_fkey" FOREIGN KEY ("organizationId", "createdById") REFERENCES "User"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MessageThreadMember" ADD CONSTRAINT "MessageThreadMember_threadId_fkey" FOREIGN KEY ("organizationId", "threadId") REFERENCES "MessageThread"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageThreadMember" ADD CONSTRAINT "MessageThreadMember_userId_fkey" FOREIGN KEY ("organizationId", "userId") REFERENCES "User"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Circular" ADD CONSTRAINT "Circular_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Circular" ADD CONSTRAINT "Circular_branchId_fkey" FOREIGN KEY ("organizationId", "branchId") REFERENCES "Branch"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CircularVersion" ADD CONSTRAINT "CircularVersion_circularId_fkey" FOREIGN KEY ("organizationId", "circularId") REFERENCES "Circular"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CircularAcknowledgement" ADD CONSTRAINT "CircularAcknowledgement_circularId_fkey" FOREIGN KEY ("organizationId", "circularId") REFERENCES "Circular"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CircularAcknowledgement" ADD CONSTRAINT "CircularAcknowledgement_userId_fkey" FOREIGN KEY ("organizationId", "userId") REFERENCES "User"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CircularDownload" ADD CONSTRAINT "CircularDownload_circularId_fkey" FOREIGN KEY ("organizationId", "circularId") REFERENCES "Circular"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CircularDownload" ADD CONSTRAINT "CircularDownload_userId_fkey" FOREIGN KEY ("organizationId", "userId") REFERENCES "User"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_branchId_fkey" FOREIGN KEY ("organizationId", "branchId") REFERENCES "Branch"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_batchId_fkey" FOREIGN KEY ("organizationId", "batchId") REFERENCES "Batch"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CalendarEventRsvp" ADD CONSTRAINT "CalendarEventRsvp_eventId_fkey" FOREIGN KEY ("organizationId", "eventId") REFERENCES "CalendarEvent"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CalendarEventRsvp" ADD CONSTRAINT "CalendarEventRsvp_userId_fkey" FOREIGN KEY ("organizationId", "userId") REFERENCES "User"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX "Circular_number_key";

COMMIT;
