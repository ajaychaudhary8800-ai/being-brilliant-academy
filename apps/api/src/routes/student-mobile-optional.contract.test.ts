import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("student admissions and imports permit omitted or blank personal mobile numbers", async () => {
  const routes = await readFile(new URL("./admin-students.ts", import.meta.url), "utf8");
  assert.match(routes, /mobile:\s*z\.preprocess\(value => value === "" \|\| value === undefined \? null : value, phone\.nullable\(\)\)/);
  assert.match(routes, /parentMobile:\s*phone/);
  assert.match(routes, /phone:\s*data\.mobile/);
  assert.match(routes, /mobile !== undefined \? \{ phone: mobile \} : \{\}/);
  assert.match(routes, /STUDENT_MOBILE_EXISTS/);
});

test("student form marks personal mobile optional and sends null when blank", async () => {
  const page = await readFile(new URL("../../../web/app/admin/students/page.tsx", import.meta.url), "utf8");
  assert.match(page, /mobile:\s*form\.mobile\.trim\(\) \|\| null/);
  assert.match(page, /'aadhaarNo', 'mobile'\]\.includes\(key\)/);
  assert.match(page, /\['mobile', 'Mobile'\]/);
  assert.match(page, /mobile: student\.user\.phone \?\? ""/);
});

test("student mobile is nullable in database while non-null numbers remain unique", async () => {
  const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const user = schema.match(/model User \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(user, "User model");
  assert.match(user, /phone\s+String\?\s+@unique/);
});
