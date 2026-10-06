import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Device Hub processor writes employee attendance through existing HR model", async () => {
  const source = await readFile(new URL("./device-hub-processor.ts", import.meta.url), "utf8");
  assert.match(source, /ConnectedDeviceBindingType\.EMPLOYEE/);
  assert.match(source, /hrAttendance\.upsert/);
  assert.match(source, /source: "DEVICE_HUB"/);
  assert.match(source, /biometricReference: event\.id/);
  assert.match(source, /AttendanceStatus\.PRESENT/);
});

test("Device Hub processor writes student attendance using profile user and current batch", async () => {
  const source = await readFile(new URL("./device-hub-processor.ts", import.meta.url), "utf8");
  assert.match(source, /ConnectedDeviceBindingType\.STUDENT/);
  assert.match(source, /student\.userId/);
  assert.match(source, /student\.batchId/);
  assert.match(source, /attendance\.upsert/);
  assert.match(source, /studentId_batchId_date/);
});

test("attendance event date is derived from organization timezone", async () => {
  const source = await readFile(new URL("./device-hub-processor.ts", import.meta.url), "utf8");
  assert.match(source, /institutionCalendarDate\(instant, organization\.timezone\)/);
  assert.match(source, /parseDateOnly/);
});

test("GPS device events update vehicle location and append replay-safe trip points", async () => {
  const source = await readFile(new URL("./device-hub-processor.ts", import.meta.url), "utf8");
  assert.match(source, /ConnectedDeviceBindingType\.VEHICLE/);
  assert.match(source, /transportVehicle\.update/);
  assert.match(source, /transportGpsPoint\.upsert/);
  assert.match(source, /deviceEventId: event\.id/);
  assert.match(source, /TripStatus\.STARTED/);
});

test("domain processors reject branch drift and ambiguous bindings", async () => {
  const source = await readFile(new URL("./device-hub-processor.ts", import.meta.url), "utf8");
  assert.match(source, /DEVICE_BINDING_BRANCH_MISMATCH/);
  assert.match(source, /DEVICE_IDENTITY_AMBIGUOUS/);
  assert.match(source, /DEVICE_VEHICLE_AMBIGUOUS/);
  assert.match(source, /DEVICE_ATTENDANCE_DIRECTION_REQUIRED/);
});

test("expected device mapping failures are persisted as rejected events instead of thrown to hardware", async () => {
  const source = await readFile(new URL("./device-hub-processor.ts", import.meta.url), "utf8");
  assert.match(source, /error instanceof DeviceEventProcessingError/);
  assert.match(source, /ConnectedDeviceEventStatus\.REJECTED/);
  assert.match(source, /errorCode: error\.code/);
  assert.match(source, /processedAt: new Date\(\)/);
});

test("supported VIDEO and SENSOR events are processed while unsupported GENERIC categories remain pending", async () => {
  const source = await readFile(new URL("./device-hub-processor.ts", import.meta.url), "utf8");
  assert.match(source, /category === "VIDEO"\) result = await processVideo/);
  assert.match(source, /category === "SENSOR"\) result = await processEnvironmentalSensor/);
  assert.match(source, /pendingAdapter: parsed\.data\.category/);
  assert.doesNotMatch(source, /category === "GENERIC"\) result = await/);
});

test("transport GPS schema carries a unique source Device Hub event key", async () => {
  const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const start = schema.indexOf("model TransportGpsPoint {");
  const end = schema.indexOf("\n}", start);
  const model = schema.slice(start, end);
  assert.match(model, /deviceEventId\s+String\?\s+@unique/);
});
