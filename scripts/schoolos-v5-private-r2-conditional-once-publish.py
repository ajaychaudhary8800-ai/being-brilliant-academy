#!/usr/bin/env python3
"""V5 protected R2 create-once publisher: DEFAULT DISABLED, no automatic writes.

Explicit owner-only operation after separately approved genuine source-pinned
OCI image retention, semantic review, and pinned detached signing.
This source and synthetic tests never make R2 writes. Never run from CI.
Each R2 PutObject uses an atomic If-None-Match: * condition. No multipart:
objects exceeding 5 GiB fail closed rather than use unsafe generic upload.
If either write/readback fails, return HOLD_PARTIAL_OR_UNKNOWN without retry,
overwrite, delete or treating a negative HEAD as proof of a failed write.
"""
from __future__ import annotations

import hashlib
import hmac
import importlib.util
import os
from pathlib import Path
import re
import stat
import sys
import uuid

ROOT = Path(__file__).resolve().parent
BUCKET = "schoolos-v5-rollback-custody"
MAX_SINGLE_PUT = 5 * 1024 ** 3
READBACK_FAILED = "R2_COMMIT_OR_READBACK_UNCERTAIN"
ACK = "I_AUTHORIZE_TWO_90_DAY_LOCKED_V5_ROLLBACK_OCI_OBJECTS"
SHA = re.compile(r"[a-f0-9]{64}\Z")
KEYID = re.compile(r"[A-Za-z0-9]{12,128}\Z")
ACCOUNT = re.compile(r"[a-f0-9]{32}\Z")


