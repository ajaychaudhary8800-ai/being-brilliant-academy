import assert from "node:assert/strict";
import test from "node:test";
import {
  connectedDeviceEventEnvelopeSchema,
  connectedDeviceHealth,
  connectedDeviceSourceHash,
  generateConnectedDeviceIngestToken,
  hashConnectedDeviceIngestToken,
  normalizeConnectedDeviceEvent,
  verifyConnectedDeviceIngestToken,
} from "./device-hub.js";

test("device ingest tokens hash and verify without plaintext persistence", () => {
  const token = generateConnectedDeviceIngestToken();
  const hash = hashConnectedDeviceIngestToken(token);
  assert.notEqual(token, hash);
  assert.equal(hash.length, 64);
  assert.equal(verifyConnectedDeviceIngestToken(token, hash), true);
  assert.equal(verifyConnectedDeviceIngestToken(token + "x", hash), false);
});

test("device source hash is stable for object key order and changes with event identity", () => {
  const base = {
    eventType: "gps.position",
    occurredAt: new Date("2026-09-30T05:00:00.000Z"),
  };
  const a = connectedDeviceSourceHash({ ...base, payload: { lat: 28.6, lng: 77.4, nested: { b: 2, a: 1 } } });
  const b = connectedDeviceSourceHash({ ...base, payload: { nested: { a: 1, b: 2 }, lng: 77.4, lat: 28.6 } });
  const c = connectedDeviceSourceHash({ ...base, externalEventId: "evt-2", payload: { lat: 28.6, lng: 77.4, nested: { b: 2, a: 1 } } });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("device GPS payload normalizes coordinates and speed", () => {
  const envelope = connectedDeviceEventEnvelopeSchema.parse({
    externalEventId: "gps-1",
    eventType: "gps.position",
    occurredAt: "2026-09-30T05:00:00.000Z",
    payload: { lat: "28.6692", lng: 77.4538, speed: "42.5", ignition: true },
  });
  const normalized = normalizeConnectedDeviceEvent(envelope);
  assert.equal(normalized.category, "LOCATION");
  assert.equal(normalized.latitude, 28.6692);
  assert.equal(normalized.longitude, 77.4538);
  assert.equal(normalized.speedKph, 42.5);
  assert.equal(normalized.metadata.ignition, true);
});

test("biometric/RFID event normalizes external identity and direction", () => {
  const normalized = normalizeConnectedDeviceEvent(connectedDeviceEventEnvelopeSchema.parse({
    eventType: "biometric.attendance",
    occurredAt: new Date(),
    payload: { biometricCode: "EMP-001", action: "check_in" },
  }));
  assert.equal(normalized.category, "IDENTITY");
  assert.equal(normalized.subjectExternalId, "EMP-001");
  assert.equal(normalized.direction, "IN");
});

test("invalid coordinates and negative speed fail closed", () => {
  assert.throws(() => normalizeConnectedDeviceEvent(connectedDeviceEventEnvelopeSchema.parse({
    eventType: "gps.position",
    occurredAt: new Date(),
    payload: { latitude: 120, longitude: 77 },
  })));
  assert.throws(() => normalizeConnectedDeviceEvent(connectedDeviceEventEnvelopeSchema.parse({
    eventType: "gps.position",
    occurredAt: new Date(),
    payload: { latitude: 28, longitude: 77, speed: -1 },
  })));
});

test("device health marks stale active devices offline for monitoring purposes", () => {
  const health = connectedDeviceHealth({
    status: "ACTIVE",
    lastHeartbeatAt: new Date("2026-09-30T05:00:00.000Z"),
    now: new Date("2026-09-30T05:10:01.000Z"),
    staleAfterSeconds: 600,
  });
  assert.equal(health.stale, true);
  assert.equal(health.online, false);
  assert.equal(health.ageSeconds, 601);
});

test("heartbeat events classify independently of provider-specific event names", () => {
  const normalized = normalizeConnectedDeviceEvent(connectedDeviceEventEnvelopeSchema.parse({
    eventType: "vendor.keepalive",
    occurredAt: new Date(),
    heartbeat: true,
    payload: { firmware: "1.2.3" },
  }));
  assert.equal(normalized.category, "HEARTBEAT");
});
