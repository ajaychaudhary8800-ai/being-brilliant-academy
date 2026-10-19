import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("SchoolOS split licensing enforces both server routes and platform parent feature limits", async () => {
 const examiner=await readFile(new URL("ai-examiner.ts",import.meta.url),"utf8");
 const automation=await readFile(new URL("automation.ts",import.meta.url),"utf8");
 const sidebar=await readFile(new URL("../../../web/components/sidebar.tsx",import.meta.url),"utf8");
 const commercial=await readFile(new URL("../lib/saas-commercial.ts",import.meta.url),"utf8");
 const route=await readFile(new URL("schoolos-features.ts",import.meta.url),"utf8");
 assert.match(examiner,/requireCommercialFeature\("examinations"\), requireCommercialFeature\("ai_examiner"\)/);
 assert.match(automation,/requireCommercialFeature\("communication"\)/);
 assert.match(automation,/requireCommercialFeature\("workflow_automation"\)/);
 assert.match(sidebar,/Ranpal AI Examiner.*feature: "ai_examiner"/);
 assert.match(sidebar,/Workflow Automation.*feature: "workflow_automation"/);
 assert.match(sidebar,/effectiveFeatures\?\.\[entry.feature\]/);
 assert.match(commercial,/schoolOSResolvedFeatures/);
 assert.match(route,/SCHOOLOS_PARENT_FEATURE_REQUIRED/);
 assert.match(route,/schoolOSParentFeature\(feature\)/);
});
