import assert from "node:assert/strict";
import test from "node:test";
import { ExaminationStatus } from "@prisma/client";
import {
  answerSubmissionState,
  assertExaminationPublicationReady,
  assertQuestionPaperAvailable,
  examinationStart,
} from "./examination-policy.js";

const code = (cause: unknown) => (cause as { code?: string }).code;

test("question paper requires both publication time and examination start", () => {
  const now = new Date("2026-09-20T07:00:00.000Z");
  const exam = { examDate: new Date("2026-09-20T00:00:00.000Z"), startMinute: 600 };
  const startsAt = examinationStart(exam);
  assert.equal(startsAt.toISOString(), "2026-09-20T10:00:00.000Z");
  assert.throws(
    () => assertQuestionPaperAvailable(ExaminationStatus.SCHEDULED, new Date("2026-09-20T06:00:00.000Z"), now, startsAt),
    cause => code(cause) === "QUESTION_PAPER_UNPUBLISHED",
  );
  assert.doesNotThrow(() => assertQuestionPaperAvailable(
    ExaminationStatus.SCHEDULED,
    new Date("2026-09-20T06:00:00.000Z"),
    new Date("2026-09-20T10:00:00.000Z"),
    startsAt,
  ));
});


test("examination windows use the organization timezone", () => {
  const exam = {
    examDate: new Date("2026-09-29T00:00:00.000Z"),
    startMinute: 12 * 60 + 15,
    endMinute: 13 * 60 + 15,
    status: ExaminationStatus.COMPLETED,
  };
  const startsAt = examinationStart(exam, "Asia/Kolkata");
  assert.equal(startsAt.toISOString(), "2026-09-29T06:45:00.000Z");
  const submission = answerSubmissionState(exam, new Date("2026-09-29T08:38:00.000Z"), "Asia/Kolkata");
  assert.equal(submission.status, "LATE_SUBMITTED");
});

test("future publication time remains authoritative even after exam start", () => {
  const startsAt = new Date("2026-09-20T10:00:00.000Z");
  assert.throws(
    () => assertQuestionPaperAvailable(
      ExaminationStatus.SCHEDULED,
      new Date("2026-09-20T11:00:00.000Z"),
      new Date("2026-09-20T10:30:00.000Z"),
      startsAt,
    ),
    cause => code(cause) === "QUESTION_PAPER_UNPUBLISHED",
  );
});

test("result publication requires complete finalized generated results", () => {
  assert.doesNotThrow(() => assertExaminationPublicationReady({ results: 30, unfinishedAnswerSheets: 0, ungeneratedResults: 0 }));
  assert.throws(
    () => assertExaminationPublicationReady({ results: 0, unfinishedAnswerSheets: 0, ungeneratedResults: 0 }),
    cause => code(cause) === "RESULTS_REQUIRED",
  );
  assert.throws(
    () => assertExaminationPublicationReady({ results: 30, unfinishedAnswerSheets: 1, ungeneratedResults: 0 }),
    cause => code(cause) === "EVALUATIONS_INCOMPLETE",
  );
  assert.throws(
    () => assertExaminationPublicationReady({ results: 30, unfinishedAnswerSheets: 0, ungeneratedResults: 1 }),
    cause => code(cause) === "RESULTS_NOT_GENERATED",
  );
});
