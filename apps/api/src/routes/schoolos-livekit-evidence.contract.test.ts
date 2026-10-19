import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
const get=(name:string)=>readFile(new URL(name,import.meta.url),"utf8");

test("LiveKit evidence endpoint preserves unparsed signed provider body",async()=>{
 const app=await get("../server.ts"),route=await get("./schoolos-livekit-evidence.ts");
 assert.match(app,/express\.raw\(\{type:"application\/webhook\+json",limit:"64kb"\}\)/);
 assert.ok(app.indexOf('express.raw({type:"application/webhook+json",limit:"64kb"})')<
  app.indexOf('app.use(express.json({ limit: "15mb" }))'));
 assert.match(route,/Buffer\.isBuffer\(req\.body\)/);
 assert.match(route,/ingestSchoolOSLiveKitEvidence\(req\.body,req\.header\("authorization"\)\)/);
 assert.match(route,/homeOrganizationId!=="org_default"/);
 assert.doesNotMatch(route,/consumeSchoolOSUsage|grantSchoolOSPaidQuoteCredits/);
});
test("PostgreSQL refuses tampering with immutable provider event evidence",async()=>{
 const migration=await get("../../prisma/migrations/20261019050000_schoolos_livekit_signed_events/migration.sql");
 assert.match(migration,/UNIQUE INDEX "SchoolOSLiveKitEvent_providerEventId_key"/);
 assert.match(migration,/schoolos_livekit_evidence_guard_fn/);
 assert.match(migration,/SCHOOLOS_LIVEKIT_TENANT_MISMATCH/);
 assert.match(migration,/SCHOOLOS_LIVEKIT_EVIDENCE_IMMUTABLE/);
 assert.match(migration,/SCHOOLOS_LIVEKIT_PARTICIPANT_MISMATCH/);
});
