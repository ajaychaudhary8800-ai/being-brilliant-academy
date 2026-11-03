#!/usr/bin/env python3
"""Create a sanitized CI-only previous-source image receipt for OIDC signing.

The receipt is NOT an OCI artifact, does NOT contain a Docker archive and
cannot authorize credential rotation, staging deployment or commercial GO.
It records Docker image *config* digests and rootfs diff IDs, not a trusted
registry manifest digest. No image env/history/labels or secret values printed.
"""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys

SHA = re.compile(r"^[0-9a-f]{40}$")
DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
OLDER = "b54dca5ae36a948f83012faa4a37354198fba083"
ROLES = {
    "api": "schoolos-previous-api-docs-reviewed:ci",
    "web": "schoolos-previous-web:ci",
}

class InvalidReceipt(Exception):
    pass

def docker_field(image: str, template: str) -> str:
    try:
        p = subprocess.run(
            ["docker", "image", "inspect", image, "--format", template],
            check=False, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            timeout=30, text=True,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise InvalidReceipt() from exc
    if p.returncode != 0 or len(p.stdout) > 120000:
        raise InvalidReceipt()
    return p.stdout.strip()

def inspect(image: str) -> dict:
    config_id = docker_field(image, "{{.Id}}")
    revision = docker_field(
        image, '{{index .Config.Labels "org.opencontainers.image.revision"}}')
    if not DIGEST.fullmatch(config_id) or revision != OLDER:
        raise InvalidReceipt()
    try:
        layers = json.loads(docker_field(image, "{{json .RootFS.Layers}}"))
    except (ValueError, UnicodeError) as exc:
        raise InvalidReceipt() from exc
    if (
        not isinstance(layers, list) or not (1 <= len(layers) <= 256)
        or any(not isinstance(x, str) or not DIGEST.fullmatch(x) for x in layers)
    ):
        raise InvalidReceipt()
    return {
        "config_id": config_id,
        "rootfs_diff_ids": layers,
        "revision_label": OLDER,
    }

def create_receipt(candidate: str) -> dict:
    if not SHA.fullmatch(candidate) or candidate == OLDER:
        raise InvalidReceipt()
    images = {role: inspect(name) for role, name in ROLES.items()}
    if images["api"]["config_id"] == images["web"]["config_id"]:
        raise InvalidReceipt()
    return {
        "schema": "schoolos-v5-ci-previous-source-build-receipt-v1",
        "previous_source_sha": OLDER,
        "ci_controls_source_sha": candidate,
        "previous_api_build_recipe": "DERIVED_HASH_PINNED_PUBLIC_DOCS_EXCLUDED",
        "previous_web_build_recipe": "ORIGINAL_PINNED_SOURCE",
        "image_observations": images,
        "verification_scope": "METADATA_AND_BOUNDED_IMAGE_LAYER_CHECKS_IN_WORKFLOW",
        "source_build_signature": "NOT_ATTESTED_BY_THIS_RECEIPT",
        "registry_manifest_digest": "NOT_OBSERVED",
        "immutable_artifact_custody": "NOT_ESTABLISHED",
        "private_image_retrieval": "NOT_EXECUTED",
        "actual_customer_db_compatibility": "NOT_TESTED",
        "live_credential_rotation": "NOT_EXECUTED",
        "deployment_authorization": "HOLD",
    }

def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True, type=Path)
    p.add_argument("--controls-sha", required=True)
    args = p.parse_args(argv)
    try:
        if os.environ.get("GITHUB_ACTIONS") != "true":
            raise InvalidReceipt()
        # Never allow output into the tracked checkout or arbitrary host path.
        temp_root = Path(os.environ.get("RUNNER_TEMP", "")).resolve(strict=True)
        target = args.out.resolve(strict=False)
        if target.parent != temp_root or target.exists() or target.is_symlink():
            raise InvalidReceipt()
        payload = create_receipt(args.controls_sha)
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        fd = os.open(target, flags, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(payload, stream, sort_keys=True, separators=(",", ":"))
            stream.write("\n")
        print("V5_PREVIOUS_SOURCE_BINARY_RECEIPT=PASS_METADATA_ONLY")
        print("V5_RECEIPT_CAN_BE_OIDC_ATTESTED=YES")
        print("V5_OCI_IMAGE_ARTIFACTS_SIGNED=NO")
        print("V5_IMAGE_CUSTODY_RETRIEVAL=NOT_EXECUTED")
        print("V5_ROTATION_AUTHORIZATION=HOLD")
        return 0
    except (InvalidReceipt, OSError, ValueError):
        print("V5_PREVIOUS_SOURCE_BINARY_RECEIPT=CHECK_REQUIRED")
        print("V5_SECRET_OR_RAW_IMAGE_METADATA_PRINTED=NO")
        print("V5_DEPLOYMENT_AUTHORIZATION=HOLD")
        return 2

if __name__ == "__main__":
    sys.exit(main())
