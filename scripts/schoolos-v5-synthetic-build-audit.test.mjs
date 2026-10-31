import test from "node:test";
import assert from "node:assert/strict";
import {reviewFreshBuild} from "./schoolos-v5-synthetic-build-audit.mjs";
const sha="a".repeat(40);
function x(role="API"){return {Id:"sha256:"+"b".repeat(64),
  Config:{WorkingDir:role==="API"?"/workspace/apps/api":"/app",
    Labels:{"org.opencontainers.image.revision":sha},Env:["NODE_ENV=production"]},
  RootFS:{Layers:["sha256:"+"c".repeat(64)]}};}
test("disposable validated source-only history passes narrowly",()=>{
 const r=reviewFreshBuild({image:x(),history:["RUN apk add --no-cache curl"],role:"API",source:sha});
 assert.equal(r.status,"PASS_METADATA_ONLY");assert.equal(r.signedImageProvenance,false);
});
test("reject builder leaked secret without printing value",()=>{
 const secret="secret-fixture-should-never-print";
 const r=reviewFreshBuild({image:x(),history:["RUN |57 DATABASE_URL=postgresql://name:"+secret+"@db REDIS_PASSWORD="+secret+" /bin/sh -c noop"],role:"API",source:sha});
 assert.equal(r.status,"FAIL");assert.equal(JSON.stringify(r).includes(secret),false);
 assert.ok(r.reasons.includes("SECRET_ASSIGNMENT_IN_IMAGE_HISTORY"));
});
test("reject baked image Env and mismatched revision",()=>{
 const image=x("WEB");
 image.Config.Env.push("POSTGRES_PASSWORD=fixture-hidden");
 const r=reviewFreshBuild({image,history:["RUN true"],role:"WEB",source:"b".repeat(40)});
 assert.equal(r.status,"FAIL");assert.ok(r.reasons.includes("SENSITIVE_IMAGE_ENV"));
 assert.ok(r.reasons.includes("BUILD_SOURCE_LABEL_MISMATCH"));
 assert.equal(JSON.stringify(r).includes("fixture-hidden"),false);
});
test("reject absent image roots and malformed image history",()=>{
 const image=x();image.RootFS={Layers:[]};
 const r=reviewFreshBuild({image,history:[],role:"API",source:sha});
 assert.equal(r.status,"FAIL");assert.ok(r.reasons.includes("ROOTFS_MISSING"));
 assert.ok(r.reasons.includes("HISTORY_MISSING"));
});
