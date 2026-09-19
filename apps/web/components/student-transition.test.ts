import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildTransitionPayload, filterDestinationBatches, localCivilDate, transitionErrorMessage, transitionRequiresDestination } from "./student-transition";

test("destination is required for placement transitions and terminal transitions omit it", () => {
  assert.equal(transitionRequiresDestination("PROMOTED"), true);
  assert.equal(transitionRequiresDestination("RETAINED"), true);
  assert.equal(transitionRequiresDestination("TRANSFERRED"), true);
  assert.equal(transitionRequiresDestination("LEFT"), false);
  assert.equal(transitionRequiresDestination("GRADUATED"), false);

  assert.deepEqual(buildTransitionPayload({ type: "PROMOTED", effectiveDate: "2026-09-19", targetBatchId: "batch-1", rollNo: " r-7 ", reason: "Year-end promotion" }), {
    type: "PROMOTED",
    effectiveDate: "2026-09-19",
    targetBatchId: "batch-1",
    rollNo: "R-7",
    reason: "Year-end promotion",
  });
  assert.deepEqual(filterDestinationBatches([
    { id: "current", status: "ACTIVE", course: { id: "course-a" } },
    { id: "next", status: "ACTIVE", course: { id: "course-a" } },
    { id: "other-course", status: "ACTIVE", course: { id: "course-b" } },
  ], "RETAINED", "current", "course-a").map(batch => batch.id), ["next"]);
  assert.deepEqual(buildTransitionPayload({ type: "GRADUATED", effectiveDate: "2026-09-19", targetBatchId: "must-not-submit", rollNo: "must-not-submit" }), {
    type: "GRADUATED",
    effectiveDate: "2026-09-19",
  });
});

test("known transition API errors map to actionable messages", () => {
  assert.match(transitionErrorMessage("BATCH_CAPACITY_REACHED"), /capacity/i);
  assert.match(transitionErrorMessage("ACADEMIC_TRANSITION_CONFLICT"), /reload/i);
  assert.match(transitionErrorMessage("ACADEMIC_TRANSITION_FORBIDDEN"), /authorized/i);
  assert.equal(transitionErrorMessage("UNKNOWN", "fallback"), "fallback");
});

test("transition UI waits for confirmation and detail consumes history APIs", () => {
  const dialog = readFileSync(fileURLToPath(new URL("./student-transition-dialog.tsx", import.meta.url)), "utf8");
  const confirmAt = dialog.indexOf("const confirm = async");
  assert.ok(confirmAt > 0);
  assert.equal(dialog.slice(0, confirmAt).includes("fetch(`${API}/admin/students/"), false);
  assert.match(dialog.slice(confirmAt), /academic-transitions/);
  assert.match(dialog, /placementRows\(destination, undefined, normalizeTransitionRollNo\(rollNo\)\)/);
  assert.doesNotMatch(dialog, /new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
  assert.match(dialog, /querySelectorAll<HTMLElement>/);

  const detail = readFileSync(fileURLToPath(new URL("../app/admin/students/[id]/page.tsx", import.meta.url)), "utf8");
  assert.match(detail, /academic-history/);
  assert.match(detail, /academic-transitions/);
  assert.match(detail, /readAllBatches/);
  assert.match(detail, /enrollmentHistoryError/);
  assert.match(detail, /transitionHistoryError/);
  assert.match(detail, /setHistory\(\[\]\)/);
  assert.match(detail, /setTransitions\(\[\]\)/);
  assert.match(detail, /setBatches\(\[\]\)/);
  assert.match(dialog, /disabled=\{submitting \|\| batchesLoading \|\| Boolean\(batchesError\)\}/);
});

test("civil-date helper uses local calendar fields", () => {
  const value = new Date(2026, 8, 19, 0, 30);
  assert.equal(localCivilDate(value), "2026-09-19");
});