class Hold(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def _load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    if spec is None or spec.loader is None:
        raise Hold("REVIEWED_DEPENDENCY_MISSING")
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
    except (OSError, ValueError, ImportError, AttributeError, SystemExit):
        raise Hold("REVIEWED_DEPENDENCY_MISSING") from None
    return module


def _owner_approval(environ, signed_manifest_bytes):
    if (environ.get("GITHUB_ACTIONS") == "true" or
            environ.get("CI") == "true"):
        raise Hold("CI_ENVIRONMENT_NOT_ALLOWED")
    if environ.get("V5_CUSTODY_OWNER_IMMUTABLE_UPLOAD_ACK") != ACK:
        raise Hold("OWNER_EXPLICIT_UPLOAD_ACK_MISSING")
    supplied = environ.get("V5_CUSTODY_OWNER_APPROVED_MANIFEST_SHA256")
    if (not isinstance(supplied, str) or not SHA.fullmatch(supplied) or
            not hmac.compare_digest(supplied, hashlib.sha256(signed_manifest_bytes).hexdigest())):
        raise Hold("OWNER_APPROVED_MANIFEST_HASH_MISMATCH")


def _writer(environ):
    account = environ.get("CLOUDFLARE_ACCOUNT_ID")
    access = environ.get("R2_CUSTODY_WRITER_ACCESS_KEY_ID")
    secret = environ.get("R2_CUSTODY_WRITER_SECRET_ACCESS_KEY")
    if (not isinstance(account, str) or not ACCOUNT.fullmatch(account) or
            not isinstance(access, str) or not KEYID.fullmatch(access) or
            not isinstance(secret, str) or len(secret) < 16):
        raise Hold("WRITER_PRIVATE_CREDENTIALS_UNAVAILABLE")
    try:
        import boto3
        from botocore.client import Config
        return boto3.client(
            "s3", region_name="auto",
            endpoint_url=f"https://{account}.r2.cloudflarestorage.com",
            aws_access_key_id=access,
            aws_secret_access_key=secret,
            config=Config(signature_version="s3v4", connect_timeout=8, read_timeout=180,
                          retries={"total_max_attempts": 1},
                          s3={"addressing_style": "path"}),
        )
    except (ImportError, ValueError, TypeError):
        raise Hold("WRITER_S3_CLIENT_UNAVAILABLE") from None


def _single_create_once(writer, path, item, role, write_id):
    if role not in ("api", "web") or not isinstance(item, dict):
        raise Hold("SIGNED_ARCHIVE_INFO_INVALID")
    if not isinstance(write_id, str) or not re.fullmatch(r"[a-f0-9-]{36}", write_id):
        raise Hold("WRITE_ID_INVALID")
    source = item.get("key")
    expected = item.get("sha256")
    size = item.get("sizeBytes")
    if (not isinstance(source, str) or not source.startswith("v5-rollback/") or
            not isinstance(expected, str) or not SHA.fullmatch(expected) or
            type(size) is not int or not 0 < size <= MAX_SINGLE_PUT):
        raise Hold("SINGLE_PUT_SIGNED_ARCHIVE_REQUIRED")
    if not hasattr(os, "O_NOFOLLOW"):
        raise Hold("FILE_NOFOLLOW_UNAVAILABLE")
    fd = None
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0))
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_size != size or
                before.st_mode & 0o022):
            raise Hold("SIGNED_SOURCE_FILE_UNSAFE")
        with os.fdopen(fd, "rb") as body:
            fd = None
            # Rehash the SAME open descriptor immediately before publication.
            # Preflight already checked exact OCI content and signature.
            # This narrows accidental TOCTOU risk; independent reader SHA
            # remains mandatory and protects against in-flight mutation.
            digest = hashlib.sha256()
            counted = 0
            while True:
                chunk = body.read(1024 * 1024)
                if not chunk:
                    break
                counted += len(chunk)
                if counted > size:
                    raise Hold("SIGNED_SOURCE_FILE_UNSAFE")
                digest.update(chunk)
            if counted != size or not hmac.compare_digest(digest.hexdigest(), expected):
                raise Hold("SIGNED_SOURCE_FILE_UNSAFE")
            before_second = os.fstat(body.fileno())
            if (before.st_dev != before_second.st_dev or
                    before.st_ino != before_second.st_ino or
                    before.st_size != before_second.st_size or
                    before.st_mtime_ns != before_second.st_mtime_ns):
                raise Hold("SIGNED_SOURCE_FILE_UNSAFE")
            body.seek(0)
            try:
                response = writer.put_object(
                    Bucket=BUCKET,
                    Key=source,
                    Body=body,
                    ContentLength=size,
                    ContentType="application/vnd.oci.image.layout.v1.tar",
                    IfNoneMatch="*",
                    Metadata={
                        "v5-source-archive-sha256": expected,
                        "v5-write-id": write_id,
                        "v5-role": role,
                    },
                )
            except Exception:
                # A timed-out call may already have created an immutable
                # object. Never retry/overwrite/delete or assume a 404 proves
                # absence. Always require independent reconciliation.
                raise Hold(READBACK_FAILED) from None
            after = os.fstat(body.fileno())
            if (before.st_dev != after.st_dev or before.st_ino != after.st_ino or
                    before.st_size != after.st_size or
                    before.st_mtime_ns != after.st_mtime_ns):
                raise Hold(READBACK_FAILED)
        if (not isinstance(response, dict) or
                response.get("ResponseMetadata", {}).get("HTTPStatusCode") != 200):
            raise Hold(READBACK_FAILED)
    except Hold:
        raise
    except (OSError, ValueError, TypeError):
        raise Hold("SIGNED_SOURCE_FILE_UNAVAILABLE") from None
    finally:
        if fd is not None:
            os.close(fd)


