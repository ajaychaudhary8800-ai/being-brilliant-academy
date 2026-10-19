import { Prisma } from "@prisma/client";
import { systemPrisma } from "./prisma.js";

/**
 * Bounded, indexed set of *expired paid room reservations*. Query the matching
 * meeting and reservation in SQL, rather than scanning the oldest RESERVED rows
 * (which can be dominated by future/other-tenant reservations indefinitely).
 */
export async function expiredSchoolOSVideoRoomCandidates(
 now:Date,eligibleTenantIds:string[],limit:number,
) {
 if(!Number.isFinite(now.getTime()))throw new Error("Invalid cutoff date");
 if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error("Invalid cutoff limit");
 const tenants=[...new Set(eligibleTenantIds.filter(id=>id && id!=="org_default"))];
 if(!tenants.length)return [] as Array<{
  meetingId:string;organizationId:string;roomName:string;endsAt:Date;
 }>;
 const where=Prisma.sql`
  r."metric"='video_minutes'
  AND r."status"='RESERVED'
  AND r."requestKey"='video-meeting:' || m."id"
  AND r."organizationId"=m."organizationId"
  AND r."organizationId" IN (${Prisma.join(tenants)})
  AND m."status" IN ('SCHEDULED','OPEN_FOR_JOIN','LIVE')
  AND m."endsAt"<=${now}
 `;
 return systemPrisma.$queryRaw<Array<{
  meetingId:string;organizationId:string;roomName:string;endsAt:Date;
 }>>(Prisma.sql`
  SELECT m."id" AS "meetingId",
         m."organizationId" AS "organizationId",
         m."livekitRoomName" AS "roomName",
         m."endsAt" AS "endsAt"
  FROM "Meeting" m
  JOIN "SchoolOSUsageReservation" r
   ON r."organizationId"=m."organizationId"
   AND r."requestKey"='video-meeting:' || m."id"
  WHERE ${where}
  ORDER BY m."endsAt" ASC,m."id" ASC
  LIMIT ${limit}
 `);
}
