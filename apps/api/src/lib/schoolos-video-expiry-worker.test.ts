import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { closeExpiredSchoolOSPrepaidVideoRooms } from "./schoolos-video-expiry-worker.js";
const source=(name:string)=>readFile(new URL(name,import.meta.url),"utf8");
test("video safety cutoff retains outstanding prepaid reservations after opt-out",async()=>{
 await assert.rejects(()=>closeExpiredSchoolOSPrepaidVideoRooms(new Date(),0));
 const worker=await source("./schoolos-video-expiry-worker.ts");
 assert.match(worker,/expiredSchoolOSVideoRoomCandidates\(now,null,limit\)/);
 assert.doesNotMatch(worker,/SCHOOLOS_VIDEO_ADMISSION_ENABLED|SCHOOLOS_VIDEO_ADMISSION_TENANT_IDS/);
});
test("provider-side closing cannot be inferred from browser attendance or settle credits",async()=>{
 const worker=await source("./schoolos-video-expiry-worker.ts");
 assert.match(worker,/livekitRoomService\("DeleteRoom"/);
 assert.ok(worker.includes("expiredSchoolOSVideoRoomCandidates(now,null,limit)"));
 assert.doesNotMatch(worker,/SCHOOLOS_VIDEO_ADMISSION_ENABLED/);
 const provider=await source("./livekit.ts");
 assert.ok(provider.includes('method === "DeleteRoom" ? { roomCreate: true } : {}'));
 assert.ok(provider.includes("signal: AbortSignal.timeout(10_000)"));
 assert.ok(worker.includes("previously admitted provider rooms"));
 const candidates=await source("./schoolos-video-expired-candidates.ts");
 assert.ok(candidates.includes('m."endsAt"<='));
 assert.ok(candidates.includes('ORDER BY m."endsAt" ASC,m."id" ASC'));
 assert.match(worker,/creditSettlement:"PENDING_SIGNED_PROVIDER_REVIEW"/);
 assert.ok(worker.indexOf('await requireSchoolOSPrepaidRoomDisconnect(')<worker.indexOf("await systemPrisma.$transaction("));
 assert.doesNotMatch(worker,/schoolOSUsageEvent\.create|schoolOSUsageBalance\.update|creditReleased/);
});
test("operational health reports opted-in video room budget enforcement only",async()=>{
 const server=await source("../server.ts");
 assert.match(server,/videoQuota: workerSnapshot\("videoQuota", 2 \* 60_000\)/);
 assert.match(server,/setInterval\(\(\) => void runSchoolOSVideoWorker\(\), 30_000\)/);
 assert.match(server,/clearInterval\(schoolOSVideoWorker\)/);
 assert.match(server,/schoolos_video_quota/);
 assert.doesNotMatch(server,/if \(!env\.SCHOOLOS_VIDEO_ADMISSION_ENABLED\) \{\s*schoolOSVideoWorkerRunning/);
 assert.match(server,/schoolOSVideoResidualWorkObserved = result\.processed > 0/);
});
