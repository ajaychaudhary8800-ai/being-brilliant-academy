import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { AppError } from "./http.js";

/** LiveKit signed events are evidence, never a direct instruction to debit a tenant. */
const eventSchema = z.object({
 id:z.string().min(8).max(191),
 event:z.string().max(80),
 createdAt:z.number().int().positive(),
 room:z.object({name:z.string().min(10).max(160),sid:z.string().optional()}).passthrough(),
 participant:z.object({identity:z.string().min(1).max(191),sid:z.string().min(1).max(191)}).passthrough().optional(),
}).passthrough();
export type VerifiedVideoWebhookEvent = {
 eventId:string;eventType:"participant_joined"|"participant_left"|"room_finished";
 roomName:string;identity:string|null;participantSid:string|null;occurredAt:Date;bodySha256:string;
};
const accepted=new Set(["participant_joined","participant_left","room_finished"]);
export function verifySchoolOSLiveKitWebhook(raw:Buffer, authorization:string|undefined,
 apiKey:string|undefined,apiSecret:string|undefined):VerifiedVideoWebhookEvent|null {
 if(!apiKey || !apiSecret || !authorization || !Buffer.isBuffer(raw) || raw.length>65536)
  throw new AppError(401,"SCHOOLOS_VIDEO_WEBHOOK_UNAUTHORIZED","Verified signed LiveKit webhook required");
 const token=authorization.startsWith("Bearer ")?authorization.slice(7):authorization;
 let claims:jwt.JwtPayload;
 try {
  const signed=jwt.verify(token,apiSecret,{algorithms:["HS256"],issuer:apiKey});
  if(!signed || typeof signed==="string")throw new Error("Invalid claim shape");
  claims=signed;
 } catch {throw new AppError(401,"SCHOOLOS_VIDEO_WEBHOOK_SIGNATURE_INVALID","Invalid LiveKit webhook signature");}
 const actual=crypto.createHash("sha256").update(raw).digest();
 const hash=typeof claims.sha256==="string"?Buffer.from(claims.sha256,"base64"):Buffer.alloc(0);
 if(hash.length!==actual.length || !crypto.timingSafeEqual(actual,hash))
  throw new AppError(401,"SCHOOLOS_VIDEO_WEBHOOK_HASH_MISMATCH","LiveKit payload verification failed");
 let payload:unknown;
 try{payload=JSON.parse(raw.toString("utf8"));}catch{
  throw new AppError(422,"SCHOOLOS_VIDEO_WEBHOOK_JSON_INVALID","Invalid signed LiveKit JSON");
 }
 const event=eventSchema.safeParse(payload);
 if(!event.success)throw new AppError(422,"SCHOOLOS_VIDEO_WEBHOOK_INVALID","LiveKit event is malformed");
 if(!accepted.has(event.data.event))return null;
 if(event.data.event!=="room_finished"&&!event.data.participant)
  throw new AppError(422,"SCHOOLOS_VIDEO_PARTICIPANT_MISSING","Signed participant required");
 const occurredAt=new Date(event.data.createdAt*1000);
 if(!Number.isFinite(occurredAt.getTime()) || occurredAt.getTime()>Date.now()+5*60_000)
  throw new AppError(422,"SCHOOLOS_VIDEO_EVENT_TIME_INVALID","Invalid provider timestamp");
 return {eventId:event.data.id,eventType:event.data.event as VerifiedVideoWebhookEvent["eventType"],
  roomName:event.data.room.name,
  // room_finished is a ROOM event. A provider may include incidental participant
  // metadata; never persist it as a participant event or break the DB contract.
  identity:event.data.event==="room_finished"?null:(event.data.participant?.identity??null),
  participantSid:event.data.event==="room_finished"?null:(event.data.participant?.sid??null),occurredAt,
  bodySha256:actual.toString("hex")};
}

/**
 * Estimate one chargeable ROOM-minute per started minute with >=2 distinct
 * confirmed connections including the host. A missing provider join, leave,
 * or room_finished invalidates the estimate; never bill from client attendance.
 */
export function calculateSchoolOSVideoRoomMinutes(events:Array<{
 eventType:string;identity:string|null;participantSid:string|null;occurredAt:Date;
}>,hostIdentity:string) {
 if(!hostIdentity || events.length===0 || events.length>10000)
  return {status:"RECONCILIATION_REQUIRED" as const,seconds:null,minutes:null,reason:"MISSING_OR_OVERSIZED_EVIDENCE"};
 const ordered=[...events].sort((a,b)=>a.occurredAt.getTime()-b.occurredAt.getTime()||
  (a.eventType==="participant_left"?-1:b.eventType==="participant_left"?1:0));
 const open=new Map<string,{identity:string;start:number}>();
 let finishCount=0,seconds=0,last:number|null=null,ended=false;
 for(const item of ordered){
  const now=item.occurredAt.getTime();
  if(!Number.isFinite(now) || (last!==null && now<last) || ended)
   return {status:"RECONCILIATION_REQUIRED" as const,seconds:null,minutes:null,reason:"EVENT_ORDER_INVALID"};
  if(last!==null && now>last && open.size>1 && [...open.values()].some(p=>p.identity===hostIdentity)){
   const unique=new Set([...open.values()].map(p=>p.identity));
   if(unique.size>=2)seconds+=(now-last)/1000;
  }
  if(item.eventType==="room_finished"){finishCount++;ended=true;}
  else {
   const sid=item.participantSid;
   if(!sid || !item.identity)return {status:"RECONCILIATION_REQUIRED" as const,seconds:null,minutes:null,reason:"PARTICIPANT_PROOF_INVALID"};
   if(item.eventType==="participant_joined"){
    if(open.has(sid))return {status:"RECONCILIATION_REQUIRED" as const,seconds:null,minutes:null,reason:"DUPLICATE_SESSION"};
    open.set(sid,{identity:item.identity,start:now});
   } else if(item.eventType==="participant_left"){
    if(open.get(sid)?.identity!==item.identity)
     return {status:"RECONCILIATION_REQUIRED" as const,seconds:null,minutes:null,reason:"UNMATCHED_LEAVE"};
    open.delete(sid);
   } else return {status:"RECONCILIATION_REQUIRED" as const,seconds:null,minutes:null,reason:"UNKNOWN_EVENT"};
  }
  last=now;
 }
 if(finishCount!==1 || open.size!==0 || seconds>86400 || !Number.isSafeInteger(seconds))
  return {status:"RECONCILIATION_REQUIRED" as const,seconds:null,minutes:null,reason:"INCOMPLETE_PROVIDER_SESSION"};
 return {status:"PREVIEW_ONLY" as const,seconds,minutes:Math.ceil(seconds/60),reason:null};
}
