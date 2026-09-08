import assert from "node:assert/strict";
import test from "node:test";
import { parentLeaveAcademicLabel, parentLeaveChildSummary, parentLeaveSelection, type ParentLeaveChild } from "./parent-leave";

const child = (studentId: string): ParentLeaveChild => ({ studentId, name: `Student ${studentId}`, admissionNo: `ADM-${studentId}`, className: "Class 5", batch: { name: "Morning", code: "M1" }, relationship: "Mother" });

test("a sole active child is selected automatically", () => {
  assert.equal(parentLeaveSelection([child("one")], ""), "one");
});

test("multiple children require an explicit valid selection", () => {
  const children = [child("one"), child("two")];
  assert.equal(parentLeaveSelection(children, ""), "");
  assert.equal(parentLeaveSelection(children, "two"), "two");
  assert.equal(parentLeaveSelection(children, "unlinked"), "");
});

test("zero active children produces no selectable subject", () => {
  assert.equal(parentLeaveSelection([], "one"), "");
});

test("child summaries identify the leave subject without exposing internal user ids", () => {
  assert.equal(parentLeaveChildSummary(child("one")), "Student one · ADM-one · Class 5");
});

test("technical legacy class ids are replaced by meaningful course metadata", () => {
  const technicalId = "cmtiuv5ye01lwrv06a6lg8m26";
  const profile: ParentLeaveChild = { ...child("one"), className: technicalId, batch: { name: "Physics Batch 1", code: "PB1", course: { title: "Physics" } } };
  assert.equal(parentLeaveAcademicLabel(profile), "Physics");
  assert.doesNotMatch(parentLeaveChildSummary(profile), /cmtiuv5ye01lwrv06a6lg8m26/);
});
