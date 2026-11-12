#!/usr/bin/env python3
"""V5 private R2 rollback publication READY-TO-REVIEW preflight, READ ONLY.

No PutObject, multipart, CopyObject, delete, Docker, service updates,
credential rotation, or signing. Fails closed unless:
 (a) owner's exact two new local OCI TAR bytes match a signed pinned manifest,
 (b) Cloudflare read-only control plane confirms private 90-day prefix lock,
 (c) publisher and retriever access-key IDs are distinct,
 (d) independent read identity can HEAD exactly the two proposed object keys,
     each returning a genuine not-found response (not 403).
Even PASS is a planning-only observation: not a writer-permission attestation,
an object-lock durability test, image provenance, nor rollback authorization.
"""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent
KEYID = re.compile(r"[A-Z0-9a-z]{12,128}\Z")
BUCKET = "schoolos-v5-rollback-custody"


class Hold(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def _load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    if spec is None or spec.loader is None:
        raise Hold("OFFLINE_DEPENDENCY_UNAVAILABLE")
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
    except (OSError, ValueError, ImportError, AttributeError, SystemExit):
        raise Hold("OFFLINE_DEPENDENCY_UNAVAILABLE") from None
    return module


def inspect_local(environ):
    signed = _load("v5_prepub_signed", "schoolos-v5-private-r2-signed-readback.py")
    offline = _load("v5_prepub_oci", "schoolos-v5-private-oci-offline-verify.py")
    names = [
        "V5_CUSTODY_MANIFEST_PATH",
        "V5_CUSTODY_SIGNATURE_PATH",
        "V5_CUSTODY_PUBKEY_PATH",
        "V5_CUSTODY_PUBKEY_SHA256",
        "V5_CUSTODY_API_OCI_ARCHIVE_PATH",
        "V5_CUSTODY_WEB_OCI_ARCHIVE_PATH",
    ]
    values = [environ.get(name) for name in names]
    if any(not isinstance(v, str) or not v for v in values):
        raise Hold("SIGNED_LOCAL_INPUTS_MISSING")
    try:
        # Full read-only signature, TAR hash, actual OCI index/config/layer
        # digests, source SHA and uncompressed rootfs DiffID validation.
        offline.inspect(*values)
        raw = signed._bounded_regular(values[0], signed.MAX_MANIFEST_BYTES)
        manifest = signed.decode_signed_manifest(raw)
        # Insist on the distinct, previously source-pinned V5 prior build.
        candidate = _load("v5_prepub_prior", "schoolos-v5-prior-oci-candidate-manifest.py")
        if manifest["sourceSha"] != candidate.OLDER:
            raise Hold("PREVIOUS_SOURCE_REVISION_NOT_PINNED")
        return manifest
    except Hold:
        raise
    except (offline.Hold, signed.Hold, OSError, ValueError, TypeError):
        raise Hold("SIGNED_OCI_BYTES_NOT_VERIFIED") from None


def check_cloudflare(environ, open_request=None):
    cloud = _load("v5_prepub_cloudflare", "schoolos-v5-r2-custody-preflight.py")
    result = cloud.inspect(
        environ.get("CLOUDFLARE_ACCOUNT_ID"),
        environ.get("CLOUDFLARE_API_TOKEN"),
        open_request=open_request,
    )
    if result.get("R2_PRIVATE_CONFIG_PREFLIGHT") != "PASS_CONFIGURATION_ONLY":
        raise Hold("PRIVATE_R2_CONFIG_UNCONFIRMED")
    return result


def check_identities(environ):
    writer = environ.get("R2_CUSTODY_WRITER_ACCESS_KEY_ID")
    reader = environ.get("R2_CUSTODY_READER_ACCESS_KEY_ID")
    if (not isinstance(writer, str) or not KEYID.fullmatch(writer) or
            not isinstance(reader, str) or not KEYID.fullmatch(reader)):
        raise Hold("R2_IDENTITY_INPUT_MISSING")
    if writer == reader:
        raise Hold("R2_WRITER_READER_IDENTITY_NOT_SEPARATE")
    return True


def _make_reader(environ):
    account = environ.get("CLOUDFLARE_ACCOUNT_ID")
    reader = environ.get("R2_CUSTODY_READER_ACCESS_KEY_ID")
    secret = environ.get("R2_CUSTODY_READER_SECRET_ACCESS_KEY")
    if (not isinstance(account, str) or not re.fullmatch(r"[a-f0-9]{32}", account) or
            not isinstance(reader, str) or not KEYID.fullmatch(reader) or
            not isinstance(secret, str) or len(secret) < 16):
        raise Hold("R2_READER_CREDENTIALS_UNAVAILABLE")
    try:
        import boto3
        from botocore.client import Config
        return boto3.client(
            "s3", region_name="auto",
            endpoint_url=f"https://{account}.r2.cloudflarestorage.com",
            aws_access_key_id=reader,
            aws_secret_access_key=secret,
            config=Config(signature_version="s3v4", connect_timeout=8,
                          read_timeout=20, retries={"max_attempts": 1},
                          s3={"addressing_style": "path"}),
        )
    except (ImportError, ValueError, TypeError):
        raise Hold("R2_READ_CLIENT_UNAVAILABLE") from None


def _head_absence(reader_client, item):
    """Only a documented HeadObject NoSuchKey 404 may count as absent."""
    key = item["key"]
    try:
        reader_client.head_object(Bucket=BUCKET, Key=key)
    except Exception as error:
        # Never display the service exception or user data.
        response = getattr(error, "response", None)
        if not isinstance(response, dict):
            raise Hold("R2_KEY_STATE_UNVERIFIED") from None
        meta = response.get("ResponseMetadata", {})
        detail = response.get("Error", {})
        if (not isinstance(meta, dict) or not isinstance(detail, dict) or
                meta.get("HTTPStatusCode") != 404 or
                detail.get("Code") not in ("404", "NoSuchKey", "NotFound")):
            raise Hold("R2_KEY_STATE_UNVERIFIED") from None
        return
    # Existing object must never be re-used or overwritten; locks may apply.
    raise Hold("R2_TARGET_KEY_ALREADY_EXISTS")


def inspect(environ, *, open_request=None, reader_client=None):
    manifest = inspect_local(environ)
    check_identities(environ)
    check_cloudflare(environ, open_request)
    client = reader_client if reader_client is not None else _make_reader(environ)
    for role in ("api", "web"):
        _head_absence(client, manifest[role])
    return {
        "V5_PRIVATE_SIGNED_LOCAL_OCI_PAIR": "PASS_SIGNED_BYTES_ONLY",
        "V5_R2_CONFIGURATION": "PASS_PRIVATE_90_DAY_LOCK",
        "V5_R2_READER_WRITER_ID_DISTINCT": "PASS_IDS_ONLY",
        "V5_R2_TARGET_KEYS": "PASS_HEAD_NOT_FOUND_OBSERVATION",
        "V5_R2_PUBLICATION_REVIEW_PREFLIGHT": "PASS_READ_ONLY_REVIEW_ONLY",
    }


def main():
    result = "HOLD"
    cause = None
    try:
        findings = inspect(os.environ)
        result = findings["V5_R2_PUBLICATION_REVIEW_PREFLIGHT"]
    except Hold as error:
        cause = error.code
    print("V5_R2_PUBLICATION_REVIEW_PREFLIGHT=" + result)
    if cause is not None:
        print("V5_R2_PREFLIGHT_BLOCKER=" + cause)
    print("V5_R2_READER_EFFECTIVE_WRITE_DENIAL=NOT_TESTED")
    print("V5_R2_WRITER_EFFECTIVE_PERMISSIONS=NOT_TESTED")
    print("V5_SOURCE_TO_IMAGE_BUILD_PROVENANCE=NOT_ATTESTED")
    print("V5_FULL_IMAGE_SECRET_CLEARANCE=NOT_ATTESTED")
    print("V5_R2_WRITE_OR_LOCK_PROBE_EXECUTED=NO")
    print("V5_R2_OBJECTS_CREATED=NO")
    print("V5_PRIVATE_RETRIEVAL_AND_REAL_RESTORE=NOT_VERIFIED")
    print("V5_STAGING_PRODUCTION_MODIFIED=NO")
    print("V5_CREDENTIAL_ROTATION=NOT_EXECUTED")
    print("DEPLOYMENT_AUTHORIZATION=HOLD")
    return 0 if result == "PASS_READ_ONLY_REVIEW_ONLY" else 2


if __name__ == "__main__":
    sys.exit(main())
