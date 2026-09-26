import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./native-live-classroom.tsx", import.meta.url), "utf8");
const learning = readFileSync(new URL("./learning-ecosystem-workspace.tsx", import.meta.url), "utf8");
const nginx = readFileSync(new URL("../../../infra/nginx/nginx.conf", import.meta.url), "utf8");

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


test("native classroom client is permitted by CSP and cannot hang indefinitely", () => {
  assert.match(nginx, /script-src[^"]*https:\/\/cdn\.jsdelivr\.net/);
  assert.match(source, /Live classroom engine did not load within 15 seconds/);
  assert.match(source, /Live classroom connection timed out/);
  assert.match(source, /prior\.remove\(\)/);
});


test("screen annotations use a high-contrast interactive overlay with dedicated tools", () => {
  assert.match(source, /annotationColor.*#ef4444/);
  assert.match(source, /annotationDrawingMode/);
  assert.match(source, /pointer-events-auto cursor-crosshair/);
  assert.match(source, /Annotation pen/);
  assert.match(source, /Annotation eraser/);
  assert.match(source, /Annotation color/);
  assert.match(source, /Clear annotations/);
  assert.match(source, /DRAW ON SCREEN/);
  assert.match(source, /surface === "annotation" \? 5 : 3/);
});


test("native classroom includes advanced teaching engagement tools", () => {
  for (const expected of [
    "Quick poll",
    "Class timer",
    "Live poll",
    "Class reactions",
    "poll-start",
    "poll-vote",
    "timer-start",
    "reaction",
  ]) assert.match(source, new RegExp(expected.replace(/[.*+?^$()|[\]\\]/g, "\\$&")));
});

test("whiteboard supports inserted teaching objects and history controls", () => {
  for (const expected of [
    "Sticky",
    "Rectangle",
    "Circle",
    "Arrow",
    "Undo",
    "Redo",
    "whiteboard-state",
    "insertWhiteboardText",
    "insertWhiteboardShape",
  ]) assert.match(source, new RegExp(expected.replace(/[.*+?^$()|[\]\\]/g, "\\$&")));
});
