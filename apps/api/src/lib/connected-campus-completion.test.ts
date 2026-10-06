import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("ordinary environmental sensor readings are processed instead of left pending", async () => {
  const source = await readFile(new URL("./device-hub-processor.ts", import.meta.url), "utf8");
  assert.match(source, /parsed\.data\.category === "SENSOR"\) result = await processEnvironmentalSensor/);
  assert.match(source, /adapter: "ENVIRONMENT_SENSOR"/);
  assert.match(source, /SchoolEventCategory\.DEVICE/);
  assert.match(source, /reading: normalized\.reading/);
  assert.match(source, /unit: normalized\.unit/);
});

test("environmental sensors create safety incidents only from explicit alert/fault signals", async () => {
  const source = await readFile(new URL("./device-hub-processor.ts", import.meta.url), "utf8");
  const start = source.indexOf("function sensorAlertSignal");
  const end = source.indexOf("async function processVideo", start);
  assert.ok(start >= 0 && end > start);
  const section = source.slice(start, end);
  assert.match(section, /metadata\.alarm === true \|\| metadata\.alert === true/);
  assert.match(section, /ALARM/);
  assert.match(section, /WATER_LEAK/);
  assert.match(section, /CO2_HIGH/);
  assert.match(section, /POWER_FAILURE/);
  assert.match(section, /if \(alert\)/);
  assert.doesNotMatch(section, /normalized\.reading\s*>/);
});

test("sensor alerts require branch ownership before a safety incident can be created", async () => {
  const source = await readFile(new URL("./device-hub-processor.ts", import.meta.url), "utf8");
  assert.match(source, /SENSOR_ALERT_BRANCH_REQUIRED/);
  assert.match(source, /deviceEventId: event\.id/);
  assert.match(source, /sourceType: "ENVIRONMENT_SENSOR"/);
});

test("verified transport ridership events create parent notifications", async () => {
  const source = await readFile(new URL("./device-hub-processor.ts", import.meta.url), "utf8");
  assert.match(source, /createParentTransportNotifications/);
  assert.match(source, /sourceEntityId: ridership\.id/);
  assert.match(source, /Bus boarding confirmed/);
  assert.match(source, /Bus drop confirmed/);
  assert.match(source, /category: "TRANSPORT"/);
  assert.match(source, /sourceModule: "SMART_TRANSPORT"/);
});

test("transport notifications always include in-app and only queue opted-in external channels", async () => {
  const source = await readFile(new URL("./device-hub-processor.ts", import.meta.url), "utf8");
  const start = source.indexOf("async function createParentTransportNotifications");
  const end = source.indexOf("async function processRidership", start);
  const section = source.slice(start, end);
  assert.match(section, /"IN_APP"/);
  assert.match(section, /preference\?\.push \? \["PUSH"\]/);
  assert.match(section, /preference\?\.sms \? \["SMS"\]/);
  assert.match(section, /preference\?\.whatsapp \? \["WHATSAPP"\]/);
  assert.match(section, /notificationDelivery\.createMany/);
  assert.doesNotMatch(section, /preference\?\.email/);
});