def publish(environ, *, writer_client=None, reader_client=None, cloud_open_request=None):
    pre = _load("v5_once_prepublication", "schoolos-v5-private-r2-publication-preflight.py")
    signed = _load("v5_once_signed_reader", "schoolos-v5-private-r2-signed-readback.py")

    # Perform actual signed OCI source/byte validation and immutable approval
    # before opening ANY R2 connection. No upload path when approval missing.
    try:
        manifest = pre.inspect_local(environ)
        raw = signed._bounded_regular(
            environ.get("V5_CUSTODY_MANIFEST_PATH"), signed.MAX_MANIFEST_BYTES)
    except (pre.Hold, signed.Hold, OSError, ValueError, TypeError):
        raise Hold("SIGNED_LOCAL_OCI_MANIFEST_NOT_VERIFIED") from None
    _owner_approval(environ, raw)
    try:
        pre.check_identities(environ)
        pre.check_cloudflare(environ, cloud_open_request)
        reader = reader_client if reader_client is not None else pre._make_reader(environ)
        for role in ("api", "web"):
            pre._head_absence(reader, manifest[role])
    except (pre.Hold, OSError, ValueError, TypeError):
        raise Hold("PRIVATE_R2_PREPUBLICATION_NOT_VERIFIED") from None

    # Require an independently supplied writer and distinct effective reader
    # identity before writes. Distinct keys and access policies are NOT proved.
    writer = writer_client if writer_client is not None else _writer(environ)
    keys = ("V5_CUSTODY_API_OCI_ARCHIVE_PATH", "V5_CUSTODY_WEB_OCI_ARCHIVE_PATH")
    for role, source in zip(("api", "web"), keys):
        try:
            _single_create_once(writer, environ.get(source), manifest[role],
                                role, str(uuid.uuid4()))
        except Hold as error:
            if error.code in ("SIGNED_SOURCE_FILE_UNSAFE", "SIGNED_SOURCE_FILE_UNAVAILABLE",
                              "SINGLE_PUT_SIGNED_ARCHIVE_REQUIRED", "FILE_NOFOLLOW_UNAVAILABLE"):
                # May already have written first role. Do not claim clean none.
                raise Hold(READBACK_FAILED) from None
            raise

    # Exactly the separate reader credential must GET every object and
    # hash all bytes against signed checksum. No ETag trust or partial stream.
    try:
        signed.readback(reader, manifest)
    except Exception:
        raise Hold(READBACK_FAILED) from None
    return "PASS_TWO_CONDITIONAL_PUTS_AND_INDEPENDENT_READER_FULL_SHA256"


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    # No implicit network call by merely running the script or importing it.
    if argv != ["--execute-owner-approved-write"]:
        print("V5_R2_CREATE_ONCE_PUBLISHER=DISABLED_DEFAULT")
        print("V5_R2_REAL_OBJECTS_WRITTEN=NO")
        print("DEPLOYMENT_AUTHORIZATION=HOLD")
        return 2

    result, blocker, rc = "HOLD", None, 2
    attempted = "UNKNOWN"
    try:
        if (os.environ.get("V5_CUSTODY_OWNER_IMMUTABLE_UPLOAD_ACK") != ACK or
                os.environ.get("GITHUB_ACTIONS") == "true" or os.environ.get("CI") == "true"):
            raise Hold("OWNER_APPROVAL_NOT_ACTIVE")
        # Can't rely on any failure message as proof no object committed.
        attempted = "POSSIBLE_IF_AUTHORIZED"
        result = publish(os.environ)
        attempted, rc = "YES_TWO_CREATE_ONCE", 0
    except Hold as error:
        blocker = error.code
    print("V5_R2_CREATE_ONCE_PUBLISHER=" + result)
    if blocker:
        print("V5_R2_PUBLISHER_BLOCKER=" + blocker)
    print("V5_R2_WRITE_COMMIT_STATUS=" + attempted)
    print("V5_R2_OBJECT_LOCK_DELETE_DENIAL=NOT_VERIFIED")
    print("V5_SOURCE_TO_BUILD_PROVENANCE=NOT_ATTESTED")
    print("V5_FULL_SEMANTIC_IMAGE_SECRET_CLEARANCE=NOT_ATTESTED")
    print("V5_REAL_CHECKPOINT_APPLICATION_ROLLBACK=NOT_VERIFIED")
    print("V5_HISTORICAL_DATABASE_REDIS_ROTATION=NOT_EXECUTED")
    print("V5_STAGING_PRODUCTION_CHANGED=NO")
    print("DEPLOYMENT_AUTHORIZATION=HOLD")
    return rc


if __name__ == "__main__":
    sys.exit(main())
