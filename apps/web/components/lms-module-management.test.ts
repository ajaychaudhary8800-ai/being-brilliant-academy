import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("./lms-module-select.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/admin/lms/page.tsx", import.meta.url), "utf8");

test("LMS Module creation uses the existing authenticated API and preserves mandatory selection", () => {
  assert.match(component, /fetch\(`\$\{API\}\/admin\/lms\/modules`/);
  assert.match(component, /Authorization: `Bearer \$\{getAccessToken\(\) \?\? ""\}`/);
  assert.match(component, /JSON\.stringify\(\{ courseId, title: normalizedTitle, position \}\)/);
  assert.match(component, /<select required disabled=\{!courseId\}/);
  assert.match(component, /No Modules exist for the selected Course/);
});

test("only administrators receive Module creation controls", () => {
  assert.match(component, /courseId && canManage && !creating/);
  assert.match(component, /courseId && !canManage && available\.length === 0/);
  assert.match(page, /canManage=\{user\?\.role==="SUPER_ADMIN"\|\|user\?\.role==="BRANCH_ADMIN"\}/);
});

test("changing Branch or Course clears a stale Module selection", () => {
  assert.match(page, /upd\("branchId",e\.target\.value\);upd\("batchId",""\);upd\("courseId",""\);upd\("moduleId",""\)/);
  assert.match(page, /upd\("batchId",e\.target\.value\);upd\("moduleId",""\)/);
  assert.match(page, /<LmsModuleSelect courseId=\{form\.courseId\}/);
});
