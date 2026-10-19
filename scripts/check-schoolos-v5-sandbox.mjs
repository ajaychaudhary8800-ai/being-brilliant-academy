#!/usr/bin/env node
import {execFileSync} from "node:child_process";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
const forbidden=["LIVEKIT_URL","LIVEKIT_API_KEY","LIVEKIT_API_SECRET","RAZORPAY_KEY_ID","RAZORPAY_KEY_SECRET","RAZORPAY_WEBHOOK_SECRET","AI_API_KEY","AI_EXAMINER_API_KEY","AI_EXAMINER_PROVIDER_URL","SMTP_PASSWORD","WHATSAPP_ACCESS_TOKEN","AWS_ACCESS_KEY_ID","AWS_SECRET_ACCESS_KEY","STAGING_DEPLOY_SSH_KEY","DEPLOY_SSH_KEY"];
const blockedFlags=["SCHOOLOS_VIDEO_ADMISSION_ENABLED","SCHOOLOS_VIDEO_SETTLEMENT_ENABLED","SCHOOLOS_VIDEO_WEBHOOK_ENABLED","SCHOOLOS_VIDEO_ZERO_RELEASE_ENABLED","SCHOOLOS_AI_METERING_ENABLED"];
const shaPattern=/^[0-9a-f]{40}$/;
function parseLocal(value,label,scheme,port){
 let u;
 try{u=new URL(value??"");}catch{throw new Error(label+" is not a URL");}
 if(!["localhost","127.0.0.1","[::1]"].includes(u.hostname)||u.protocol!==scheme||u.port!==port)
  throw new Error(label+" must be isolated localhost:"+port);
 return u;
}
export function inspectV5Sandbox(e,headSha){
 const problems=[];
 const require=(ok,reason)=>{if(!ok)problems.push(reason);};
 require(e.GITHUB_ACTIONS==="true"&&e.CI==="true","GitHub-hosted workflow required");
 require(e.NODE_ENV==="test"&&e.RUN_POSTGRES_INTEGRATION==="1","Isolated tests only");
 require(Boolean(e.SCHOOLOS_RC_SHA&&shaPattern.test(e.SCHOOLOS_RC_SHA)&&headSha===e.SCHOOLOS_RC_SHA),"Unpinned candidate commit");
 require(e.DATABASE_URL===e.TEST_DATABASE_URL,"Mismatched database URLs");
 try{
  const u=new URL(e.DATABASE_URL??"");
  require(["postgres:","postgresql:"].includes(u.protocol)&&
   ["localhost","127.0.0.1","[::1]"].includes(u.hostname)&&
   u.port==="5432"&&u.pathname==="/bba_v5_sandbox_test",
   "Only local disposable bba_v5_sandbox_test PostgreSQL is permitted");
 }catch{problems.push("Invalid test database URL");}
 try{parseLocal(e.REDIS_URL,"Redis","redis:","6379");}
 catch(error){problems.push(error.message);}
 try{parseLocal(e.WEB_URL,"Web","http:","3000");}
 catch(error){problems.push(error.message);}
 require(e.RAZORPAY_MODE===undefined||e.RAZORPAY_MODE==="test","Live payments prohibited");
 require(!e.STAGING_DEPLOY_ENABLED&&!e.PRODUCTION_DEPLOY_ENABLED,"Deploy flag prohibited");
 for(const name of forbidden)require(!e[name],name+" cannot be present in sandbox");
 for(const name of blockedFlags)require(!e[name]||e[name]==="false",name+" must be off");
 return {ok:problems.length===0,problems,kind:"GITHUB_EPHEMERAL_NOT_EXTERNAL_STAGING",candidateSha:e.SCHOOLOS_RC_SHA??null};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const sha=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
 const result=inspectV5Sandbox(process.env,sha);
 if(!result.ok){console.error("REFUSED:",result.problems.join("; "));process.exitCode=78;}
 else console.log("SAFE: isolated SchoolOS V5 sandbox, head "+sha+"; no live deployment");
}