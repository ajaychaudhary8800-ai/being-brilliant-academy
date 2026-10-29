import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp,mkdir,readFile,writeFile,rm} from "node:fs/promises";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {test} from "node:test";
import {REQUIRED_SCHOOLOS_V5_GATES,verifySchoolOSV5ReleaseManifest} from "./check-schoolos-v5-release.mjs";

const realRoot=resolve(import.meta.dirname,"..");
const readCurrent=async()=>JSON.parse(await readFile(
 resolve(realRoot,"config/schoolos-v5-release-gates.json"),"utf8"));
const sha="a".repeat(40);
async function fixture(mutator){
 const root=await mkdtemp(join(tmpdir(),"schoolos-v5-go-"));
 try{
  await mkdir(join(root,"release-evidence/v5"),{recursive:true});
  const gates=REQUIRED_SCHOOLOS_V5_GATES.map(id=>({
   id,name:"Evidence gate "+id,status:"VERIFIED",evidence:[],
  }));
  const manifest={schemaVersion:1,product:"Adhyay SchoolOS",version:"5.0",
   releaseCandidateSha:sha,declaredStatus:"READY",gates};
  for(const gate of gates){
   const relative="release-evidence/v5/"+gate.id+".json";
   const evidence={product:"Adhyay SchoolOS",version:"5.0",
    gateId:gate.id,releaseCandidateSha:sha,result:"PASS",
    verifiedBy:"independent-qa@example.test",verifiedAt:"2026-10-19T12:00:00Z",
    summary:"Independent staged acceptance for "+gate.id+" with provenance."};
   if(gate.id==="customer_uat"){
    // Restricted signed records live outside Git. These are NON-SECRET
    // synthetic references used only to exercise the metadata gate.
    evidence.customerUat={
     institutionRelationship:"INDEPENDENT_EXTERNAL",
     institutionReference:"restricted-external-institution-001",
     signedAcceptanceReference:"restricted-signed-customer-uat-001",
    };
   }
   const raw=JSON.stringify(evidence);
   await writeFile(join(root,relative),raw);
   gate.evidence.push({path:relative,sha256:createHash("sha256").update(raw).digest("hex")});
  }
  await mutator?.(manifest,root);
  return await verifySchoolOSV5ReleaseManifest(manifest,root);
 }finally{await rm(root,{recursive:true,force:true});}
}
test("V5 release is HOLD even though V4 and V5 Draft CI tests pass",async()=>{
 const manifest=await readCurrent();
 const result=await verifySchoolOSV5ReleaseManifest(manifest,realRoot);
 assert.equal(result.status,"HOLD");
 assert.equal(result.verified,0);
 assert.equal(result.total,10);
 assert.equal(result.blockers.length,10);
 assert.deepEqual(result.errors,[]);
});
test("full pinned GO evidence is structurally accepted only when every gate passes",async()=>{
 const result=await fixture();
 assert.equal(result.status,"READY");
 assert.deepEqual(result.errors,[]);
 assert.equal(result.verified,10);
});
test("partial evidence cannot be falsely declared ready",async()=>{
 const result=await fixture(async m=>{
  m.gates[0].status="PENDING";
  m.gates[0].evidence=[];
  m.gates[0].nextAction="Complete version 5 integration review and acceptance tests";
 });
 assert.equal(result.status,"INVALID");
 assert.match(result.errors.join(" "),/declaredStatus=READY/);
});
test("unverified evidence file content invalidates GO",async()=>{
 const result=await fixture(async(m,root)=>{
  await writeFile(join(root,m.gates[0].evidence[0].path),"tampered");
 });
 assert.equal(result.status,"INVALID");
 assert.match(result.errors.join(" "),/SHA-256 differs/);
});
test("evidence for a different candidate commit cannot validate this release",async()=>{
 const result=await fixture(async(m,root)=>{
  const file=join(root,m.gates[0].evidence[0].path);
  const data=JSON.parse(await readFile(file,"utf8"));
  data.releaseCandidateSha="b".repeat(40);
  const raw=JSON.stringify(data);
  await writeFile(file,raw);
  m.gates[0].evidence[0].sha256=createHash("sha256").update(raw).digest("hex");
 });
 assert.equal(result.status,"INVALID");
 assert.match(result.errors.join(" "),/release SHA invalid/);
});
test("path traversal, duplicate IDs, unverifiable signoff and missing gates cannot mark READY",async()=>{
 const invalidPath=await fixture(async m=>{m.gates[0].evidence[0].path="../escape.json"});
 assert.equal(invalidPath.status,"INVALID");
 assert.match(invalidPath.errors.join(" "),/path must be/);
 const duplicate=await fixture(async m=>{m.gates[1].id=m.gates[0].id});
 assert.equal(duplicate.status,"INVALID");
 assert.match(duplicate.errors.join(" "),/Duplicate release gate/);
 const fakeSignoff=await fixture(async(m,root)=>{
  const file=join(root,m.gates[0].evidence[0].path);
  const obj=JSON.parse(await readFile(file,"utf8"));
  obj.verifiedBy="ChatGPT";
  const raw=JSON.stringify(obj);
  await writeFile(file,raw);
  m.gates[0].evidence[0].sha256=createHash("sha256").update(raw).digest("hex");
 });
 assert.equal(fakeSignoff.status,"INVALID");
 assert.match(fakeSignoff.errors.join(" "),/not sufficient/);
});

test("owner-operated BBA pilot UAT cannot be used to declare paid commercial release READY",async()=>{
 const result=await fixture(async(m,root)=>{
  const gate=m.gates.find(g=>g.id==="customer_uat");
  const path=join(root,gate.evidence[0].path);
  const record=JSON.parse(await readFile(path,"utf8"));
  record.customerUat.institutionRelationship="OWNER_OPERATED_INTERNAL";
  const raw=JSON.stringify(record);
  await writeFile(path,raw);
  gate.evidence[0].sha256=createHash("sha256").update(raw).digest("hex");
 });
 assert.equal(result.status,"INVALID");
 assert.match(result.errors.join(" "),/independent external institution/);
});

test("missing customer UAT signed-acceptance reference remains a release veto",async()=>{
 const result=await fixture(async(m,root)=>{
  const gate=m.gates.find(g=>g.id==="customer_uat");
  const path=join(root,gate.evidence[0].path);
  const record=JSON.parse(await readFile(path,"utf8"));
  delete record.customerUat.signedAcceptanceReference;
  const raw=JSON.stringify(record);
  await writeFile(path,raw);
  gate.evidence[0].sha256=createHash("sha256").update(raw).digest("hex");
 });
 assert.equal(result.status,"INVALID");
 assert.match(result.errors.join(" "),/signed acceptance references/);
});

test("generic reviewer signature without external-customer UAT metadata cannot mark READY",async()=>{
 const result=await fixture(async(m,root)=>{
  const gate=m.gates.find(g=>g.id==="customer_uat");
  const path=join(root,gate.evidence[0].path);
  const record=JSON.parse(await readFile(path,"utf8"));
  delete record.customerUat;
  const raw=JSON.stringify(record);
  await writeFile(path,raw);
  gate.evidence[0].sha256=createHash("sha256").update(raw).digest("hex");
 });
 assert.equal(result.status,"INVALID");
 assert.match(result.errors.join(" "),/independent external institution/);
});
