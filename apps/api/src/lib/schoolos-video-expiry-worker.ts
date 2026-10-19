import { MeetingStatus } from "@prisma/client";
import { env } from "../config.js";
import { systemPrisma } from "./prisma.js";
import { livekitConfigured, livekitRoomService } from "./livekit.js";
import { logger } from "./logger.js";
import { schoolOSVideoAdmissionEnabled } from "./schoolos-video-admission.js";
import { expiredSchoolOSVideoRoomCandidates } from "./schoolos-video-expired-candidates.js";

const joinStatuses=[MeetingStatus.SCHEDULED,MeetingStatus.OPEN_FOR_JOIN,MeetingStatus.LIVE];
/**
 * Best-effort provider-side scheduled room disconnect. Runs every 30 seconds;
 * LiveKit provider success is required before meeting is locally marked ended.
 * Does not release a prepaid hold or settle billable usage.
 */
export async function closeExpiredSchoolOSPrepaidVideoRooms(now=new Date(),limit=50){
 if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error("Invalid video-room reconciliation limit");
 if(!env.SCHOOLOS_VIDEO_ADMISSION_ENABLED || !env.SCHOOLOS_VIDEO_ADMISSION_TENANT_IDS)
  return {processed:0,closed:0,failed:0,results:[]};
 // Scope candidate selection to eligible institutions and *expired* meetings
 // before applying LIMIT. Old future or unauthorized reservations cannot
 // indefinitely starve provider disconnections for billable rooms.
 const tenants=[...new Set(env.SCHOOLOS_VIDEO_ADMISSION_TENANT_IDS.split(",")
   .map(x=>x.trim()).filter(schoolOSVideoAdmissionEnabled))];
 if(!tenants.length)return {processed:0,closed:0,failed:0,results:[]};
 const candidates=await expiredSchoolOSVideoRoomCandidates(now,tenants,limit);
 const results:Array<{meetingId:string;organizationId:string;closed:boolean;error?:string}>=[];
 for(const meeting of candidates) {
  const meetingId=meeting.meetingId;
  const organizationId=meeting.organizationId;
  if(!livekitConfigured()){
   results.push({meetingId,organizationId:organizationId,closed:false,error:"LIVEKIT_UNAVAILABLE"});
   continue;
  }
  try{
   // Network work outside DB transaction; no long-held open transaction.
   await livekitRoomService("DeleteRoom",{room:meeting.roomName},meeting.roomName);
   await systemPrisma.$transaction(async tx=>{
    const changed=await tx.meeting.updateMany({
     where:{id:meetingId,organizationId:organizationId,status:{in:joinStatuses},endsAt:{lte:now}},
     data:{status:MeetingStatus.ENDED,endedAt:now,roomLocked:true},
    });
    if(changed.count!==1)return;
    const attendance=await tx.meetingAttendanceSession.findMany({
     where:{organizationId:organizationId,meetingId:meetingId,leftAt:null},
     select:{id:true,joinedAt:true},
    });
    for(const a of attendance){
     await tx.meetingAttendanceSession.update({where:{id:a.id},data:{
      leftAt:now,durationSeconds:Math.max(0,Math.round((now.getTime()-a.joinedAt.getTime())/1000)),
     }});
    }
    await tx.auditLog.create({data:{organizationId:organizationId,
     action:"SCHOOLOS_PREPAID_VIDEO_ROOM_BUDGET_CLOSED",entity:"Meeting",
     entityId:meetingId,metadata:{meetingId:meetingId,plannedRoomEndAt:now.toISOString(),
      policy:"VIDEO_ROOM_MINUTES_V1",creditSettlement:"PENDING_SIGNED_PROVIDER_REVIEW",
      attendanceIsNotBillingEvidence:true}}});
   });
   results.push({meetingId,organizationId:organizationId,closed:true});
  }catch(error){
   const err=error instanceof Error?error.message.slice(0,240):"Provider disconnect failed";
   logger.error({meetingId,organizationId:organizationId,err},
    "Prepaid LiveKit room budget enforcement failed; worker will retry");
   results.push({meetingId,organizationId:organizationId,closed:false,error:"PROVIDER_OR_DATABASE_FAILURE"});
  }
 }
 return {processed:results.length,closed:results.filter(x=>x.closed).length,
  failed:results.filter(x=>!x.closed).length,results};
}
