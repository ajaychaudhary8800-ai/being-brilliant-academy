#!/usr/bin/env node
import {execFileSync} from "node:child_process";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {verifySchoolOSV5ReleaseManifest} from "./check-schoolos-v5-release.mjs";

/** READY is evidence-based, never a synonym for successful Draft CI.
 * Only release-evidence or manifest files may differ from the reviewed source
 * after the immutable candidate is frozen and external acceptance recorded.
 */
export function inspectSchoolOSV5Promotion({target,gitRef,gateStatus,releaseSha,isAncestor,changedPaths}){
 const errors=[];
 if(target!=="production")errors.push("Shared legacy staging is not allowed for V5");
 if(!/^refs\/tags\/v5\.[0-9]+\.[0-9]+(?:\.[0-9]+)?(?:-[a-zA-Z0-9.-]+)?$/.test(gitRef??""))
  errors.push("V5 production requires an approved v5.* tag, never workflow_dispatch");
 if(gateStatus!=="READY")errors.push("Ten independently verified release gates required");
 if(!/^[0-9a-f]{40}$/.test(releaseSha??""))errors.push("Candidate source SHA must be pinned");
 if(isAncestor!==true)errors.push("Signed source commit must be an ancestor of deployment");
 for(const path of changedPaths??[]){
  if(path!=="config/schoolos-v5-release-gates.json"&&
     !/^release-evidence\/v5\/[a-zA-Z0-9/_-]+\.json$/.test(path))
   errors.push("Code modified after acceptance: "+path);
 }
 return {approved:errors.length===0,errors};
}
async function run(){
 if(process.argv[2]!=="--target=production")
  throw new Error("V5 cannot be promoted through shared legacy staging");
 const root=resolve(process.cwd());
 const manifest=JSON.parse(await readFile(resolve(root,"config/schoolos-v5-release-gates.json"),"utf8"));
 const proof=await verifySchoolOSV5ReleaseManifest(manifest,root);
 if(proof.errors.length)throw new Error("Invalid release evidence: "+proof.errors.join("; "));
 const git=(...args)=>execFileSync("git",args,{encoding:"utf8"}).trim();
 let isAncestor=false,changedPaths=[];
 const pin=manifest.releaseCandidateSha;
 if(typeof pin==="string" && /^[0-9a-f]{40}$/.test(pin)){
  try{
   git("merge-base","--is-ancestor",pin,"HEAD");
   isAncestor=true;
   changedPaths=git("diff","--name-only",pin,"HEAD").split("\n").filter(Boolean);
  }catch{isAncestor=false;}
 }
 const decision=inspectSchoolOSV5Promotion({
  target:"production",gitRef:process.env.GITHUB_REF,gateStatus:proof.status,
  releaseSha:pin,isAncestor,changedPaths,
 });
 if(!decision.approved)throw new Error("V5 PRODUCTION HOLD: "+decision.errors.join("; "));
 console.log("Evidence-verified V5 source accepted; protected production environment approval remains required");
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 run().catch(e=>{console.error(String(e));process.exitCode=1;});
