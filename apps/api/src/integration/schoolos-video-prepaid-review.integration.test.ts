import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { systemPrisma } from "../lib/prisma.js";
import { proposeSchoolOSVideoReview,decideSchoolOSVideoReview,listSchoolOSVideoReviews } from "../lib/schoolos-video-review-service.js";

function isolated() {
 let u:URL|null=null;
 try{if(process.env.TEST_DATABASE_URL)u=new URL(process.env.TEST_DATABASE_URL);}catch{}
 if(!u||process.env.DATABASE_URL!==process.env.TEST_DATABASE_URL||
  !["localhost","127.0.0.1","::1"].includes(u.hostname)||
  !["postgres:","postgresql:"].includes(u.protocol)||
  !/(^|[_-])(test|integration)([_-]|$)/i.test(u.pathname.replace(/^\//,"")))
  throw new Error("Refusing video-finance test outside isolated PostgreSQL");
}
test("signed meeting minutes require independent manual review and cannot charge when disabled",{
 skip:process.env.RUN_POSTGRES_INTEGRATION!=="1",timeout:120000,
},async()=>{
 isolated();
 const token=crypto.randomUUID().replaceAll("-","").slice(0,14);
 const orgId="video-review-"+token;
 const room="video-review-room-"+token;
 let meetingId:string|undefined, makerId:string|undefined,checkerId:string|undefined;
 try{
  await systemPrisma.organization.create({data:{id:orgId,slug:orgId,
   name:"Video Review Integration QA",email:orgId+"@example.test"}});
  const maker=await systemPrisma.user.create({data:{
   organizationId:orgId,email:"maker-"+token+"@example.test",passwordHash:"x",
   name:"Review maker",role:"SUPER_ADMIN",
  }});
  const checker=await systemPrisma.user.create({data:{
   organizationId:orgId,email:"checker-"+token+"@example.test",passwordHash:"x",
   name:"Review checker",role:"SUPER_ADMIN",
  }});
  makerId=maker.id;checkerId=checker.id;
  const meeting=await systemPrisma.meeting.create({data:{
   organizationId:orgId,title:"Signed Provider QA Room",
   startsAt:new Date("2026-10-19T07:00:00Z"),endsAt:new Date("2026-10-19T08:00:00Z"),
   timezone:"Asia/Kolkata",hostUserId:"qa-provider-host",
   createdById:maker.id,livekitRoomName:room,status:"ENDED",
  }});
  meetingId=meeting.id;
  for(const userId of ["qa-provider-host","qa-provider-student"])
   await systemPrisma.meetingParticipant.create({data:{
    organizationId:orgId,meetingId:meeting.id,userId,
    participantKind:"EMPLOYEE",meetingRole:userId==="qa-provider-host"?"HOST":"PARTICIPANT",
    addedById:maker.id,
   }});
  const events=[
   ["participant_joined","qa-provider-host","host",0],
   ["participant_joined","qa-provider-student","student",10],
   ["participant_left","qa-provider-student","student",70],
   ["participant_left","qa-provider-host","host",90],
   ["room_finished",null,null,95],
  ] as const;
  for(const [eventType,identity,participantSid,sec] of events)
   await systemPrisma.schoolOSLiveKitEvent.create({data:{
    providerEventId:"signed-"+token+"-"+sec,
    organizationId:orgId,meetingId:meeting.id,eventType,identity,participantSid,
    occurredAt:new Date(Date.UTC(2026,9,19,7,0,sec)),
    rawSha256:crypto.createHash("sha256").update(token+sec).digest("hex"),
   }});
  // 7F3: the same credit ledger must accept a bounded prepaid VIDEO hold,
  // preserve its tenant identity and reject modifications to the reserved unit.
  const balance=await systemPrisma.schoolOSUsageBalance.create({data:{
   organizationId:orgId,metric:"video_minutes",periodStart:new Date("2026-10-01T00:00:00Z"),
   periodEnd:new Date("2026-11-01T00:00:00Z"),grantedUnits:80,consumedUnits:70,
  }});
  const reservation=await systemPrisma.schoolOSUsageReservation.create({data:{
   organizationId:orgId,metric:"video_minutes",balanceId:balance.id,
   requestKey:"video-meeting:"+meeting.id,units:70,status:"RESERVED",actorId:"qa-provider-host",
  }});
  await assert.rejects(()=>systemPrisma.schoolOSUsageReservation.create({data:{
   organizationId:"org_default",metric:"video_minutes",balanceId:balance.id,
   requestKey:"video-meeting:foreign-"+token,units:70,status:"RESERVED",
  }}),"A tenant cannot reserve another institution's credits");
  await assert.rejects(()=>systemPrisma.schoolOSUsageReservation.update({
   where:{id:reservation.id},data:{units:72},
  }),"Reserved minute budgets cannot be increased after admission");
  await assert.rejects(()=>systemPrisma.schoolOSUsageReservation.create({data:{
   organizationId:orgId,metric:"video_minutes",balanceId:balance.id,
   requestKey:"video-meeting:"+meeting.id,units:70,status:"RESERVED",
  }}),"Meeting-specific video budget is unique");
  const prepared=await proposeSchoolOSVideoReview(orgId,meeting.id,maker.id,
   "provider-session-proof-"+token,"Provider events checked against signed attendance window");
  assert.equal(prepared.status,"PENDING");
  assert.equal(prepared.minutes,1);
  assert.equal((await listSchoolOSVideoReviews(orgId)).length,1);
  await assert.rejects(()=>proposeSchoolOSVideoReview(orgId,meeting.id,maker.id,
   "provider-session-proof-"+token,"Second proposal for the same signed event data"));
  await assert.rejects(()=>decideSchoolOSVideoReview(orgId,prepared.id,maker.id,"APPROVE",
   "I have independently reviewed the provider and invoice"),/different administrators/);
  await assert.rejects(()=>decideSchoolOSVideoReview(orgId,prepared.id,checker.id,"APPROVE",
   "I checked all provider events and approve the usage"),/Separate customer-specific finance approval/);
  assert.equal(await systemPrisma.schoolOSUsageEvent.count({where:{organizationId:orgId}}),0);
  await assert.rejects(()=>systemPrisma.schoolOSVideoUsageReview.update({
   where:{id:prepared.id},data:{proposedMinutes:99},
  }));
  const rejected=await decideSchoolOSVideoReview(orgId,prepared.id,checker.id,"REJECT",
   "Provider requires an independently reconciled minute contract");
  assert.equal(rejected.charged,false);
  assert.equal(rejected.status,"REJECTED");
  await assert.rejects(()=>decideSchoolOSVideoReview(orgId,prepared.id,checker.id,"REJECT",
   "Attempt to repeat an already finalized review"),/already finalized/);
  assert.equal(await systemPrisma.schoolOSUsageEvent.count({where:{organizationId:orgId}}),0);
 }finally{
  await systemPrisma.auditLog.deleteMany({where:{organizationId:orgId}});
  await systemPrisma.schoolOSUsageReservation.deleteMany({where:{organizationId:orgId}});
  await systemPrisma.schoolOSUsageBalance.deleteMany({where:{organizationId:orgId}});

  await systemPrisma.$transaction(async tx=>{
   await tx.$executeRawUnsafe('ALTER TABLE "SchoolOSVideoUsageReview" DISABLE TRIGGER "SchoolOSVideoUsageReview_guard"');
   await tx.schoolOSVideoUsageReview.deleteMany({where:{organizationId:orgId}});
   await tx.$executeRawUnsafe('ALTER TABLE "SchoolOSVideoUsageReview" ENABLE TRIGGER "SchoolOSVideoUsageReview_guard"');
   await tx.$executeRawUnsafe('ALTER TABLE "SchoolOSLiveKitEvent" DISABLE TRIGGER "SchoolOSLiveKitEvent_guard"');
   await tx.schoolOSLiveKitEvent.deleteMany({where:{organizationId:orgId}});
   await tx.$executeRawUnsafe('ALTER TABLE "SchoolOSLiveKitEvent" ENABLE TRIGGER "SchoolOSLiveKitEvent_guard"');
  });
  if(meetingId)await systemPrisma.meeting.deleteMany({where:{id:meetingId,organizationId:orgId}});
  await systemPrisma.user.deleteMany({where:{organizationId:orgId}});
  await systemPrisma.$transaction(async tx=>{
   await tx.$executeRawUnsafe('ALTER TABLE "AcademicSession" DISABLE TRIGGER "AcademicSession_exactly_one_current"');
   await tx.academicSession.deleteMany({where:{organizationId:orgId}});
   await tx.organization.deleteMany({where:{id:orgId}});
   await tx.$executeRawUnsafe('ALTER TABLE "AcademicSession" ENABLE TRIGGER "AcademicSession_exactly_one_current"');
  });
 }
});
