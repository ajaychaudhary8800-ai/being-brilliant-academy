import { MeetingStatus } from "@prisma/client";
import { systemPrisma } from "./prisma.js";
import { livekitConfigured, livekitRoomService } from "./livekit.js";
import { logger } from "./logger.js";
import { schoolOSVideoAdmissionEnabled,schoolOSVideoReservationKey } from "./schoolos-video-admission.js";

const joinStatuses=[MeetingStatus.SCHEDULED,MeetingStatus.OPEN_FOR_JOIN,MeetingStatus.LIVE];
/**
 * Best-effort provider-side scheduled room disconnect. Runs every 30 seconds;
 * LiveKit provider success is required before meeting is locally marked ended.
 * Does not release a prepaid hold or settle billable usage.
 */
export async function closeExpiredSchoolOSPrepaidVideoRooms(now=new Date(),limit=50){
 if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error("Invalid video-room reconciliation limit");
 // Never issue LiveKit API requests when the feature is unconfigured.
 const candidates=await systemPrisma.schoolOSUsageReservation.findMany({
  where:{metric:"video_minutes",status:"RESERVED",requestKey:{startsWith:"video-meeting:"}},
  select:{organizationId:true,requestKey:true},
  orderBy:{createdAt:"asc"},take:Math.min(250,limit*5),
 });
 const results:Array<{meetingId:string;organizationId:string;closed:boolean;error?:string}>=[];
 for(const row of candidates) {
  if(results.length>=limit)break;
  if(!schoolOSVideoAdmissionEnabled(row.organizationId))continue;
  const meetingId=row.requestKey.slice("video-meeting:".length);
  if(!meetingId)continue;
  const meeting=await systemPrisma.meeting.findFirst({
   where:{id:meetingId,organizationId:row.organizationId,status:{in:joinStatuses},
    endsAt:{lte:now}},
   select:{id:true,organizationId:true,livekitRoomName:true,hostUserId:true},
  });
  if(!meeting)continue;
  if(!livekitConfigured()){
   results.push({meetingId,organizationId:row.organizationId,closed:false,error:"LIVEKIT_UNAVAILABLE"});
   continue;
  }
  try{
   // Network work outside DB transaction; no long-held open transaction.
   await livekitRoomService("DeleteRoom",{room:meeting.livekitRoomName},meeting.livekitRoomName);
   await systemPrisma.$transaction(async tx=>{
    const changed=await tx.meeting.updateMany({
     where:{id:meeting.id,organizationId:meeting.organizationId,status:{in:joinStatuses},endsAt:{lte:now}},
     data:{status:MeetingStatus.ENDED,endedAt:now,roomLocked:true},
    });
    if(changed.count!==1)return;
    const attendance=await tx.meetingAttendanceSession.findMany({
     where:{organizationId:row.organizationId,meetingId:meeting.id,leftAt:null},
     select:{id:true,joinedAt:true},
    });
    for(const a of attendance){
     await tx.meetingAttendanceSession.update({where:{id:a.id},data:{
      leftAt:now,durationSeconds:Math.max(0,Math.round((now.getTime()-a.joinedAt.getTime())/1000)),
     }});
    }
    await tx.auditLog.create({data:{organizationId:meeting.organizationId,
     action:"SCHOOLOS_PREPAID_VIDEO_ROOM_BUDGET_CLOSED",entity:"Meeting",
     entityId:meeting.id,metadata:{meetingId:meeting.id,plannedRoomEndAt:now.toISOString(),
      policy:"VIDEO_ROOM_MINUTES_V1",creditSettlement:"PENDING_SIGNED_PROVIDER_REVIEW",
      attendanceIsNotBillingEvidence:true}}});
   });
   results.push({meetingId,organizationId:row.organizationId,closed:true});
  }catch(error){
   const err=error instanceof Error?error.message.slice(0,240):"Provider disconnect failed";
   logger.error({meetingId,organizationId:row.organizationId,err},
    "Prepaid LiveKit room budget enforcement failed; worker will retry");
   results.push({meetingId,organizationId:row.organizationId,closed:false,error:"PROVIDER_OR_DATABASE_FAILURE"});
  }
 }
 return {processed:results.length,closed:results.filter(x=>x.closed).length,
  failed:results.filter(x=>!x.closed).length,results};
}
