import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("teacher attendance reads are constrained to active assigned batches", async () => {
  const route = await readFile(new URL("./attendance.ts", import.meta.url), "utf8");
  assert.match(route, /activeTeacherBatchIds/);
  assert.match(route, /req\.auth!\.role===Role\.TEACHER/);
  assert.match(route, /teacherBatchIds=own\?await activeTeacherBatchIds\(own\.id\):\[\]/);
  assert.match(route, /q\.batchId&&!teacherBatchIds\.includes\(q\.batchId\)/);
  assert.match(route, /CLASS_ACCESS_DENIED/);
  assert.match(route, /teacherBatchIds\?\{batchId:\{in:teacherBatchIds\}\}/);
});
