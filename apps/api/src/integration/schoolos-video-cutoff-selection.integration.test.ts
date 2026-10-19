import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { systemPrisma } from "../lib/prisma.js";
import { expiredSchoolOSVideoRoomCandidates } from "../lib/schoolos-video-expired-candidates.js";

function isolated(){
 let url:URL|null=null;
 try{if(process.env.TEST_DATABASE_URL)url=new URL(process.env.TEST_DATABASE_URL);}catch{}
 if(!url||process.env.DATABASE_URL!==process.env.TEST_DATABASE_URL ||
    !["localhost","127.0.0.1","::1"].includes(url.hostname) ||
    !/(^|[_-])(test|integration)([_-]|$)/i.test(url.pathname.replace(/^\//,"")))
  throw new Error("Video cutoff SQL QA requires isolated local PostgreSQL");
}

test("expired prepaid rooms are selected before LIMIT, excluding future, other-tenant and ended reservations",{
 skip:process.env.RUN_POSTGRES_INTEGRATION!=="1",timeout:120_000,
},async()=>{
 isolated();
 const suffix=crypto.randomUUID().replaceAll("-","").slice(0,13);
 const eligible="video-cutoff-in-"+suffix,foreign="video-cutoff-out-"+suffix;
 const now=new Date("2026-10-19T12:00:00Z");
 const meetings:string[]=[];
 try{
  for(const id of [eligible,foreign]){
   await systemPrisma.organization.create({data:{id,slug:id,name:"QA "+id,email:id+"@example.test"}});
   await systemPrisma.schoolOSUsageBalance.create({data:{organizationId:id,metric:"video_minutes",
    periodStart:new Date("2026-10-01T00:00:00Z"),periodEnd:new Date("2026-11-01T00:00:00Z"),
    grantedUnits:500,consumedUnits:0}});
  }
  const types=[
   {tenant:eligible,offsetMinutes:60,status:"SCHEDULED" as const},
   {tenant:eligible,offsetMinutes:-20,status:"LIVE" as const},
   {tenant:foreign,offsetMinutes:-30,status:"LIVE" as const},
   {tenant:eligible,offsetMinutes:-40,status:"ENDED" as const},
  ];
  let matched="";
  for(const [index,item] of types.entries()){
   const meeting=await systemPrisma.meeting.create({data:{
    organizationId:item.tenant,title:"Video expiry QA "+index,
    hostUserId:"provider-host",createdById:"qa",
    startsAt:new Date(now.getTime()+(item.offsetMinutes-60)*60_000),
    endsAt:new Date(now.getTime()+item.offsetMinutes*60_000),
    livekitRoomName:"video-expiry-"+suffix+"-"+index,
    timezone:"Asia/Kolkata",status:item.status,
   }});
   meetings.push(meeting.id);
   if(index===1)matched=meeting.id;
   const balance=await systemPrisma.schoolOSUsageBalance.findFirstOrThrow({
    where:{organizationId:item.tenant,metric:"video_minutes"},
    select:{id:true},
   });
   await systemPrisma.schoolOSUsageReservation.create({data:{
    organizationId:item.tenant,balanceId:balance.id,metric:"video_minutes",
    requestKey:"video-meeting:"+meeting.id,units:70,actorId:"provider-host",
   }});
  }
  const rows=await expiredSchoolOSVideoRoomCandidates(now,[eligible],1);
  assert.equal(rows.length,1);
  assert.equal(rows[0]?.meetingId,matched);
  assert.equal(rows[0]?.organizationId,eligible);
  assert.equal(rows[0]?.endsAt.toISOString(),"2026-10-19T11:40:00.000Z");
  assert.equal((await expiredSchoolOSVideoRoomCandidates(now,[foreign],1)).length,1);
  assert.equal((await expiredSchoolOSVideoRoomCandidates(now,[],10)).length,0);
  assert.equal((await expiredSchoolOSVideoRoomCandidates(now,["org_default"],10)).length,0);
  await assert.rejects(()=>expiredSchoolOSVideoRoomCandidates(now,[eligible],0));
 }finally{
  await systemPrisma.schoolOSUsageReservation.deleteMany({where:{organizationId:{in:[eligible,foreign]}}});
  await systemPrisma.schoolOSUsageBalance.deleteMany({where:{organizationId:{in:[eligible,foreign]}}});
  await systemPrisma.meeting.deleteMany({where:{id:{in:meetings}}});
  await systemPrisma.$transaction(async tx=>{
   await tx.$executeRawUnsafe('ALTER TABLE "AcademicSession" DISABLE TRIGGER "AcademicSession_exactly_one_current"');
   await tx.academicSession.deleteMany({where:{organizationId:{in:[eligible,foreign]}}});
   await tx.organization.deleteMany({where:{id:{in:[eligible,foreign]}}});
   await tx.$executeRawUnsafe('ALTER TABLE "AcademicSession" ENABLE TRIGGER "AcademicSession_exactly_one_current"');
  });
 }
});
