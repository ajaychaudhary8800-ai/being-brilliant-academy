import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "./http.js";
import { requireSchoolOSPrepaidRoomDisconnect } from "./schoolos-video-provider-end.js";

const room="metered-qa-room-001";
test("confirmed provider room deletion allows prepaid room closure without extra provider calls",async()=>{
 let deletes=0,lists=0;
 const status=await requireSchoolOSPrepaidRoomDisconnect(room,
  async()=>{deletes++;return {success:true};},
  async()=>{lists++;return {rooms:[]};},
 );
 assert.equal(status,"DELETED");
 assert.equal(deletes,1);
 assert.equal(lists,0);
});
test("lost DeleteRoom response is safe only when a valid provider list confirms exact room is absent",async()=>{
 let checks=0;
 const result=await requireSchoolOSPrepaidRoomDisconnect(room,
  async()=>{throw new Error("DeleteRoom timed out AFTER provider applied deletion");},
  async()=>{checks++;return {rooms:[{name:"different-active-room"}]};},
 );
 assert.equal(result,"CONFIRMED_ABSENT");
 assert.equal(checks,1);
});
test("provider refusal, unreachable ListRooms and still-active rooms all fail closed",async()=>{
 const states=[
  {rooms:[{name:room}]},
  {rooms:null},
  null,
  {rooms:[{}]},
  {notRooms:[]},
  {rooms:["unknown"]},
 ];
 for(const providerState of states){
  await assert.rejects(
   ()=>requireSchoolOSPrepaidRoomDisconnect(room,
    async()=>{throw new Error("DeleteRoom response unclear");},
    async()=>providerState),
   (reason:unknown)=>reason instanceof AppError &&
     reason.status===503 && reason.code==="SCHOOLOS_VIDEO_PROVIDER_END_UNCONFIRMED",
  );
 }
 await assert.rejects(
  ()=>requireSchoolOSPrepaidRoomDisconnect(room,
   async()=>{throw new Error("DeleteRoom error");},
   async()=>{throw new Error("LiveKit ListRooms unavailable");}),
  (reason:unknown)=>reason instanceof AppError && reason.status===503,
 );
});
test("empty or missing room identity fails before provider operations",async()=>{
 let calls=0;
 await assert.rejects(
  ()=>requireSchoolOSPrepaidRoomDisconnect("",
   async()=>{calls++;},
   async()=>{calls++;return {rooms:[]};}),
  (reason:unknown)=>reason instanceof AppError && reason.status===422,
 );
 assert.equal(calls,0);
});
