import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { closeExpiredSchoolOSPrepaidVideoRooms } from "./schoolos-video-expiry-worker.js";
const source=(name:string)=>readFile(new URL(name,import.meta.url),"utf8");
test("video room stop worker stays entirely inactive without explicit financial admission",async()=>{
 const r=await closeExpiredSchoolOSPrepaidVideoRooms();
 assert.deepEqual(r,{processed:0,closed:0,failed:0,results:[]});
 await assert.rejects(()=>closeExpiredSchoolOSPrepaidVideoRooms(new Date(),0));
});
test("provider-side closing cannot be inferred from browser attendance or settle credits",async()=>{
 const worker=await source("./schoolos-video-expiry-worker.ts");
 assert.match(worker,/livekitRoomService\("DeleteRoom"/);
 assert.ok(worker.includes("expiredSchoolOSVideoRoomCandidates(now,tenants,limit)"));
 assert.match(worker,/SCHOOLOS_VIDEO_ADMISSION_ENABLED/);
 assert.ok(worker.includes(".filter(schoolOSVideoAdmissionEnabled)"));
 const candidates=await source("./schoolos-video-expired-candidates.ts");
 assert.ok(candidates.includes('m."endsAt"<='));
 assert.ok(candidates.includes('m."endsAt"<='));
 assert.match(worker,/creditSettlement:"PENDING_SIGNED_PROVIDER_REVIEW"/);
 assert.ok(worker.indexOf('await livekitRoomService("DeleteRoom"')<worker.indexOf("await systemPrisma.$transaction("));
 assert.doesNotMatch(worker,/schoolOSUsageEvent\.create|schoolOSUsageBalance\.update|creditReleased/);
});
test("operational health reports opted-in video room budget enforcement only",async()=>{
 const server=await source("../server.ts");
 assert.match(server,/videoQuota: workerSnapshot\("videoQuota", 2 \* 60_000\)/);
 assert.match(server,/setInterval\(\(\) => void runSchoolOSVideoWorker\(\), 30_000\)/);
 assert.match(server,/clearInterval\(schoolOSVideoWorker\)/);
 assert.match(server,/schoolos_video_quota/);
});
