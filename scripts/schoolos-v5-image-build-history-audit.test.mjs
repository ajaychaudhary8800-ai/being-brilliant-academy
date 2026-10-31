import test from "node:test";
import assert from "node:assert/strict";
import {reviewImage,reviewSupportingImage,sensitiveAssignments} from "./schoolos-v5-image-build-history-audit.mjs";

const id="sha256:"+"a".repeat(64), sha="b".repeat(40);
function fake(role="WEB") {
  return {Id:id,Config:{WorkingDir:role==="API"?"/workspace/apps/api":"/app",
    Env:["NODE_ENV=production"],Labels:{
      "org.opencontainers.image.revision":sha,
      "com.docker.compose.project":"96ffcu0jinuwlnaqxpltln4p",
      "com.docker.compose.service":role.toLowerCase()}}};
}
function review(image=fake(),history=["RUN apk add --no-cache tini"],role="WEB"){
  return reviewImage({image,history,id,sha,role});
}
test("benign metadata narrowly passes without attestation",()=>{
  const x=review(fake(),["ARG SCHOOLOS_BUILD_REVISION=unattested","RUN pnpm install"]);
  assert.equal(x.status,"PASS_METADATA_ONLY"); assert.equal(x.launchAuthorized,false);
});
test("BuildKit secret assignments cause fail with key names only",()=>{
  const secret="fixture-hidden-sentinel";
  const x=review(fake(),[`RUN |57 POSTGRES_PASSWORD=${secret} REDIS_PASSWORD=${secret} DATABASE_URL=postgresql://u:${secret}@postgres/db /bin/sh -c build`]);
  assert.equal(x.status,"FAIL");
  assert.deepEqual(x.sensitiveKeyNames,["DATABASE_URL","POSTGRES_PASSWORD","REDIS_PASSWORD"]);
  assert.equal(JSON.stringify(x).includes(secret),false);
});
test("bare ARG names are not passwords",()=>{
  assert.deepEqual(sensitiveAssignments(["ARG POSTGRES_PASSWORD","ARG REDIS_PASSWORD"]),[]);
});
test("image Config.Env credentials fail even if history does not include them",()=>{
  const x=fake(); x.Config.Env.push("POSTGRES_PASSWORD=private-fixture");
  const y=review(x);
  assert.equal(y.status,"FAIL");
  assert.deepEqual(y.imageEnvKeyNames,["POSTGRES_PASSWORD"]);
  assert.ok(!JSON.stringify(y).includes("private-fixture"));
});
test("wrong project, source revision and unreadable history fail closed",()=>{
  const x=fake();x.Config.Labels["org.opencontainers.image.revision"]="c".repeat(40);
  x.Config.Labels["com.docker.compose.project"]="unknown";
  const y=review(x,[]);
  assert.deepEqual(y.reasons,["PROJECT_MISMATCH","REVISION_MISMATCH","UNREADABLE_HISTORY"]);
});

test("backup and proxy image histories are independently scanned",()=>{
  for(const role of ["BACKUP","NGINX"]){
    const image={Id:id,Config:{Env:["PATH=/usr/bin"]}};
    const r=reviewSupportingImage({image,id,role,history:["RUN |57 DATABASE_URL=postgresql://u:sensitive-fixture@db /bin/sh -c true"]});
    assert.equal(r.status,"FAIL");
    assert.deepEqual(r.sensitiveKeyNames,["DATABASE_URL"]);
    assert.ok(!JSON.stringify(r).includes("sensitive-fixture"));
  }
});
test("support images reject unexpected Config.Env secret and ID mismatch",()=>{
 const image={Id:"sha256:"+"c".repeat(64),Config:{Env:["REDIS_PASSWORD=synthetic-private"]}};
 const r=reviewSupportingImage({image,id,role:"NGINX",history:["RUN chmod 0755 /etc/nginx/nginx.conf"]});
 assert.equal(r.status,"FAIL");
 assert.ok(r.reasons.includes("SUPPORT_IMAGE_ID_MISMATCH"));
 assert.ok(r.reasons.includes("SENSITIVE_IMAGE_CONFIG_ENV"));
 assert.deepEqual(r.imageEnvKeyNames,["REDIS_PASSWORD"]);
 assert.equal(JSON.stringify(r).includes("synthetic-private"),false);
});
test("benign supporting image metadata passes without claiming signed provenance",()=>{
 const image={Id:id,Config:{Env:["PATH=/usr/bin"]}};
 const r=reviewSupportingImage({image,id,role:"BACKUP",history:["RUN apk add --no-cache dcron"]});
 assert.equal(r.status,"PASS_METADATA_ONLY");
 assert.equal(r.sourceImageProvenanceVerified,false);
 assert.equal(r.layersInspected,false);
});
