import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const inventoryApi = new URL("./inventory.ts", import.meta.url);
const transportApi = new URL("./transport.ts", import.meta.url);
const webRoot = new URL("../../../web/", import.meta.url);

async function web(path: string) {
  return readFile(new URL(path, webRoot), "utf8");
}

test("operations modules expose primary web creation controls", async () => {
  const [inventory, hostel, library, transport, finance] = await Promise.all([
    web("app/admin/inventory/page.tsx"),
    web("app/admin/hostel/page.tsx"),
    web("app/admin/library/page.tsx"),
    web("app/admin/transport/page.tsx"),
    web("app/admin/finance/page.tsx"),
  ]);

  assert.match(inventory, /Add Asset/);
  assert.match(inventory, /Add Item/);
  assert.match(hostel, /Add Hostel/);
  assert.match(library, /Add Book/);
  assert.match(transport, /Add Vehicle/);
  assert.match(transport, /Add Driver/);
  assert.match(finance, /Add Account/);
});

test("inventory exposes master option endpoints required by create forms", async () => {
  const source = await readFile(inventoryApi, "utf8");
  assert.match(source, /get\("\/inventory\/asset-categories"/);
  assert.match(source, /get\("\/inventory\/item-categories"/);
});

test("settings and reports are functional hubs rather than placeholders", async () => {
  const [settings, reports] = await Promise.all([
    web("app/admin/settings/page.tsx"),
    web("app/admin/reports/page.tsx"),
  ]);

  assert.match(settings, /Institution Profile/);
  assert.match(settings, /Users, Roles & Access/);
  assert.match(settings, /Platform SaaS Controls/);
  assert.match(reports, /AttendanceReports/);
  assert.match(reports, /Finance & Statutory Reports/);
});

test("protected report downloads use authenticated fetches", async () => {
  const [library, transport] = await Promise.all([
    web("app/admin/library/page.tsx"),
    web("app/admin/transport/page.tsx"),
  ]);

  assert.match(library, /downloadReport/);
  assert.match(library, /Authorization/);
  assert.match(transport, /downloadReport/);
  assert.match(transport, /Authorization/);
});

test("PWA install prompt can be dismissed without blocking admin work", async () => {
  const shell = await web("components/pwa-shell.tsx");
  assert.match(shell, /bba-pwa-install-dismissed-until/);
  assert.match(shell, /Dismiss install prompt/);
});


test("transport staff listing uses staff branch scope and supports driver filtering", async () => {
  const source = await readFile(transportApi, "utf8");
  const start = source.indexOf('r.get("/transport/staff"');
  const end = source.indexOf('r.post("/transport/staff"', start);
  const route = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(route, /erpBranchWhere\(sc\)/);
  assert.match(route, /role:z\.nativeEnum\(TransportStaffRole\)\.optional\(\)/);
  assert.doesNotMatch(route, /routeBranchWhere\(sc\)/);

  const page = await web("app/admin/transport/page.tsx");
  assert.match(page, /role=DRIVER/);
  assert.match(page, /Driving licence number/);
  assert.match(page, /licenseExpiry/);
});
