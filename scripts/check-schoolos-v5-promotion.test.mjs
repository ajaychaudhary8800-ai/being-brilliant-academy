import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {inspectSchoolOSV5Promotion} from "./check-schoolos-v5-promotion.mjs";
const valid=()=>({target:"production",gitRef:"refs/tags/v5.0.0",gateStatus:"READY",
 releaseSha:"a".repeat(40),isAncestor:true,
 changedPaths:["config/schoolos-v5-release-gates.json","release-evidence/v5/finance/approval.json"]});
test("release-only evidence changes on signed tagged V5 source can pass",()=>{
 assert.equal(inspectSchoolOSV5Promotion(valid()).approved,true);
});
test("unapproved, ref-less or branch dispatch cannot release V5",()=>{
 for(const patch of [{gateStatus:"HOLD"},{gateStatus:"INVALID"},
  {target:"shared-staging"},{gitRef:"refs/heads/main"},
  {gitRef:"refs/heads/feature/schoolos-v5"},
  {gitRef:"refs/tags/v4.0.0"},{isAncestor:false},{releaseSha:null}]){
  assert.equal(inspectSchoolOSV5Promotion({...valid(),...patch}).approved,false,JSON.stringify(patch));
 }
});
test("post-approval code, database, workflow or path-traversal changes veto promotion",()=>{
 for(const path of ["apps/api/src/server.ts","apps/web/app/page.tsx",
  "apps/api/prisma/schema.prisma",".github/workflows/deploy.yml",
  "scripts/check-schoolos-v5-release.mjs","release-evidence/v4/approval.json",
  "release-evidence/v5/../fraud.json"]){
  assert.equal(inspectSchoolOSV5Promotion({...valid(),changedPaths:[path]}).approved,false,path);
 }
});
test("production gate precedes any registry push, V5 is forbidden in shared staging",async()=>{
 const prod=await readFile(new URL("../.github/workflows/deploy.yml",import.meta.url),"utf8");
 const stage=await readFile(new URL("../.github/workflows/staging.yml",import.meta.url),"utf8");
 assert.match(prod,/node scripts\/check-schoolos-v5-promotion\.mjs --target=production/);
 assert.match(prod,/GITHUB_REF.*refs\/tags\/v5\.\*/);
 assert.match(prod,/\|\| \[ -f config\/schoolos-v5-release-gates\.json \]/);
 // Both conditions occur before image publication; a v5 tag lacking the
 // release manifest still invokes the veto script and fails closed.
 assert.ok(prod.indexOf("Enforce SchoolOS V5 production release approval")<
   prod.indexOf("docker\/build-push-action@v6"));
 assert.match(stage,/Refuse V5 candidate in legacy shared staging/);
 assert.ok(stage.indexOf("Refuse V5 candidate")<stage.indexOf("pnpm install --frozen-lockfile"));
});

test("Coolify-injected global environment cannot expose V5 R2 credentials to other services",async()=>{
 const compose=await readFile(new URL("../docker-compose.yml",import.meta.url),"utf8");
 // Coolify may append env_file: .env to every service: explicit environment overrides win.
 const services=compose.split("\nservices:\n")[1].split("\nnetworks:")[0];
 const sections=Object.fromEntries([...services.matchAll(/^  (postgres|redis|migrate|api|web|nginx|backup):\n([\s\S]*?)(?=^  (?:postgres|redis|migrate|api|web|nginx|backup):|$(?![\s\S]))/gm)].map(m=>[m[1],m[2]]));
 const sharedEnv=compose.split("\nx-api-env: &api-env\n")[1].split("\nservices:\n")[0];
 const emptyId=/BACKUP_AWS_ACCESS_KEY_ID:\s*""/;
 const emptySecret=/BACKUP_AWS_SECRET_ACCESS_KEY:\s*""/;
 for(const service of ["postgres","redis","web","nginx"]){
  assert.ok(sections[service], `missing ${service} service`);
  assert.match(sections[service],emptyId, `${service} should mask injected access key`);
  assert.match(sections[service],emptySecret, `${service} should mask injected secret key`);
 }
 for(const service of ["api","migrate"]){
  assert.match(sections[service],/environment: \*api-env/, `${service} must use guarded shared environment`);
 }
 assert.match(sharedEnv,emptyId);
 assert.match(sharedEnv,emptySecret);
 assert.match(sections.backup,/AWS_ACCESS_KEY_ID:\s*"\$\{BACKUP_AWS_ACCESS_KEY_ID:-\}"/);
 assert.match(sections.backup,/AWS_SECRET_ACCESS_KEY:\s*"\$\{BACKUP_AWS_SECRET_ACCESS_KEY:-\}"/);
 assert.match(sections.backup,/networks: \[backend, backup_egress\]/);
});
