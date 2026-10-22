import assert from "node:assert/strict";
import test from "node:test";
import {inspectV5Sandbox} from "./check-schoolos-v5-sandbox.mjs";
const sha="a".repeat(40);
const good=()=>({GITHUB_ACTIONS:"true",CI:"true",NODE_ENV:"test",RUN_POSTGRES_INTEGRATION:"1",SCHOOLOS_RC_SHA:sha,
 DATABASE_URL:"postgresql://postgres:postgres@127.0.0.1:5432/bba_v5_sandbox_test?schema=public",
 TEST_DATABASE_URL:"postgresql://postgres:postgres@127.0.0.1:5432/bba_v5_sandbox_test?schema=public",
 REDIS_URL:"redis://127.0.0.1:6379/0",WEB_URL:"http://localhost:3000",RAZORPAY_MODE:"test"});
test("only exact-head, localhost-only sandbox is approved",()=>{
 assert.equal(inspectV5Sandbox(good(),sha).ok,true);
});
test("remote databases and mismatched commits fail closed",()=>{
 for(const patch of [{SCHOOLOS_RC_SHA:"b".repeat(40)},{DATABASE_URL:"postgresql://host:5432/bba_v5_sandbox_test"},
  {DATABASE_URL:"postgresql://localhost:5432/production"},{REDIS_URL:"redis://remote:6379"},
  {WEB_URL:"https://main-staging.beingbrilliantedu.com"},{GITHUB_ACTIONS:"false"},
  {TEST_DATABASE_URL:"postgresql://localhost:5432/another_test"}]){
  assert.equal(inspectV5Sandbox({...good(),...patch},sha).ok,false,JSON.stringify(patch));
 }
});
test("provider secrets, live gateway, deploy flags and video metering refuse sandbox",()=>{
 for(const patch of [{RAZORPAY_MODE:"live"},{RAZORPAY_KEY_ID:"rzp_live_test"},
  {LIVEKIT_URL:"wss://provider.example.test"},{AI_API_KEY:"key"},{STAGING_DEPLOY_SSH_KEY:"key"},
  {SCHOOLOS_VIDEO_ADMISSION_ENABLED:"true"},{SCHOOLOS_VIDEO_WEBHOOK_ENABLED:"true"},
  {SCHOOLOS_VIDEO_SETTLEMENT_ENABLED:"true"},{STAGING_DEPLOY_ENABLED:"true"}])
  assert.equal(inspectV5Sandbox({...good(),...patch},sha).ok,false,JSON.stringify(patch));
});
