import assert from "node:assert/strict";
import test from "node:test";
import { mapSchoolDayCopy, type BellCopySlot } from "./school-day-copy.js";

const source:BellCopySlot[]=[
 { periodNumber:1,startMinute:480,endMinute:500,type:"BREAK",label:"Assembly",isActive:true },
 { periodNumber:2,startMinute:500,endMinute:540,type:"TEACHING",label:null,isActive:true },
 { periodNumber:3,startMinute:540,endMinute:560,type:"BREAK",label:"Lunch",isActive:true },
 { periodNumber:4,startMinute:560,endMinute:600,type:"TEACHING",label:null,isActive:true },
];
const lesson=(overrides:Record<string,unknown>={})=>({id:"t1",periodNumber:2,startMinute:500,endMinute:540,subjectId:"math",teacherId:"teacher1",...overrides});
test("copy matches teaching and breaks while preserving original source lessons",()=>{
 const target=source.map(p=>({...p,startMinute:p.startMinute+10,endMinute:p.endMinute+10}));
 const before=lesson();const copied=mapSchoolDayCopy(source,target,[before]);
 assert.equal(copied[0].startMinute,510);
 assert.equal(copied[0].endMinute,550);
 assert.equal(copied[0].subjectId,"math");
 assert.equal(before.startMinute,500);
});
test("reject missing period or mismatched break labels",()=>{
 assert.throws(()=>mapSchoolDayCopy(source,source.slice(1),[lesson()]),/matching configured/);
 assert.throws(()=>mapSchoolDayCopy(source,source.map(p=>p.periodNumber===3?{...p,label:"Sports"}:p),[lesson()]),/break labels/);
});
test("reject changing a teaching period to a break",()=>{
 assert.throws(()=>mapSchoolDayCopy(source,source.map(p=>p.periodNumber===2?{...p,type:"BREAK"}:p),[lesson()]),/break labels/);
});
test("reject empty source, duplicate or unconfigured lessons",()=>{
 assert.throws(()=>mapSchoolDayCopy(source,source,[]),/saved teaching/);
 assert.throws(()=>mapSchoolDayCopy(source,source,[lesson(),lesson()]),/duplicate periods/);
 assert.throws(()=>mapSchoolDayCopy(source,source,[lesson({periodNumber:3})]),/active teaching/);
});
