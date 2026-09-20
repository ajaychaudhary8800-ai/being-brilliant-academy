import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const batchForm = () => readFileSync(new URL("./batch-form.tsx", import.meta.url), "utf8");

test("batch edit preserves asynchronously loaded course and teacher relationships", () => {
  const source = batchForm();
  assert.match(source, /\[courseId,setCourseId\]=useState\(batch\?\.course\?\.id\?\?""\)/);
  assert.match(source, /\[teacherId,setTeacherId\]=useState\(batch\?\.teacher\?\.id\?\?""\)/);
  assert.match(source, /courseId:courseId\|\|null/);
  assert.match(source, /teacherId:teacherId\|\|null/);
  assert.match(source, /label="Course" name="courseId" value=\{courseId\} onChange=\{setCourseId\}/);
  assert.match(source, /label="Teacher" name="teacherId" value=\{teacherId\} onChange=\{setTeacherId\}/);
});

test("batch edit does not rely on asynchronous select default values", () => {
  const source = batchForm();
  assert.doesNotMatch(source, /name="courseId" defaultValue=/);
  assert.doesNotMatch(source, /name="teacherId" defaultValue=/);
});
