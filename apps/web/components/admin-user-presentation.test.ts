import assert from "node:assert/strict";
import test from "node:test";
import { formatAdminUserDate, normalizeAdminUsersResponse } from "./admin-user-presentation";

test("normal user data preserves human-readable account fields", () => {
  const result = normalizeAdminUsersResponse({ data: [{ id: "1", name: "Asha", email: "asha@example.com", phone: null, role: "EMPLOYEE", isActive: true, createdAt: "2026-09-07T00:00:00.000Z", branches: [{ branchName: "Main", branchCode: "MAIN" }], parentChildren: [] }], meta: { total: 1, totalPages: 1 } });
  assert.equal(result.data[0]?.role, "EMPLOYEE");
  assert.equal(result.data[0]?.phone, null);
  assert.equal(result.data[0]?.branches[0]?.branchName, "Main");
});

test("missing profiles, branches and parent children cannot crash rendering", () => {
  const result = normalizeAdminUsersResponse({ data: [{ id: "1", role: "SUPER_ADMIN", branches: [undefined], parentChildren: undefined }, { id: "2", role: "PARENT" }] });
  assert.deepEqual(result.data[0]?.branches, []);
  assert.deepEqual(result.data[1]?.parentChildren, []);
  assert.equal(result.meta.totalPages, 1);
});

test("empty, malformed and partial API data becomes a controlled empty result", () => {
  assert.deepEqual(normalizeAdminUsersResponse({ data: [] }).data, []);
  assert.deepEqual(normalizeAdminUsersResponse({ error: { message: "Forbidden" } }).data, []);
  assert.deepEqual(normalizeAdminUsersResponse(null).data, []);
  assert.equal(formatAdminUserDate("not-a-date"), "—");
  assert.equal(formatAdminUserDate(null), "—");
});
