#!/usr/bin/env python3
"""V5 previous-source OCI *candidate* manifest draft; never sign or publish.

Operates only on two new owner-authorized, trusted-local OCI image-layout TARs.
Reuses the strict OCI layout, full-rootfs DiffID, and complete archive-byte
integrity checks from the private offline rollback verifier. This output is a
UNSIGNED CANDIDATE RECEIPT, not a clean-build certificate, source-build
attestation, signed manifest, R2 custody, or recovery authorization.
No Docker, R2, network, image extraction, customer data or key reads/writes.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys
import tarfile

OLDER = "b54dca5ae36a948f83012faa4a37354198fba083"
DIGEST = re.compile(r"sha256:[a-f0-9]{64}\Z")
MAX_INDEX = 2 * 1024 * 1024
SENSITIVE_NAMES = (
    "DATABASE_URL", "POSTGRES_PASSWORD", "REDIS_PASSWORD",
    "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET",
    "COMMERCIAL_DOCUMENT_ENCRYPTION_KEY", "PAYMENT_CREDENTIAL_ENCRYPTION_KEY",
    "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "LIVEKIT_API_SECRET",
    "LIVEKIT_RECORDING_S3_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY",
    "BACKUP_AWS_SECRET_ACCESS_KEY", "SMTP_PASSWORD", "AI_API_KEY",
    "TWILIO_AUTH_TOKEN", "WHATSAPP_ACCESS_TOKEN",
)
ROOT = Path(__file__).resolve().parent


class Hold(Exception):
    """Never attach private details, path names or metadata to this exception."""


def _load(name, filename):
    path = ROOT / filename
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise Hold()
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
    except (OSError, ValueError, ImportError, AttributeError, SystemExit):
        raise Hold() from None
    return module


def _small_blob(tar, digest, verifier):
    if not isinstance(digest, str) or not DIGEST.fullmatch(digest):
        raise Hold()
    try:
        member = tar.getmember("blobs/sha256/" + digest[7:])
    except KeyError:
        raise Hold() from None
    if not member.isfile() or not 0 < member.size <= MAX_INDEX:
        raise Hold()
    stream = tar.extractfile(member)
    if stream is None:
        raise Hold()
    contents = stream.read(MAX_INDEX + 1)
    if len(contents) != member.size:
        raise Hold()
    if ("sha256:" + hashlib.sha256(contents).hexdigest()) != digest:
        raise Hold()
    try:
        value = verifier._safe_json(contents)
    except verifier.Hold:
        raise Hold() from None
    if not isinstance(value, dict):
        raise Hold()
    return value


def _reject_sensitive_config(config):
    """Reject key assignments in OCI runtime env, labels and image history.

    Full rootfs filesystem semantic scanning is a SEPARATE acceptance gate;
    this fixed-name check cannot certify image cleanliness.
    """
    runtime = config.get("config")
    if not isinstance(runtime, dict):
        raise Hold()
    env = runtime.get("Env", [])
    labels = runtime.get("Labels", {})
    history = config.get("history", [])
    if (not isinstance(env, list) or
            not all(isinstance(x, str) for x in env) or
            not isinstance(labels, dict) or
            not all(isinstance(k, str) and isinstance(v, str)
                    for k, v in labels.items()) or
            not isinstance(history, list) or
            not all(isinstance(x, dict) and
                    (x.get("created_by") is None or isinstance(x["created_by"], str))
                    for x in history)):
        raise Hold()
    strings = env + [k + "=" + v for k, v in labels.items()] + [
        x["created_by"] for x in history if isinstance(x.get("created_by"), str)
    ]
    for name in SENSITIVE_NAMES:
        pattern = re.compile(r"(?:^|[^A-Za-z0-9_])" + re.escape(name) +
                             r"\s*(?:=|:)", flags=re.IGNORECASE)
        if any(pattern.search(line) for line in strings):
            raise Hold()


def _candidate(path, source=OLDER):
    if source != OLDER or not isinstance(path, (str, Path)):
        raise Hold()
    verifier = _load("v5_candidate_oci_verifier",
                     "schoolos-v5-private-oci-offline-verify.py")
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
    if not hasattr(os, "O_NOFOLLOW"):
        raise Hold()
    flags |= os.O_NOFOLLOW
    try:
        fd = os.open(path, flags)
        with os.fdopen(fd, "rb") as fh:
            before = os.fstat(fh.fileno())
            if (not stat.S_ISREG(before.st_mode) or
                    not 0 < before.st_size <= verifier.signed.MAX_ARCHIVE_BYTES):
                raise Hold()
            # Discover the single OCI manifest descriptor using only the
            # metadata index. The actual full tar + referenced blobs will
            # be verified using a second pass on this SAME file descriptor.
            with tarfile.open(fileobj=fh, mode="r:") as tar:
                members = tar.getmembers()
                if len(members) > verifier.MAX_TAR_MEMBERS:
                    raise Hold()
                indexes = [m for m in members if m.name in ("index.json", "./index.json")]
                if len(indexes) != 1 or not indexes[0].isfile() or not 0 < indexes[0].size <= MAX_INDEX:
                    raise Hold()
                stream = tar.extractfile(indexes[0])
                if stream is None:
                    raise Hold()
                idx = verifier._safe_json(stream.read(MAX_INDEX + 1))
                if (not isinstance(idx, dict) or idx.get("schemaVersion") != 2 or
                        not isinstance(idx.get("manifests"), list) or
                        len(idx["manifests"]) != 1 or
                        not isinstance(idx["manifests"][0], dict)):
                    raise Hold()
                descriptor = idx["manifests"][0]
                md = descriptor.get("digest")
                if (not isinstance(md, str) or not DIGEST.fullmatch(md) or
                        descriptor.get("mediaType") != "application/vnd.oci.image.manifest.v1+json"):
                    raise Hold()
                manifest = _small_blob(tar, md, verifier)
                config_descriptor = manifest.get("config")
                if not isinstance(config_descriptor, dict):
                    raise Hold()
                config = _small_blob(tar, config_descriptor.get("digest"), verifier)
                _reject_sensitive_config(config)
            fh.seek(0)
            reader = verifier.HashingReader(fh)
            verifier._inspect_tar(reader, md, source)
            after = os.fstat(fh.fileno())
            if (before.st_dev != after.st_dev or before.st_ino != after.st_ino or
                    before.st_size != after.st_size or
                    before.st_mtime_ns != after.st_mtime_ns or
                    reader.count != before.st_size):
                raise Hold()
            return {"digest": reader.sha.hexdigest(), "size": reader.count,
                    "oci_manifest": md, "dev": before.st_dev, "ino": before.st_ino}
    except (OSError, ValueError, TypeError, KeyError, tarfile.TarError, verifier.Hold):
        raise Hold() from None


def candidate_receipt(api, web):
    left = _candidate(api)
    right = _candidate(web)
    if ((left["dev"], left["ino"]) == (right["dev"], right["ino"]) or
            left["digest"] == right["digest"] or
            left["oci_manifest"] == right["oci_manifest"]):
        raise Hold()
    payload = {
        "schema": "schoolos-v5-private-rollback-readback-v1",
        "sourceSha": OLDER,
        "api": {
            "key": f"v5-rollback/{OLDER}/api.oci.tar",
            "sha256": left["digest"],
            "sizeBytes": left["size"],
            "ociManifestDigest": left["oci_manifest"],
        },
        "web": {
            "key": f"v5-rollback/{OLDER}/web.oci.tar",
            "sha256": right["digest"],
            "sizeBytes": right["size"],
            "ociManifestDigest": right["oci_manifest"],
        },
    }
    signed = _load("v5_candidate_readback_schema",
                   "schoolos-v5-private-r2-signed-readback.py")
    try:
        signed.decode_signed_manifest(
            json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8"))
    except signed.Hold:
        raise Hold() from None
    # The schema matches the eventual custody contract; no cryptographic
    # signing or source-to-build provenance is implied or carried out here.
    return payload


def write_new_receipt(payload, path, *, temp_root):
    output = Path(path)
    root = Path(temp_root)
    try:
        if (not root.is_dir() or root.is_symlink() or
                output.parent.resolve(strict=True) != root.resolve(strict=True) or
                output.is_symlink() or output.exists()):
            raise Hold()
        data = (json.dumps(payload, sort_keys=True, separators=(",", ":")) + "\n").encode()
        if len(data) > 16 * 1024:
            raise Hold()
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_CLOEXEC", 0)
        if not hasattr(os, "O_NOFOLLOW"):
            raise Hold()
        fd = os.open(output, flags | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
    except (OSError, ValueError):
        raise Hold() from None


def main(argv=None):
    ap = argparse.ArgumentParser(description="Unsigned local OCI candidate manifest; never uploads")
    ap.add_argument("--api", required=True)
    ap.add_argument("--web", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    try:
        # For CI, the isolated runner temporary directory is the only allowed
        # receipt destination. Explicit source approval and clean semantic scan
        # are independent mandatory controls outside this helper.
        root = os.environ.get("RUNNER_TEMP")
        if not root:
            raise Hold()
        result = candidate_receipt(args.api, args.web)
        write_new_receipt(result, args.out, temp_root=root)
        status = "PASS_OCI_CONTENT_UNSIGNED_CANDIDATE_ONLY"
        rc = 0
    except Hold:
        status = "HOLD"
        rc = 2
    print("V5_PREVIOUS_OCI_CANDIDATE_DRAFT=" + status)
    print("V5_PREVIOUS_IMAGE_SEMANTIC_SECRET_CLEARANCE=NOT_ATTESTED")
    print("V5_PREVIOUS_SOURCE_TO_BUILD_ATTESTATION=NOT_VERIFIED")
    print("V5_PRIOR_OCI_SIGNED_OR_PUBLISHED=NO")
    print("V5_PRIVATE_R2_OBJECTS_WRITTEN=NO")
    print("V5_REAL_CHECKPOINT_APPLICATION_RECOVERY=NOT_TESTED")
    print("V5_PRODUCTION_STAGING_CHANGED=NO")
    print("DEPLOYMENT_AUTHORIZATION=HOLD")
    return rc


if __name__ == "__main__":
    sys.exit(main())
