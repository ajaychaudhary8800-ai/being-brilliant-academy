import test from "node:test";
import assert from "node:assert/strict";
import {checkComposeBuildArgumentPolicy,checkSourceDockerfileArgs} from "./schoolos-v5-build-arg-policy.mjs";

function fixture() {
  return {services:{
    api:{build:{args:{SCHOOLOS_BUILD_REVISION:"unattested"}}},
    migrate:{build:{args:{SCHOOLOS_BUILD_REVISION:"unattested"}}},
    web:{build:{args:{SCHOOLOS_BUILD_REVISION:"unattested",NEXT_PUBLIC_API_URL:"/api/v1"}}},
    nginx:{build:{context:"."}},backup:{build:{context:"."}}}};
}
test("only approved public revision/routing build arguments pass",()=>{
 const r=checkComposeBuildArgumentPolicy(fixture());
 assert.equal(r.status,"PASS_SOURCE_BUILD_ARGS_ONLY");
 assert.equal(r.coolifyBuildSettingsVerified,false);
});
test("reject unexpected secret build argument without printing its value",()=>{
 const x=fixture();const marker="fixture-test-secret";
 x.services.web.build.args.POSTGRES_PASSWORD=marker;
 const r=checkComposeBuildArgumentPolicy(x);
 assert.equal(r.status,"FAIL");
 assert.deepEqual(r.reasons,["MALFORMED_BUILD_ARGS_WEB","UNREVIEWED_BUILD_ARGS_WEB"]);
 assert.equal(JSON.stringify(r).includes(marker),false);
});
test("reject extra args even if value blank and on migrate",()=>{
 const x=fixture();x.services.migrate.build.args.DATABASE_URL="";
 assert.equal(checkComposeBuildArgumentPolicy(x).status,"FAIL");
});
test("reject missing required declared revision argument and service",()=>{
 const x=fixture();delete x.services.api.build.args.SCHOOLOS_BUILD_REVISION;
 delete x.services.backup;
 const r=checkComposeBuildArgumentPolicy(x);
 assert.equal(r.status,"FAIL");
 assert.ok(r.reasons.includes("MISSING_SERVICE_BACKUP"));
 assert.ok(r.reasons.includes("UNREVIEWED_BUILD_ARGS_API"));
});
test("never print malformed environment or raw document",()=>{
 const x=fixture();x.services.web.build.args.SCHOOLOS_BUILD_REVISION="secret\nexpanded";
 const r=checkComposeBuildArgumentPolicy(x);
 assert.equal(r.status,"FAIL");
 assert.equal(JSON.stringify(r).includes("secret"),false);
});

test("Dockerfile ARG declarations match exactly expected non-secret inputs",()=>{
 const api="FROM node:22-alpine AS runtime\nARG SCHOOLOS_BUILD_REVISION=unattested\n";
 const web="ARG NEXT_PUBLIC_API_URL=/api/v1\nFROM node:22-alpine\nARG SCHOOLOS_BUILD_REVISION=unattested\n";
 assert.equal(checkSourceDockerfileArgs(api,["SCHOOLOS_BUILD_REVISION"]).status,
   "PASS_SOURCE_DOCKERFILE_ARGS_ONLY");
 assert.equal(checkSourceDockerfileArgs(web,["NEXT_PUBLIC_API_URL","SCHOOLOS_BUILD_REVISION"]).status,
   "PASS_SOURCE_DOCKERFILE_ARGS_ONLY");
});
test("Dockerfile secret ARG declaration vetoes without exposing values",()=>{
 const s="ARG SCHOOLOS_BUILD_REVISION=unattested\nARG POSTGRES_PASSWORD=secret-fixture\n";
 const r=checkSourceDockerfileArgs(s,["SCHOOLOS_BUILD_REVISION"]);
 assert.equal(r.status,"FAIL");
 assert.equal(JSON.stringify(r).includes("secret-fixture"),false);
});
test("malformed and missing Dockerfile ARGs fail closed",()=>{
 assert.equal(checkSourceDockerfileArgs("",["SCHOOLOS_BUILD_REVISION"]).status,"FAIL");
 assert.equal(checkSourceDockerfileArgs("ARG SECRET BROKEN",[]).status,"FAIL");
 assert.equal(checkSourceDockerfileArgs("FROM node:22-alpine",["SCHOOLOS_BUILD_REVISION"]).status,"FAIL");
});
