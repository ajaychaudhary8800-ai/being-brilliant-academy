import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import jwt from "jsonwebtoken";
import { env } from "../config.js";
import { AppError } from "../lib/http.js";
import { systemPrisma } from "../lib/prisma.js";
import {
 ingestSchoolOSLiveKitEvidence,schoolOSVideoEvidencePreview,
} from "../lib/schoolos-livekit-evidence-service.js";
import {
 proposeSchoolOSVideoReview,decideSchoolOSVideoReview,
} from "../lib/schoolos-video-review-service.js";

function isolated() {
 let uri:URL|null=null;
 try{if(process.env.TEST_DATABASE_URL)uri=new URL(process.env.TEST_DATABASE_URL);}catch{}
 if(!uri||process.env.DATABASE_URL!==process.env.TEST_DATABASE_URL ||
   !["localhost","127.0.0.1","::1"].includes(uri.hostname) ||
   !["postgres:","postgresql:"].includes(uri.protocol) ||
   !/(^|[_-])(test|integration)([_-]|$)/i.test(uri.pathname.replace(/^\//,"")))
  throw new Error("Refusing signed provider E2E QA outside isolated test PostgreSQL");
}
const key="signed-e2e-livekit-key",secret="signed-e2e-livekit-secret-for-HS256-qa";
function signed(body:Buffer) {
 return jwt.sign({
  iss:key,sha256:crypto.createHash("sha256").update(body).digest("base64"),
 },secret,{algorithm:"HS256",expiresIn:"10m"});
}

test("provider-signed, tenant-bound, reordered LiveKit events reach immutable review but never debit without finance approval",{
 skip:process.env.RUN_POSTGRES_INTEGRATION!=="1",timeout:120_000,
},async()=>{
 isolated();
 const tag=crypto.randomUUID().replaceAll("-","").slice(0,12);
 const a="lk-proof-tenant-a-"+tag,b="lk-proof-tenant-b-"+tag;
 const roomA="signed-livekit-room-a-"+tag,roomB="signed-livekit-room-b-"+tag;
 const prior={
  enabled:env.SCHOOLOS_VIDEO_WEBHOOK_ENABLED,
  allowlist:env.SCHOOLOS_VIDEO_EVIDENCE_TENANT_IDS,
  apiKey:env.LIVEKIT_API_KEY,
  apiSecret:env.LIVEKIT_API_SECRET,
 };
 let meetingA:string|undefined,meetingB:string|undefined;
 const now=Math.floor(Date.now()/1000);
 const raw=(id:string,room:string,event:string,sec:number,identity?:string,sid?:string)=>{
  const payload:Record<string,unknown>={
   id:"signed-e2e-"+tag+"-"+id,event,createdAt:now+sec,room:{name:room},
  };
  if(identity)payload.participant={identity,sid};
  return Buffer.from(JSON.stringify(payload));
 };
 const expectCode=async(work:()=>Promise<unknown>,code:string)=>{
  await assert.rejects(work,(error:unknown)=>error instanceof AppError && error.code===code,
   "Expected "+code);
 };
 try{
  for(const id of [a,b]){
   await systemPrisma.organization.create({data:{
    id,slug:id,name:"LiveKit Signed Evidence E2E",email:id+"@example.test",
   }});
  }
  const createMeeting=async(organizationId:string,roomName:string)=>{
   const meeting=await systemPrisma.meeting.create({data:{
    organizationId,title:"LiveKit Signed Provider Test",
    startsAt:new Date((now-220)*1000),endsAt:new Date((now+10)*1000),
    timezone:"Asia/Kolkata",hostUserId:"qa-livekit-host",
    createdById:"qa-livekit-maker",livekitRoomName:roomName,status:"ENDED",
   }});
   return meeting.id;
  };
  meetingA=await createMeeting(a,roomA);
  meetingB=await createMeeting(b,roomB);
  for(const person of ["qa-livekit-host","qa-livekit-student","qa-livekit-extra"]){
   await systemPrisma.meetingParticipant.create({data:{
    organizationId:a,meetingId:meetingA,userId:person,
    participantKind:"EMPLOYEE",
    meetingRole:person==="qa-livekit-host"?"HOST":"PARTICIPANT",
    addedById:"qa-livekit-maker",
   }});
  }
  env.SCHOOLOS_VIDEO_WEBHOOK_ENABLED=true;
  env.SCHOOLOS_VIDEO_EVIDENCE_TENANT_IDS=a;
  env.LIVEKIT_API_KEY=key;
  env.LIVEKIT_API_SECRET=secret;

  const events=[
   raw("join-host",roomA,"participant_joined",-160,"qa-livekit-host","host-sid"),
   raw("join-pupil",roomA,"participant_joined",-145,"qa-livekit-student","student-sid"),
   raw("leave-pupil",roomA,"participant_left",-70,"qa-livekit-student","student-sid"),
   raw("leave-host",roomA,"participant_left",-55,"qa-livekit-host","host-sid"),
   // A provider may include a participant in room_finished: it remains room-scoped.
   raw("room-finish",roomA,"room_finished",-50,"qa-livekit-host","host-sid"),
  ];
  // Webhook DELIVERY order can differ from occurredAt order; billing uses signed timestamps.
  for(const rawEvent of [...events].reverse()){
   const result=await ingestSchoolOSLiveKitEvidence(rawEvent,signed(rawEvent));
   assert.equal(result.status,"STORED");
  }
  const replay=await ingestSchoolOSLiveKitEvidence(events[1]!,signed(events[1]!));
  assert.equal(replay.status,"REPLAY");
  assert.equal(await systemPrisma.schoolOSLiveKitEvent.count({where:{organizationId:a}}),5);

  const view=await schoolOSVideoEvidencePreview(a,meetingA);
  assert.equal(view.status,"PREVIEW_ONLY");
  assert.equal(view.seconds,75);
  assert.equal(view.minutes,2);
  assert.equal(view.signedProviderEvents,5);
  assert.equal(view.automaticBillingEnabled,false);
  const roomFinished=await systemPrisma.schoolOSLiveKitEvent.findFirstOrThrow({where:{
   organizationId:a,meetingId:meetingA,eventType:"room_finished",
  }});
  assert.equal(roomFinished.identity,null);
  assert.equal(roomFinished.participantSid,null);

  // Same provider event ID with a different signed payload is not a replay.
  const conflict=raw("join-pupil",roomA,"participant_joined",-145,
   "qa-livekit-student","tampered-sid");
  await expectCode(()=>ingestSchoolOSLiveKitEvidence(conflict,signed(conflict)),
   "SCHOOLOS_LIVEKIT_EVENT_REPLAY_CONFLICT");
  const tampered=Buffer.from(events[0]!.toString().replace("qa-livekit-host","intruder"));
  await expectCode(()=>ingestSchoolOSLiveKitEvidence(tampered,signed(events[0]!)),
   "SCHOOLOS_VIDEO_WEBHOOK_HASH_MISMATCH");
  await expectCode(()=>ingestSchoolOSLiveKitEvidence(events[0]!,undefined),
   "SCHOOLOS_VIDEO_WEBHOOK_UNAUTHORIZED");
  const stranger=raw("stranger",roomA,"participant_joined",-65,"not-invited","stranger");
  await expectCode(()=>ingestSchoolOSLiveKitEvidence(stranger,signed(stranger)),
   "SCHOOLOS_LIVEKIT_PARTICIPANT_INVALID");
  const disabled=raw("disabled",roomB,"room_finished",-45);
  await expectCode(()=>ingestSchoolOSLiveKitEvidence(disabled,signed(disabled)),
   "SCHOOLOS_VIDEO_TENANT_DISABLED");
  const unknown=raw("unknown","not-a-mapped-room-"+tag,"room_finished",-40);
  await expectCode(()=>ingestSchoolOSLiveKitEvidence(unknown,signed(unknown)),
   "SCHOOLOS_LIVEKIT_ROOM_AMBIGUOUS");
  await assert.rejects(()=>schoolOSVideoEvidencePreview(b,meetingA));
  assert.equal(await systemPrisma.schoolOSUsageEvent.count({where:{organizationId:a}}),0);

  const proposal=await proposeSchoolOSVideoReview(
   a,meetingA,"qa-livekit-maker","signed-livekit-provider-session-"+tag,
   "Signed LiveKit session was validated by synthetic finance QA",
  );
  assert.equal(proposal.status,"PENDING");
  assert.equal(proposal.minutes,2);
  assert.equal(await systemPrisma.schoolOSUsageEvent.count({where:{organizationId:a}}),0);

  // Late valid evidence delivered AFTER maker proposal invalidates the proof.
  // It changes the signed SHA despite unchanged chargeable minutes.
  for(const [type,sec] of [["participant_joined",-125],["participant_left",-115]] as const) {
   const later=raw("late-extra-"+type,roomA,type,sec,"qa-livekit-extra","extra-sid");
   assert.equal((await ingestSchoolOSLiveKitEvidence(later,signed(later))).status,"STORED");
  }
  await expectCode(()=>decideSchoolOSVideoReview(a,proposal.id,
   "qa-livekit-independent-checker","REJECT",
   "Signed evidence changed, so a new finance review is required"),
   "SCHOOLOS_VIDEO_EVIDENCE_CHANGED");
  assert.equal(await systemPrisma.schoolOSUsageEvent.count({where:{organizationId:a}}),0);
 } finally {
  env.SCHOOLOS_VIDEO_WEBHOOK_ENABLED=prior.enabled;
  env.SCHOOLOS_VIDEO_EVIDENCE_TENANT_IDS=prior.allowlist;
  env.LIVEKIT_API_KEY=prior.apiKey;
  env.LIVEKIT_API_SECRET=prior.apiSecret;
  await systemPrisma.auditLog.deleteMany({where:{organizationId:{in:[a,b]}}});
  await systemPrisma.$transaction(async tx=>{
   await tx.$executeRawUnsafe('ALTER TABLE "SchoolOSVideoUsageReview" DISABLE TRIGGER "SchoolOSVideoUsageReview_guard"');
   await tx.schoolOSVideoUsageReview.deleteMany({where:{organizationId:{in:[a,b]}}});
   await tx.$executeRawUnsafe('ALTER TABLE "SchoolOSVideoUsageReview" ENABLE TRIGGER "SchoolOSVideoUsageReview_guard"');
   await tx.$executeRawUnsafe('ALTER TABLE "SchoolOSLiveKitEvent" DISABLE TRIGGER "SchoolOSLiveKitEvent_guard"');
   await tx.schoolOSLiveKitEvent.deleteMany({where:{organizationId:{in:[a,b]}}});
   await tx.$executeRawUnsafe('ALTER TABLE "SchoolOSLiveKitEvent" ENABLE TRIGGER "SchoolOSLiveKitEvent_guard"');
  });
  if(meetingA)await systemPrisma.meeting.deleteMany({where:{id:meetingA,organizationId:a}});
  if(meetingB)await systemPrisma.meeting.deleteMany({where:{id:meetingB,organizationId:b}});
  await systemPrisma.$transaction(async tx=>{
   await tx.$executeRawUnsafe('ALTER TABLE "AcademicSession" DISABLE TRIGGER "AcademicSession_exactly_one_current"');
   await tx.academicSession.deleteMany({where:{organizationId:{in:[a,b]}}});
   await tx.organization.deleteMany({where:{id:{in:[a,b]}}});
   await tx.$executeRawUnsafe('ALTER TABLE "AcademicSession" ENABLE TRIGGER "AcademicSession_exactly_one_current"');
  });
 }
});
