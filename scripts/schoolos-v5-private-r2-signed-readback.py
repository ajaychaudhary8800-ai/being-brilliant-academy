#!/usr/bin/env python3
"""Read-only independent Cloudflare R2 readback of owner-signed OCI archives.

This tool never uploads images, mutates R2, writes backup files, executes
Docker, contacts staging or authorizes rotation/deployment. It independently
streams two private R2 objects and compares their SHA-256 with a signed,
pinned-key custody statement. OCI manifest signatures, source provenance,
bucket lock and real DB/volume compatibility remain SEPARATE acceptance gates.

No bucket names, user-controlled file paths, remote error responses, AWS
keys, image config or archive bytes are printed.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

BUCKET = "schoolos-v5-rollback-custody"
MAX_MANIFEST_BYTES = 16 * 1024
MAX_SIGNATURE_BYTES = 8192
MAX_PUBLIC_KEY_BYTES = 8192
MAX_ARCHIVE_BYTES = 8 * 1024 * 1024 * 1024
READ_BYTES = 256 * 1024
SHA = re.compile(r"[a-f0-9]{64}\Z")
REVISION = re.compile(r"[a-f0-9]{40}\Z")
ACCOUNT = re.compile(r"[a-fA-F0-9]{32}\Z")
SCHEMA = "schoolos-v5-private-rollback-readback-v1"

class Hold(Exception):
    """Do not print untrusted exception messages."""

def _unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise Hold()
        result[key] = value
    return result

def _reject_constant(_):
    raise Hold()

def _bounded_regular(path, size):
    if not isinstance(path, (str, Path)):
        raise Hold()
    target = Path(path)
    try:
        if target.is_symlink():
            raise Hold()
        info = target.stat()
        if not stat.S_ISREG(info.st_mode) or info.st_size < 1 or info.st_size > size:
            raise Hold()
        raw = target.read_bytes()
    except (OSError, ValueError):
        raise Hold() from None
    if len(raw) != info.st_size:
        raise Hold()
    return raw

def decode_signed_manifest(raw):
    if not isinstance(raw, bytes) or not 0 < len(raw) <= MAX_MANIFEST_BYTES:
        raise Hold()
    try:
        payload = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_pairs,
                             parse_constant=_reject_constant)
    except (UnicodeError, ValueError, TypeError):
        raise Hold() from None
    if not isinstance(payload, dict) or set(payload) != {"schema", "sourceSha", "api", "web"}:
        raise Hold()
    sha = payload["sourceSha"]
    if payload["schema"] != SCHEMA or not isinstance(sha, str) or not REVISION.fullmatch(sha):
        raise Hold()
    for role in ("api", "web"):
        item = payload[role]
        if not isinstance(item, dict) or set(item) != {"key", "sha256", "sizeBytes", "ociManifestDigest"}:
            raise Hold()
        if item["key"] != f"v5-rollback/{sha}/{role}.oci.tar":
            raise Hold()
        if not isinstance(item["sha256"], str) or not SHA.fullmatch(item["sha256"]):
            raise Hold()
        if not isinstance(item["ociManifestDigest"], str) or not re.fullmatch(
                r"sha256:[a-f0-9]{64}", item["ociManifestDigest"]):
            raise Hold()
        if type(item["sizeBytes"]) is not int or not 0 < item["sizeBytes"] <= MAX_ARCHIVE_BYTES:
            raise Hold()
    if payload["api"]["sha256"] == payload["web"]["sha256"]:
        raise Hold()
    return payload

def verify_detached_signature(manifest_bytes, signature_path, pubkey_path, expected_key_sha):
    if not isinstance(expected_key_sha, str) or not SHA.fullmatch(expected_key_sha):
        raise Hold()
    key = _bounded_regular(pubkey_path, MAX_PUBLIC_KEY_BYTES)
    if not hmac.compare_digest(hashlib.sha256(key).hexdigest(), expected_key_sha):
        raise Hold()
    _bounded_regular(signature_path, MAX_SIGNATURE_BYTES)
    # Verify exactly the manifest bytes already decoded by the caller. Never
    # re-open a path, which would permit a file-replacement TOCTOU mismatch.
    try:
        process = subprocess.run(
            ["openssl", "dgst", "-sha256", "-verify", str(pubkey_path),
             "-signature", str(signature_path)],
            input=manifest_bytes,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            timeout=15, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise Hold() from None
    if process.returncode != 0:
        raise Hold()

def _read_archive_digest(client, item):
    key = item["key"]
    expected_size = item["sizeBytes"]
    try:
        head = client.head_object(Bucket=BUCKET, Key=key)
        if type(head.get("ContentLength")) is not int or head["ContentLength"] != expected_size:
            raise Hold()
        response = client.get_object(Bucket=BUCKET, Key=key)
        body = response.get("Body")
        if type(response.get("ContentLength")) is not int or response["ContentLength"] != expected_size:
            raise Hold()
        if not body or not callable(getattr(body, "read", None)) or not callable(
                getattr(body, "close", None)):
            raise Hold()
        count = 0
        digest = hashlib.sha256()
        try:
            while True:
                part = body.read(READ_BYTES)
                if not isinstance(part, bytes):
                    raise Hold()
                if not part:
                    break
                count += len(part)
                if count > expected_size:
                    raise Hold()
                digest.update(part)
        finally:
            body.close()
        if count != expected_size or not hmac.compare_digest(
                digest.hexdigest(), item["sha256"]):
            raise Hold()
    except Hold:
        raise
    except Exception:
        # S3/HTTP/client exception messages can contain bucket keys, paths,
        # account IDs and credentials. Nothing from them is emitted.
        raise Hold() from None

def readback(client, payload):
    for role in ("api", "web"):
        _read_archive_digest(client, payload[role])

def _client(account, access, secret):
    if not isinstance(account, str) or not ACCOUNT.fullmatch(account):
        raise Hold()
    if not all(isinstance(v, str) and len(v) >= 12 for v in (access, secret)):
        raise Hold()
    try:
        import boto3
        from botocore.client import Config
        return boto3.client(
            "s3", region_name="auto",
            endpoint_url=f"https://{account}.r2.cloudflarestorage.com",
            aws_access_key_id=access, aws_secret_access_key=secret,
            config=Config(signature_version="s3v4", connect_timeout=8, read_timeout=30,
                          retries={"max_attempts": 1}, s3={"addressing_style": "path"}),
        )
    except (ImportError, ValueError, TypeError):
        raise Hold() from None

def run(manifest_path, sig_path, pubkey_path, pin, client):
    raw = _bounded_regular(manifest_path, MAX_MANIFEST_BYTES)
    payload = decode_signed_manifest(raw)
    verify_detached_signature(raw, sig_path, pubkey_path, pin)
    readback(client, payload)

def main():
    # Paths are injected into the isolated owner-run process; never use a
    # command-line parameter containing access credentials or remote URLs.
    m = os.getenv("V5_CUSTODY_MANIFEST_PATH")
    s = os.getenv("V5_CUSTODY_SIGNATURE_PATH")
    k = os.getenv("V5_CUSTODY_PUBKEY_PATH")
    pin = os.getenv("V5_CUSTODY_PUBKEY_SHA256")
    account = os.getenv("CLOUDFLARE_ACCOUNT_ID")
    access = os.getenv("R2_CUSTODY_READER_ACCESS_KEY_ID")
    secret = os.getenv("R2_CUSTODY_READER_SECRET_ACCESS_KEY")
    passed = False
    try:
        if not all(isinstance(v, str) and v for v in (m, s, k)):
            raise Hold()
        # Refuse ANY network request until the manifest and pinned signature
        # are known valid. The reader credential must be separate, owner-provisioned.
        raw = _bounded_regular(m, MAX_MANIFEST_BYTES)
        payload = decode_signed_manifest(raw)
        verify_detached_signature(raw, s, k, pin)
        print("PRIVATE_CUSTODY_MANIFEST_SIGNATURE=PASS_PINNED_PUBLIC_KEY")
        readback(_client(account, access, secret), payload)
        passed = True
    except Hold:
        pass
    print("PRIVATE_R2_TWO_ARCHIVE_READBACK=" + ("PASS_FULL_BYTES_SHA256" if passed else "HOLD"))
    print("OCI_MANIFEST_DIGEST_SIGNATURE=NOT_VERIFIED_BY_THIS_TOOL")
    print("R2_READONLY_KEY_PERMISSIONS=NOT_VERIFIED_BY_THIS_TOOL")
    print("R2_BUCKET_LOCK_PUBLIC_EXPOSURE=SEPARATE_PREFLIGHT_REQUIRED")
    print("REAL_CHECKPOINT_DB_APP_COMPATIBILITY=NOT_VERIFIED_BY_THIS_TOOL")
    print("IMAGES_OR_SECRETS_PRINTED=NO")
    print("R2_OR_STAGING_WRITES=NO")
    print("HISTORICAL_CREDENTIAL_ROTATION=NOT_EXECUTED")
    print("DEPLOYMENT_AUTHORIZATION=HOLD")
    print("COMMERCIAL_GO=HOLD")
    return 0 if passed else 2

if __name__ == "__main__":
    sys.exit(main())
