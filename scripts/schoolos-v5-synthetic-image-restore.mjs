#!/usr/bin/env node
/** Disposable CI-only API/Web image archive save/load round-trip. Never run
 * against deployed V5: this deletes and restores two fixed TEST-ONLY tags.
 * No image config, history, environment, registry URI, Docker stderr or
 * credentials are emitted. Does not start any container or contact V5. */
import { spawnSync } from "node:child_process";
import { createReadStream, mkdtempSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const TAGS = [
  ["API", "schoolos-v5-ci-api:verification", "/workspace/apps/api"],
  ["WEB", "schoolos-v5-ci-web:verification", "/app"]
];
export function checkSafeCIContext({ci,actions,synthetic,endpoint,source}) {
  return ci==="true" && actions==="true" && synthetic==="true"
    && typeof endpoint==="string"
    && /^unix:\/\/\/(?:var\/run|run)\/docker\.sock$/.test(endpoint)
    && /^[0-9a-f]{40}$/.test(source??"");
}
function exec(args,allowFailure=false) {
  const p=spawnSync("docker",["--context","default",...args],{
    encoding:"utf8",timeout:120000,maxBuffer:2*1024*1024,
  });
  if (p.error || (!allowFailure && p.status!==0)) throw new Error("DOCKER_ACTION_FAILED");
  return p;
}
export function imageSnapshot(data,role,workdir,source) {
  if (!data || data?.Config?.WorkingDir!==workdir ||
      data?.Config?.Labels?.["org.opencontainers.image.revision"]!==source ||
      !/^sha256:[a-f0-9]{64}$/.test(data?.Id??"") ||
      !Array.isArray(data?.RootFS?.Layers) || !data.RootFS.Layers.length)
    throw new Error("IMAGE_METADATA_INVALID_"+role);
  return {role,id:data.Id,layers:[...data.RootFS.Layers]};
}
function inspect(tag,role,wd,source) {
  const result=JSON.parse(exec(["image","inspect",tag]).stdout);
  if (!Array.isArray(result)||result.length!==1)throw new Error("IMAGE_INSPECTION_INVALID");
  return imageSnapshot(result[0],role,wd,source);
}
async function sha256(path){
 const h=createHash("sha256");
 for await(const chunk of createReadStream(path))h.update(chunk);
 return h.digest("hex");
}
async function main(){
  const source=process.env.SCHOOLOS_BUILD_REVISION;
  const endpoint=exec(["context","inspect","default","--format",
    "{{.Endpoints.docker.Host}}"]).stdout.trim();
  if(!checkSafeCIContext({
    ci:process.env.CI,actions:process.env.GITHUB_ACTIONS,
    synthetic:process.env.BBA_SYNTHETIC_BUILD,endpoint,source,
  })) throw new Error("NONLOCAL_OR_NONDISPOSABLE_CONTEXT");
  const original=TAGS.map(([role,tag,wd])=>inspect(tag,role,wd,source));
  const dir=mkdtempSync(join(tmpdir(),"schoolos-v5-ci-restore-"));
  chmodSync(dir,0o700);
  const archive=join(dir,"synthetic-api-web.tar");
  try{
    exec(["image","save","--output",archive,...TAGS.map(x=>x[1])]);
    const priorHash=await sha256(archive);
    // Remove ONLY the two uniquely named disposable CI image tags on an
    // ephemeral GitHub Actions runner; never remove source or live images.
    for(const [role,tag] of TAGS){
      exec(["image","rm",tag]);
      if(exec(["image","inspect",tag],true).status===0)
        throw new Error("CI_IMAGE_TAG_STILL_PRESENT_"+role);
    }
    exec(["image","load","--input",archive]);
    const restored=TAGS.map(([role,tag,wd])=>inspect(tag,role,wd,source));
    const afterHash=await sha256(archive);
    for(let i=0;i<original.length;i++){
      if(original[i].id!==restored[i].id ||
         JSON.stringify(original[i].layers)!==JSON.stringify(restored[i].layers))
        throw new Error("IMPORTED_IMAGE_ID_OR_ROOTFS_MISMATCH");
    }
    if(priorHash!==afterHash)throw new Error("ARCHIVE_CHECKSUM_DRIFT");
    console.log("CI_SYNTHETIC_API_WEB_IMAGE_ROUNDTRIP=PASS");
    console.log("EXACT_SOURCE_REVISION_CHECK=PASS");
    console.log("IMAGE_IDS_AND_ROOTFS_MATCH=PASS");
    console.log("ARCHIVE_SHA256="+afterHash);
    console.log("LIVE_STAGING_ARCHIVE_TESTED=NO");
    console.log("SIGNED_PROVENANCE_VERIFIED=NO");
    console.log("PREVIOUS_VERSION_ROLLBACK_VERIFIED=NO");
    console.log("CUSTOMER_DATA_ACCESSED=NO");
    console.log("REAL_CREDENTIAL_VALUES_PRINTED=NO");
    console.log("LIVE_SERVICES_CHANGED=NO");
  }finally{rmSync(dir,{recursive:true,force:true});}
}
if(process.argv[1]?.endsWith("schoolos-v5-synthetic-image-restore.mjs")){
  main().catch(()=>{console.error("CI_SYNTHETIC_IMAGE_ROUNDTRIP=CHECK_REQUIRED_NO_VALUES_PRINTED");
    process.exitCode=1;});
}
