#!/usr/bin/env node
/**
 * Version 5 RELEASE gate, not a code-completion estimate. A green Draft-PR CI
 * cannot authorize a customer deployment. By default this reports HOLD without
 * failing developer CI; --require-ready fails unless every verified gate passes.
 */
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import process from "node:process";

export const REQUIRED_SCHOOLOS_V5_GATES = Object.freeze([
 "draft_chain_integration","release_candidate_ci","staging_migration_restore",
 "subscription_payment_qa","ai_video_provider_qa","security_privacy_tenant_qa",
 "customer_uat","operational_support","commercial_legal_finance",
 "production_owner_approval",
]);
const VALID_STATUSES=new Set(["PENDING","VERIFIED"]);
const COMMIT=/^[0-9a-f]{40}$/i;
const SHA=/^[0-9a-f]{64}$/i;
const ISO_UTC=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export async function verifySchoolOSV5ReleaseManifest(manifest,root) {
 const errors=[];
 if(!manifest || typeof manifest!=="object" || Array.isArray(manifest))
  return {status:"INVALID",errors:["Expected a release manifest JSON object"],blockers:[],verified:0,total:0};
 if(manifest.schemaVersion!==1)errors.push("schemaVersion must be 1");
 if(manifest.product!=="Adhyay SchoolOS"||manifest.version!=="5.0")
  errors.push("Manifest must be for Adhyay SchoolOS Version 5.0");
 if(manifest.declaredStatus!=="HOLD" && manifest.declaredStatus!=="READY")
  errors.push("declaredStatus must be HOLD or READY");
 const commitValid=typeof manifest.releaseCandidateSha==="string"&&COMMIT.test(manifest.releaseCandidateSha);
 if(manifest.releaseCandidateSha!==null && !commitValid)
  errors.push("releaseCandidateSha must be null or a full 40-character commit SHA");
 if(!Array.isArray(manifest.gates))errors.push("gates must be an array");
 const gates=Array.isArray(manifest.gates)?manifest.gates:[];
 const seen=new Set();
 let verified=0;
 const blockers=[];
 for(const gate of gates){
  if(!gate || typeof gate!=="object"){
   errors.push("Each release gate must be an object");
   continue;
  }
  if(typeof gate.id!=="string"||!REQUIRED_SCHOOLOS_V5_GATES.includes(gate.id))
   errors.push("Unexpected release gate ID: "+String(gate.id));
  else if(seen.has(gate.id))errors.push("Duplicate release gate: "+gate.id);
  seen.add(gate.id);
  if(typeof gate.name!=="string"||gate.name.trim().length<8)
   errors.push(String(gate.id)+": name required");
  if(!VALID_STATUSES.has(gate.status))
   errors.push(String(gate.id)+": invalid status "+String(gate.status));
  if(!Array.isArray(gate.evidence))
   errors.push(String(gate.id)+": evidence must be an array");
  if(gate.status==="PENDING"){
   blockers.push(gate.id);
   if(typeof gate.nextAction!=="string"||gate.nextAction.trim().length<15)
    errors.push(gate.id+": pending gate requires a specific nextAction");
   if(Array.isArray(gate.evidence)&&gate.evidence.length)
    errors.push(gate.id+": pending gate cannot claim verified evidence");
   continue;
  }
  if(gate.status!=="VERIFIED")continue;
  verified++;
  if(!commitValid)errors.push(gate.id+": verified gates require pinned releaseCandidateSha");
  if(!Array.isArray(gate.evidence)||gate.evidence.length===0){
   errors.push(gate.id+": verified gate requires independent evidence");
   continue;
  }
  for(const ev of gate.evidence){
   const label=gate.id+": evidence";
   if(!ev||typeof ev!=="object"){
    errors.push(label+" must be a structured object");continue;
   }
   if(typeof ev.path!=="string"||
      !/^release-evidence\/v5\/[a-zA-Z0-9/_-]+\.json$/.test(ev.path) ||
      ev.path.includes("..") || isAbsolute(ev.path)){
    errors.push(label+" path must be a local release-evidence/v5/*.json file");continue;
   }
   if(!SHA.test(ev.sha256??"")){
    errors.push(label+" sha256 must be a real 64-character hex digest");continue;
   }
   try{
    const base=await realpath(resolve(root,"release-evidence","v5"));
    const exact=await realpath(resolve(root,ev.path));
    const rel=relative(base,exact);
    if(rel===""||rel===".."||rel.startsWith(".."+sep)||isAbsolute(rel))
     throw new Error("Evidence escapes release-evidence/v5");
    const raw=await readFile(exact);
    const actual=createHash("sha256").update(raw).digest("hex");
    if(actual!==ev.sha256.toLowerCase())
     throw new Error("Evidence SHA-256 differs from manifest");
    const record=JSON.parse(raw.toString("utf8"));
    if(record.product!=="Adhyay SchoolOS"||record.version!=="5.0"||
       record.gateId!==gate.id||record.releaseCandidateSha!==manifest.releaseCandidateSha||
       record.result!=="PASS" || typeof record.verifiedBy!=="string" ||
       record.verifiedBy.trim().length<3 || !ISO_UTC.test(record.verifiedAt??"")||
       !Number.isFinite(Date.parse(record.verifiedAt))||
       typeof record.summary!=="string"||record.summary.trim().length<30)
      throw new Error("Evidence metadata, independent reviewer or release SHA invalid");
    if(record.verifiedBy==="ChatGPT"||record.verifiedBy==="automated")
     throw new Error("Unattributed AI/tool-generated release proof is not sufficient");
    // Gate 7 of the PAID commercial release requires real external institution
    // acceptance. Owner-operated BBA internal pilot UAT has its own handoff,
    // but must never silently satisfy the independent customer acceptance gate.
    // This is structural metadata validation, NOT signature verification:
    // human reviewers must still inspect the restricted signed source record.
    if(gate.id==="customer_uat"){
     const uat=record.customerUat;
     const validRef=value=>typeof value==="string" &&
      /^[A-Za-z0-9][A-Za-z0-9:/._-]{11,199}$/.test(value) &&
      !value.includes("..") && !value.includes("//");
     if(!uat||typeof uat!=="object"||Array.isArray(uat)||
        uat.institutionRelationship!=="INDEPENDENT_EXTERNAL"||
        !validRef(uat.institutionReference)||
        !validRef(uat.signedAcceptanceReference))
      throw new Error("Customer UAT requires independent external institution and signed acceptance references");
    }
   }catch(error){
    errors.push(label+" invalid: "+(error instanceof Error?error.message:String(error)));
   }
  }
 }
 for(const id of REQUIRED_SCHOOLOS_V5_GATES)
  if(!seen.has(id))errors.push("Missing required release gate: "+id);
 if(gates.length!==REQUIRED_SCHOOLOS_V5_GATES.length)
  errors.push("Release must have exactly ten required gates");
 const expected=blockers.length===0 && verified===REQUIRED_SCHOOLOS_V5_GATES.length &&
   commitValid && errors.length===0?"READY":"HOLD";
 if(manifest.declaredStatus!==expected)
  errors.push("declaredStatus="+manifest.declaredStatus+" conflicts with verified status "+expected);
 return {status:errors.length?"INVALID":expected,errors,blockers,
   verified,total:REQUIRED_SCHOOLOS_V5_GATES.length,releaseCandidateSha:manifest.releaseCandidateSha};
}
async function main(){
 const root=resolve(process.cwd());
 let parsed;
 try{
  parsed=JSON.parse(await readFile(resolve(root,"config/schoolos-v5-release-gates.json"),"utf8"));
 }catch(error){
  console.error("V5 release manifest is missing or invalid:",error);
  process.exitCode=2;return;
 }
 const result=await verifySchoolOSV5ReleaseManifest(parsed,root);
 console.log("Adhyay SchoolOS V5 release status: "+result.status);
 console.log("Evidence-verified release gates: "+result.verified+"/"+result.total);
 console.log("Release candidate: "+(result.releaseCandidateSha??"NOT PINNED"));
 for(const blocker of result.blockers)
  console.log("HOLD: "+blocker);
 for(const error of result.errors)console.error("INVALID: "+error);
 if(result.errors.length)process.exitCode=2;
 else if(process.argv.includes("--require-ready") && result.status!=="READY"){
  console.error("SchoolOS V5 must NOT deploy: release evidence is incomplete.");
  process.exitCode=1;
 }
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 await main();
