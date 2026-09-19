import { EnquiryStatus } from "@prisma/client";
import { AppError } from "./http.js";

const followUpStatuses = new Set<EnquiryStatus>([
  EnquiryStatus.CONTACTED,
  EnquiryStatus.FOLLOW_UP,
  EnquiryStatus.INTERESTED,
  EnquiryStatus.NOT_INTERESTED,
  EnquiryStatus.CLOSED,
]);

export function assertEnquiryEditable(status: EnquiryStatus) {
  if (status === EnquiryStatus.CONVERTED) {
    throw new AppError(409, "ENQUIRY_CONVERTED", "Converted enquiries cannot be edited");
  }
  if (status === EnquiryStatus.ARCHIVED) {
    throw new AppError(409, "ENQUIRY_ARCHIVED", "Archived enquiries cannot be edited");
  }
}

export function assertDirectEnquiryStatusAllowed(status: EnquiryStatus | undefined) {
  if (status === EnquiryStatus.CONVERTED) {
    throw new AppError(422, "ENQUIRY_CONVERSION_WORKFLOW_REQUIRED", "Convert the enquiry through the admission workflow");
  }
}

export function assertFollowUpAllowed(currentStatus: EnquiryStatus, nextStatus?: EnquiryStatus) {
  if (currentStatus === EnquiryStatus.CONVERTED) {
    throw new AppError(409, "ENQUIRY_CONVERTED", "Converted enquiries cannot receive follow-ups");
  }
  if (currentStatus === EnquiryStatus.ARCHIVED) {
    throw new AppError(409, "ENQUIRY_ARCHIVED", "Archived enquiries cannot receive follow-ups");
  }
  if (nextStatus !== undefined && !followUpStatuses.has(nextStatus)) {
    throw new AppError(422, "INVALID_FOLLOW_UP_STATUS", "Follow-ups can only move an enquiry through active contact states or close it");
  }
}

export function assertEnquiryConvertible(status: EnquiryStatus) {
  if (status === EnquiryStatus.CONVERTED) {
    throw new AppError(409, "ALREADY_CONVERTED", "Enquiry is already converted");
  }
  if (status === EnquiryStatus.ARCHIVED || status === EnquiryStatus.CLOSED) {
    throw new AppError(409, "ENQUIRY_NOT_CONVERTIBLE", "Closed or archived enquiries must be reopened before admission");
  }
}
