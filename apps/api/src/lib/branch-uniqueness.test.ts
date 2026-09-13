import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { branchCodeConflict, isBranchCodeConflict } from "./branch-uniqueness.js";

const scopedCodeKey = (organizationId: string, branchCode: string) => `${organizationId}\u0000${branchCode}`;

test("branch codes are business keys within an organization", () => {
  assert.notEqual(scopedCodeKey("org-a", "MAIN"), scopedCodeKey("org-b", "MAIN"));
  assert.equal(scopedCodeKey("org-a", "MAIN"), scopedCodeKey("org-a", "MAIN"));
});

test("organization-scoped branch code conflicts are recognized precisely", () => {
  assert.equal(isBranchCodeConflict({ code: "P2002", meta: { target: ["organizationId", "code"] } }), true);
  assert.equal(isBranchCodeConflict({ code: "P2002", meta: { target: ["organizationId", "branchCode"] } }), true);
  assert.equal(isBranchCodeConflict({ code: "P2002", meta: { target: "Branch_organizationId_code_key" } }), true);
  assert.equal(isBranchCodeConflict({ code: "P2002", meta: { target: ["email"] } }), false);
  assert.equal(isBranchCodeConflict({ code: "P2034" }), false);

  const error = branchCodeConflict();
  assert.equal(error.status, 409);
  assert.equal(error.code, "BRANCH_CODE_EXISTS");
  assert.match(error.message, /this organization/);
});

test("schema scopes branch codes to organizations", async () => {
  const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const model = schema.slice(schema.indexOf("model Branch {"), schema.indexOf("model BranchUser {"));

  assert.match(model, /branchCode\s+String\s+@map\("code"\)/);
  assert.doesNotMatch(model, /branchCode\s+String\s+@unique/);
  assert.match(model, /@@unique\(\[organizationId, branchCode\], map: "Branch_organizationId_code_key"\)/);
});

test("migration safely replaces only the obsolete global branch-code index", async () => {
  const sql = await readFile(new URL("../../prisma/migrations/20260913150000_scope_branch_code_to_organization/migration.sql", import.meta.url), "utf8");

  assert.match(sql, /CREATE UNIQUE INDEX "Branch_organizationId_code_key"[^]*\("organizationId", "code"\)/);
  assert.match(sql, /DROP INDEX "Branch_code_key"/);
  assert.match(sql, /BEGIN;[^]*COMMIT;/);
  assert.equal((sql.match(/CREATE UNIQUE INDEX/g) ?? []).length, 1);
  assert.equal((sql.match(/DROP INDEX/g) ?? []).length, 1);
  assert.doesNotMatch(sql, /DROP\s+(TABLE|COLUMN)|DELETE\s+FROM|TRUNCATE|UPDATE\s+"Branch"|_prisma_migrations/i);
});

test("branch create and edit map only branch-code races to the stable API conflict", async () => {
  const route = await readFile(new URL("../routes/admin.ts", import.meta.url), "utf8");

  assert.equal((route.match(/isBranchCodeConflict\(error\)/g) ?? []).length, 2);
  assert.match(route, /router\.post\("\/branches"[^]*BRANCH_CODE_EXISTS|router\.post\("\/branches"[^]*branchCodeConflict/s);
  assert.doesNotMatch(route, /router\.post\("\/branches"[^]*An unexpected error occurred/);
});
