import assert from "node:assert/strict";
import test from "node:test";
import { EnquiryStatus } from "@prisma/client";
import {
  assertDirectEnquiryStatusAllowed,
  assertEnquiryConvertible,
  assertEnquiryEditable,
  assertFollowUpAllowed,
} from "./enquiry-policy.js";
import { AppError } from "./http.js";

function expectAppError(fn: () => void, status: number, code: string) {
  assert.throws(fn, error => error instanceof AppError && error.status === status && error.code === code);
}

test("direct edits cannot bypass the admission conversion workflow", () => {
  expectAppError(() => assertDirectEnquiryStatusAllowed(EnquiryStatus.CONVERTED), 422, "ENQUIRY_CONVERSION_WORKFLOW_REQUIRED");
  assert.doesNotThrow(() => assertDirectEnquiryStatusAllowed(EnquiryStatus.INTERESTED));
});

test("converted and archived enquiries are immutable through normal editing", () => {
  expectAppError(() => assertEnquiryEditable(EnquiryStatus.CONVERTED), 409, "ENQUIRY_CONVERTED");
  expectAppError(() => assertEnquiryEditable(EnquiryStatus.ARCHIVED), 409, "ENQUIRY_ARCHIVED");
  assert.doesNotThrow(() => assertEnquiryEditable(EnquiryStatus.CLOSED));
});

test("follow-ups cannot revive terminal records or set conversion/archival directly", () => {
  expectAppError(() => assertFollowUpAllowed(EnquiryStatus.CONVERTED, EnquiryStatus.FOLLOW_UP), 409, "ENQUIRY_CONVERTED");
  expectAppError(() => assertFollowUpAllowed(EnquiryStatus.ARCHIVED, EnquiryStatus.FOLLOW_UP), 409, "ENQUIRY_ARCHIVED");
  expectAppError(() => assertFollowUpAllowed(EnquiryStatus.INTERESTED, EnquiryStatus.CONVERTED), 422, "INVALID_FOLLOW_UP_STATUS");
  expectAppError(() => assertFollowUpAllowed(EnquiryStatus.INTERESTED, EnquiryStatus.ARCHIVED), 422, "INVALID_FOLLOW_UP_STATUS");
  assert.doesNotThrow(() => assertFollowUpAllowed(EnquiryStatus.INTERESTED, EnquiryStatus.CLOSED));
});

test("closed and archived enquiries must be reopened before admission", () => {
  expectAppError(() => assertEnquiryConvertible(EnquiryStatus.CLOSED), 409, "ENQUIRY_NOT_CONVERTIBLE");
  expectAppError(() => assertEnquiryConvertible(EnquiryStatus.ARCHIVED), 409, "ENQUIRY_NOT_CONVERTIBLE");
  expectAppError(() => assertEnquiryConvertible(EnquiryStatus.CONVERTED), 409, "ALREADY_CONVERTED");
  assert.doesNotThrow(() => assertEnquiryConvertible(EnquiryStatus.INTERESTED));
});
