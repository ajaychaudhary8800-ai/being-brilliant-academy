import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { systemPrisma } from "../lib/prisma.js";
import { schoolOSVideoEvidencePreview } from "../lib/schoolos-livekit-evidence-service.js";
function isolated() {
 let u:URL|null=null;
 try{if(process.env.TEST_DATABASE_URL)u=new URL(process.env.TEST_DATABASE_URL);}catch{}
 if(!u||process.env.DATABASE_URL!==process.env.TEST_DATABASE_URL||
  !["localhost","127.0.0.1","::1"].includes(u.hostname)||
  !["postgres:","postgresql:"].includes(u.protocol)||
  !/(^|[_-])(test|integration)([_-]|$)/i.test(u.pathname.replace(/^\//,"")))
  throw new Error("Refusing LiveKit evidence QA outside isolated test PostgreSQL");
}
test("PostgreSQL LiveKit event ledger enforces room tenant, immutability and dedupe without debit",{
 skip:process.env.RUN_POSTGRES_INTEGRATION!=="1",timeout:120_000,
},async()=>{
 isolated();
 const token=crypto.randomUUID().slice(0,14);
 const a="video-evidence-a-"+token,b="video-evidence-b-"+token;
 let meetingId:string|undefined;
 try {
  for(const id of [a,b])await systemPrisma.organization.create({data:{
   id,slug:id,name:"LiveKit Evidence QA "+id,email:id+"@example.test",
  }});
  const meeting=await systemPrisma.meeting.create({data:{
   organizationId:a,title:"Provider Evidence Test Meeting",startsAt:new Date("2026-10-19T07:00:00Z"),
   endsAt:new Date("2026-10-19T08:00:00Z"),timezone:"Asia/Kolkata",
   hostUserId:"qa-host",createdById:"qa-host",
   livekitRoomName:"livekit-evidence-room-"+token,
  }});
  meetingId=meeting.id;
  const event=await systemPrisma.schoolOSLiveKitEvent.create({data:{
   providerEventId:"video-proof-"+token,organizationId:a,meetingId:meeting.id,
   eventType:"room_finished",identity:null,participantSid:null,
   occurredAt:new Date("2026-10-19T07:10:00Z"),rawSha256:"a".repeat(64),
  }});
  const view=await schoolOSVideoEvidencePreview(a,meeting.id);
  assert.equal(view.signedProviderEvents,1);
  assert.equal(view.status,"PREVIEW_ONLY");
  assert.equal(view.minutes,0);
  assert.equal(view.automaticBillingEnabled,false);
  await assert.rejects(()=>schoolOSVideoEvidencePreview(b,meeting.id));
  await assert.rejects(()=>systemPrisma.schoolOSLiveKitEvent.create({data:{
   providerEventId:"video-foreign-"+token,organizationId:b,meetingId:meeting.id,
   eventType:"room_finished",occurredAt:new Date("2026-10-19T07:11:00Z"),
   rawSha256:"b".repeat(64),
  }}));
  await assert.rejects(()=>systemPrisma.schoolOSLiveKitEvent.update({
   where:{id:event.id},data:{rawSha256:"b".repeat(64)},
  }));
  await assert.rejects(()=>systemPrisma.schoolOSLiveKitEvent.delete({where:{id:event.id}}));
  await assert.rejects(()=>systemPrisma.schoolOSLiveKitEvent.create({data:{
   providerEventId:event.providerEventId,organizationId:a,meetingId:meeting.id,
   eventType:"room_finished",occurredAt:new Date("2026-10-19T07:12:00Z"),
   rawSha256:"c".repeat(64),
  }}));
  assert.equal(await systemPrisma.schoolOSUsageEvent.count({where:{organizationId:a}}),0);
 } finally {
  await systemPrisma.$transaction(async tx=>{
   await tx.$executeRawUnsafe('ALTER TABLE "SchoolOSLiveKitEvent" DISABLE TRIGGER "SchoolOSLiveKitEvent_guard"');
   await tx.schoolOSLiveKitEvent.deleteMany({where:{organizationId:{in:[a,b]}}});
   await tx.$executeRawUnsafe('ALTER TABLE "SchoolOSLiveKitEvent" ENABLE TRIGGER "SchoolOSLiveKitEvent_guard"');
  });
  if(meetingId)await systemPrisma.meeting.deleteMany({where:{id:meetingId,organizationId:a}});
  await systemPrisma.$transaction(async tx=>{
   await tx.$executeRawUnsafe('ALTER TABLE "AcademicSession" DISABLE TRIGGER "AcademicSession_exactly_one_current"');
   await tx.academicSession.deleteMany({where:{organizationId:{in:[a,b]}}});
   await tx.organization.deleteMany({where:{id:{in:[a,b]}}});
   await tx.$executeRawUnsafe('ALTER TABLE "AcademicSession" ENABLE TRIGGER "AcademicSession_exactly_one_current"');
  });
 }
});
