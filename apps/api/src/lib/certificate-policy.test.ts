import assert from "node:assert/strict";
import test from "node:test";
import { CertificateStatus } from "@prisma/client";
import {
  assertCertificateDeletable,
  assertCertificateIssueAllowed,
  assertCertificatePdfAvailable,
  assertCertificateStatusTransition,
} from "./certificate-policy.js";

const code = (cause: unknown) => (cause as { code?: string }).code;

test("only draft certificates can be issued", () => {
  assert.doesNotThrow(() => assertCertificateIssueAllowed(CertificateStatus.DRAFT));
  for (const status of [CertificateStatus.ISSUED, CertificateStatus.ARCHIVED, CertificateStatus.REVOKED]) {
    assert.throws(() => assertCertificateIssueAllowed(status), cause => code(cause) === "CERTIFICATE_ISSUE_LOCKED");
  }
});

test("certificate lifecycle allows archive/revoke without resurrection", () => {
  assert.doesNotThrow(() => assertCertificateStatusTransition(CertificateStatus.ISSUED, CertificateStatus.ARCHIVED));
  assert.doesNotThrow(() => assertCertificateStatusTransition(CertificateStatus.ISSUED, CertificateStatus.REVOKED));
  assert.doesNotThrow(() => assertCertificateStatusTransition(CertificateStatus.ARCHIVED, CertificateStatus.REVOKED));
  for (const [from, to] of [
    [CertificateStatus.DRAFT, CertificateStatus.ARCHIVED],
    [CertificateStatus.DRAFT, CertificateStatus.REVOKED],
    [CertificateStatus.ARCHIVED, CertificateStatus.ARCHIVED],
    [CertificateStatus.REVOKED, CertificateStatus.ARCHIVED],
    [CertificateStatus.REVOKED, CertificateStatus.REVOKED],
  ] as const) {
    assert.throws(() => assertCertificateStatusTransition(from, to), cause => code(cause) === "INVALID_CERTIFICATE_STATUS_TRANSITION");
  }
});

test("only issued and archived certificates can be rendered as PDF", () => {
  assert.doesNotThrow(() => assertCertificatePdfAvailable(CertificateStatus.ISSUED));
  assert.doesNotThrow(() => assertCertificatePdfAvailable(CertificateStatus.ARCHIVED));
  for (const status of [CertificateStatus.DRAFT, CertificateStatus.REVOKED]) {
    assert.throws(() => assertCertificatePdfAvailable(status), cause => code(cause) === "CERTIFICATE_NOT_AVAILABLE");
  }
});

test("only draft certificates can be deleted", () => {
  assert.doesNotThrow(() => assertCertificateDeletable(CertificateStatus.DRAFT));
  for (const status of [CertificateStatus.ISSUED, CertificateStatus.ARCHIVED, CertificateStatus.REVOKED]) {
    assert.throws(() => assertCertificateDeletable(status), cause => code(cause) === "CERTIFICATE_PROTECTED");
  }
});
