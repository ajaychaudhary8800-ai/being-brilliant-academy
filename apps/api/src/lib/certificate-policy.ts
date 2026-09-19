import { CertificateStatus } from "@prisma/client";
import { AppError } from "./http.js";

export function assertCertificateIssueAllowed(status: CertificateStatus) {
  if (status !== CertificateStatus.DRAFT) {
    throw new AppError(409, "CERTIFICATE_ISSUE_LOCKED", "Only draft certificates can be issued");
  }
}

export function assertCertificateStatusTransition(current: CertificateStatus, next: CertificateStatus) {
  const allowed = current === CertificateStatus.ISSUED && (next === CertificateStatus.ARCHIVED || next === CertificateStatus.REVOKED)
    || current === CertificateStatus.ARCHIVED && next === CertificateStatus.REVOKED;
  if (!allowed) {
    throw new AppError(409, "INVALID_CERTIFICATE_STATUS_TRANSITION", `Certificate status cannot change from ${current} to ${next}`);
  }
}

export function assertCertificatePdfAvailable(status: CertificateStatus) {
  if (status !== CertificateStatus.ISSUED && status !== CertificateStatus.ARCHIVED) {
    throw new AppError(409, "CERTIFICATE_NOT_AVAILABLE", "Only issued or archived certificates can be downloaded");
  }
}

export function assertCertificateDeletable(status: CertificateStatus) {
  if (status !== CertificateStatus.DRAFT) {
    throw new AppError(409, "CERTIFICATE_PROTECTED", "Only draft certificates can be deleted");
  }
}
