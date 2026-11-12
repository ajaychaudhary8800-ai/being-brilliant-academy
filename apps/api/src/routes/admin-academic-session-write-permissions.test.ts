import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const api = readFileSync(new URL("./admin-academic-sessions.ts", import.meta.url), "utf8");
const masters = readFileSync(new URL("./admin-education-masters.ts", import.meta.url), "utf8");
const ui = readFileSync(new URL("../../../web/app/admin/academic-sessions/page.tsx", import.meta.url), "utf8");

test("academic session read routes remain available to BRANCH_ADMIN", () => {
  assert.match(api, /router\.use\(requireAuth,allow\(Role\.SUPER_ADMIN,Role\.BRANCH_ADMIN\)\)/);
  for (const route of ["/academic-sessions", "/academic-sessions/current", "/academic-sessions/:id"]) {
    assert.ok(api.includes(`router.get("${route}",`), `missing read route ${route}`);
  }
});

test("all five institution-wide mutation endpoints require SUPER_ADMIN before parsing", () => {
  const routes = [
    ["post", "/academic-sessions"],
    ["patch", "/academic-sessions/:id"],
    ["patch", "/academic-sessions/:id/archive"],
    ["patch", "/academic-sessions/:id/current"],
    ["delete", "/academic-sessions/:id"],
  ] as const;
  for (const [method, route] of routes) {
    const guard = `router.${method}("${route}",allow(Role.SUPER_ADMIN),`;
    assert.equal(api.split(guard).length - 1, 1,
      `${method.toUpperCase()} ${route} must have exactly one SUPER_ADMIN guard`);
  }
});

test("branch-admin UI stays readable while hiding write controls and save modal", () => {
  assert.match(ui, /<AuthGate roles=\{\["SUPER_ADMIN","BRANCH_ADMIN"\]\}>/);
  assert.match(ui, /const canManage=user\?\.role==="SUPER_ADMIN"/);
  assert.match(ui, /\{canManage&&<button onClick=\{\(\)=>open\(\)\}/);
  assert.match(ui, /\{canManage\?<div className="flex flex-wrap gap-2"/);
  assert.match(ui, /\{mode&&canManage&&<div className="fixed/);
  assert.match(ui, /if\(!canManage\)return setError\("Only a Super Admin can manage academic sessions"\)/);
});


test("education master list remains available to BRANCH_ADMIN but six mutations require institution SUPER_ADMIN", () => {
  assert.match(masters, /router\.use\(requireAuth, allow\(Role\.SUPER_ADMIN, Role\.BRANCH_ADMIN\)\)/);
  assert.ok(masters.includes('router.get("/education-masters",'), "education master list must remain readable");
  for (const [method, route] of [
    ["post", "/education-masters/competitive-exams"],
    ["patch", "/education-masters/competitive-exams/:id"],
    ["post", "/education-masters/skill-categories"],
    ["patch", "/education-masters/skill-categories/:id"],
    ["post", "/education-masters/specializations"],
    ["patch", "/education-masters/specializations/:id"],
  ] as const) {
    const guarded = `router.${method}("${route}", allow(Role.SUPER_ADMIN),`;
    assert.equal(masters.split(guarded).length - 1, 1,
      `${method.toUpperCase()} ${route} must have exactly one SUPER_ADMIN guard`);
  }
});
