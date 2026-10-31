import test from "node:test";
import assert from "node:assert/strict";
import {checkSafeCIContext,imageSnapshot} from "./schoolos-v5-synthetic-image-restore.mjs";

const valid={ci:"true",actions:"true",synthetic:"true",
  endpoint:"unix:///var/run/docker.sock",source:"a".repeat(40)};
test("requires bounded local GitHub ephemeral Docker engine",()=>{
 assert.equal(checkSafeCIContext(valid),true);
 for (const endpoint of ["npipe:////./pipe/docker_engine",
   "tcp://127.0.0.1:2375","ssh://server","unix:///some/other.sock"]){
   assert.equal(checkSafeCIContext({...valid,endpoint}),false);
 }
 assert.equal(checkSafeCIContext({...valid,synthetic:"false"}),false);
 assert.equal(checkSafeCIContext({...valid,ci:undefined}),false);
});
test("accepts pinned image metadata and returns only IDs and layer digests",()=>{
 const image={Id:"sha256:"+"b".repeat(64),Config:{
  WorkingDir:"/workspace/apps/api",Labels:{
   "org.opencontainers.image.revision":valid.source,
  },Env:["POSTGRES_PASSWORD=synthetic-only-test-fixture"]},
  RootFS:{Layers:["sha256:"+"c".repeat(64)]}};
 const out=imageSnapshot(image,"API","/workspace/apps/api",valid.source);
 assert.equal(out.id,image.Id);
 assert.equal(JSON.stringify(out).includes("synthetic-only-test-fixture"),false);
});
test("wrong role, source or layer list fails closed",()=>{
 const image={Id:"sha256:"+"b".repeat(64),Config:{
  WorkingDir:"/app",Labels:{"org.opencontainers.image.revision":valid.source}},
  RootFS:{Layers:[]}};
 assert.throws(()=>imageSnapshot(image,"WEB","/app",valid.source));
 assert.throws(()=>imageSnapshot({...image,RootFS:{Layers:["sha256:"+"c".repeat(64)]}},"API","/workspace/apps/api",valid.source));
});
