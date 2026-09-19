import assert from "node:assert/strict";
import test from "node:test";
import { displayLabel } from "./display-label";
import { institutionPresentation, portalAcademicPairLabel, portalSectionLabel } from "./institution-presentation";

test("school presentation uses class, section and teacher terminology", () => {
  const labels = institutionPresentation("SECTION");
  assert.equal(labels.mode, "SCHOOL");
  assert.equal(labels.courses, "Classes");
  assert.equal(labels.plural, "Sections");
  assert.equal(labels.educators, "Teachers");
  assert.equal(labels.overviewTitle, "School Overview");
});

test("coaching presentation uses course, batch and faculty terminology", () => {
  const labels = institutionPresentation("BATCH");
  assert.equal(labels.mode, "COACHING");
  assert.equal(labels.courses, "Courses & Programs");
  assert.equal(labels.plural, "Batches");
  assert.equal(labels.educators, "Faculty");
  assert.equal(labels.assessments, "Tests & Assessments");
});

test("legacy and custom settings use safe neutral presentation", () => {
  assert.equal(institutionPresentation("GROUP").overviewTitle, "Institution Overview");
  assert.equal(institutionPresentation("CUSTOM", "Learning Group").plural, "Learning Groups");
  assert.equal(institutionPresentation("UNKNOWN").institution, "Institution");
});

test("known enums have explicit readable labels while business codes remain unchanged", () => {
  assert.equal(displayLabel("UNIT_TEST"), "Unit Test");
  assert.equal(displayLabel("RESULTS_PUBLISHED"), "Results Published");
  assert.equal(displayLabel("HALF_DAY"), "Half Day");
  assert.equal(displayLabel("PHY-UT1"), "PHY-UT1");
});


test("portal labels follow School terminology", () => {
  const terms = institutionPresentation("SECTION");
  assert.equal(portalSectionLabel("classes", terms), "Classes");
  assert.equal(portalSectionLabel("examinations", terms), "Examinations");
  assert.equal(portalSectionLabel("learning", terms), "Digital Learning");
  assert.equal(portalAcademicPairLabel(terms), "Class / Section");
});

test("portal labels follow Coaching terminology", () => {
  const terms = institutionPresentation("BATCH");
  assert.equal(portalSectionLabel("classes", terms), "Courses & Programs");
  assert.equal(portalSectionLabel("examinations", terms), "Tests & Assessments");
  assert.equal(portalSectionLabel("learning", terms), "Learning Resources");
  assert.equal(portalAcademicPairLabel(terms), "Course / Batch");
});

test("portal labels preserve readable generic tabs", () => {
  const terms = institutionPresentation();
  assert.equal(portalSectionLabel("attendance", terms), "Attendance");
  assert.equal(portalSectionLabel("leave_requests", terms), "Leave Requests");
});
