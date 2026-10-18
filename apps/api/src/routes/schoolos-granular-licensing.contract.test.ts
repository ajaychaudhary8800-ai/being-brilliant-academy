import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("AI Examiner and workflow automation have independent server-side client feature switches", async () => {
  const examiner = await readFile(new URL("ai-examiner.ts", import.meta.url), "utf8");
  const automation = await readFile(new URL("automation.ts", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../../../web/components/sidebar.tsx", import.meta.url), "utf8");
  const commercial = await readFile(new URL("../lib/saas-commercial.ts", import.meta.url), "utf8");
  const licensing = await readFile(new URL("schoolos-features.ts", import.meta.url), "utf8");

  assert.match(examiner, /requireCommercialFeature\("examinations"\)/);
  assert.match(examiner, /requireCommercialFeature\("ai_examiner"\)/);
  assert.match(automation, /requireCommercialFeature\("communication"\)/);
  assert.match(automation, /requireCommercialFeature\("workflow_automation"\)/);
  assert.match(sidebar, /Ranpal AI Examiner.*feature: "ai_examiner"/);
  assert.match(sidebar, /Workflow Automation.*feature: "workflow_automation"/);
  assert.match(sidebar, /effectiveFeatures\?\.\[entry.feature\]/);
  assert.match(commercial, /schoolOSResolvedFeatures/);
  assert.match(licensing, /SCHOOLOS_PARENT_FEATURE_REQUIRED/);
});
