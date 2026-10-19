import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
const source=(name:string)=>readFile(new URL(name,import.meta.url),"utf8");

test("zero-video release is separate, platform-only, disabled and proof-based",async()=>{
 const route=await source("./schoolos-livekit-evidence.ts");
 const service=await source("../lib/schoolos-video-zero-release-service.ts");
 const config=await source("../config.ts");
 const provider=await source("../lib/livekit.ts");
 assert.match(route,/homeOrganizationId!=="org_default"/);
 assert.match(route,/platform\/schoolos\/video-zero-release\/\:organizationId\/\:meetingId/);
 assert.match(route,/platform\/schoolos\/video-zero-release\/\:organizationId\/\:reviewId\/decision/);
 assert.match(config,/SCHOOLOS_VIDEO_ZERO_RELEASE_ENABLED: z\.string\(\)\.default\("false"\)/);
 assert.match(config,/SCHOOLOS_VIDEO_ZERO_RELEASE_TENANT_IDS: optionalString/);
 assert.match(service,/minimumProviderQuiescenceMs=72\*60\*60\*1000/);
 assert.match(service,/schoolOSVideoEvidenceSnapshot\(events,meeting\.hostUserId,meeting\.status,true\)/);
 assert.match(service,/row\.proposedBy===checkerId/);
 assert.match(service,/livekitRoomService\("ListRooms"/);
 assert.match(service,/SCHOOLOS_VIDEO_PROVIDER_ROOM_ACTIVE/);
 assert.match(service,/SCHOOLOS_VIDEO_RELEASE_FINANCE_HOLD/);
 assert.match(service,/SCHOOLOS_VIDEO_RELEASE_EVIDENCE_CHANGED/);
 assert.match(service,/status:"RELEASED",releasedAt:now/);
 assert.match(service,/consumedUnits:\{decrement:reservation\.units\}/);
 assert.ok(provider.includes('method === "ListRooms" ? { roomList: true } : {}'));
 assert.doesNotMatch(service,/razorpay|capturePayment|refundPayment/);
});
test("releasing a hold freezes provider evidence and cannot be reversed",async()=>{
 const migration=await source("../../prisma/migrations/20261019080000_schoolos_zero_video_release_review/migration.sql");
 assert.match(migration,/status"='RELEASED' AND "proposedMinutes"=0/);
 assert.match(migration,/NEW\."status" NOT IN \('SETTLED','REJECTED','RELEASED'\)/);
 assert.match(migration,/r\."status" IN \('SETTLED','RELEASED'\)/);
});
