import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./native-live-classroom.tsx", import.meta.url), "utf8");
const learning = readFileSync(new URL("./learning-ecosystem-workspace.tsx", import.meta.url), "utf8");

test("native classroom provides core market live-teaching controls", () => {
  for (const expected of [
    "setMicrophoneEnabled",
    "setCameraEnabled",
    "setScreenShareEnabled",
    "Class chat",
    "Raise hand",
    "Whiteboard",
    "Annotate",
    "Allow share",
    "Remove",
    "Record",
    "Test camera & microphone",
    "Automatic attendance",
  ]) assert.match(source, new RegExp(expected.replace(/[.*+?^$()|[\]\\]/g, "\\$&")));
});

test("whiteboard and annotations synchronize through classroom data packets", () => {
  assert.match(source, /publishData/);
  assert.match(source, /type: "whiteboard"/);
  assert.match(source, /clear-surface/);
  assert.match(source, /whiteboard-permission/);
  assert.match(source, /class-whiteboard\.png/);
});

test("live-class creation defaults to the Being Brilliant native classroom", () => {
  assert.match(learning, /provider:"NATIVE"/);
  assert.match(learning, /Native Being Brilliant Classroom/);
  assert.match(learning, /Students stay inside the Being Brilliant portal/);
});


test("parent observer mode is view-only and recordings remain authenticated", () => {
  assert.match(source, /session\?\.role === "PARENT"/);
  assert.match(source, /Observer \/ view only/);
  assert.match(source, /class chat is view-only/);
  assert.match(source, /openAuthenticatedDocument/);
  assert.match(source, /\/recording/);
});


test("stopped classroom recordings report automatic LMS publishing", () => {
  assert.match(source, /publishedToLms/);
  assert.match(source, /published to LMS/);
});
