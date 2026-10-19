import assert from "node:assert/strict";
import test from "node:test";
import { MeetingStatus } from "@prisma/client";
import { schoolOSVideoEvidenceSnapshot } from "./schoolos-video-settlement-policy.js";

const at=(s:number)=>new Date(Date.UTC(2026,9,19,7,0,s));
const row=(id:string,eventType:string,identity:string|null,sid:string|null,s:number)=>({
 providerEventId:id,eventType,identity,participantSid:sid,occurredAt:at(s),rawSha256:id.padEnd(64,"a").slice(0,64),
});
const complete=[
 row("join-host","participant_joined","teacher","host-1",0),
 row("join-pupil","participant_joined","student","student-1",5),
 row("leave-pupil","participant_left","student","student-1",45),
 row("leave-host","participant_left","teacher","host-1",50),
 row("room-done","room_finished",null,null,55),
];
test("closed signed room evidence yields pinned one-minute digest",()=>{
 const p=schoolOSVideoEvidenceSnapshot(complete,"teacher",MeetingStatus.ENDED);
 assert.equal(p.minutes,1);
 assert.equal(p.seconds,40);
 assert.equal(p.eventCount,5);
 assert.match(p.evidenceSha256,/^[0-9a-f]{64}$/);
 const reordered=schoolOSVideoEvidenceSnapshot([...complete].reverse(),"teacher",MeetingStatus.ENDED);
 assert.equal(reordered.evidenceSha256,p.evidenceSha256);
});
test("signed event insertion after proposal changes fingerprint",()=>{
 const original=schoolOSVideoEvidenceSnapshot(complete,"teacher",MeetingStatus.CLOSED);
 const amended=[...complete.slice(0,3),
   row("joined-extra","participant_joined","other","extra",46),
   row("left-extra","participant_left","other","extra",47),...complete.slice(3)];
 const changed=schoolOSVideoEvidenceSnapshot(amended,"teacher",MeetingStatus.CLOSED);
 assert.notEqual(changed.evidenceSha256,original.evidenceSha256);
});
test("incomplete, unused, unsettled and duplicate provider sessions never produce financial snapshots",()=>{
 assert.throws(()=>schoolOSVideoEvidenceSnapshot(complete,"teacher",MeetingStatus.LIVE));
 assert.throws(()=>schoolOSVideoEvidenceSnapshot(complete.slice(0,4),"teacher",MeetingStatus.ENDED));
 assert.throws(()=>schoolOSVideoEvidenceSnapshot([...complete,complete[0]!],"teacher",MeetingStatus.ENDED));
 assert.throws(()=>schoolOSVideoEvidenceSnapshot([
  row("single-join","participant_joined","teacher","h",0),
  row("single-leave","participant_left","teacher","h",20),
  row("single-done","room_finished",null,null,25),
 ],"teacher",MeetingStatus.ENDED));
});
