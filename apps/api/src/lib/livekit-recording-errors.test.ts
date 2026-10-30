import assert from "node:assert/strict";
import test from "node:test";
import { livekitRecordingObjectMissing } from "./livekit.js";

test("missing LiveKit recording objects are identified without leaking provider errors", () => {
  for (const error of [
    { name: "NoSuchKey" },
    { name: "NotFound" },
    { name: "Unknown", $metadata: { httpStatusCode: 404 } },
  ]) assert.equal(livekitRecordingObjectMissing(error), true);

  for (const error of [
    null, undefined, "NoSuchKey", {}, new Error("unavailable"),
    { name: "AccessDenied", $metadata: { httpStatusCode: 403 } },
    { name: "ServiceUnavailable", $metadata: { httpStatusCode: 503 } },
    { name: "Unknown", $metadata: { httpStatusCode: 401 } },
  ]) assert.equal(livekitRecordingObjectMissing(error), false);
});
