#!/usr/bin/env python3
"""P0 #293: inspect Docker-save archive CONFIG JSON only, without extracting.

READ-ONLY and values-free. Does not read layer tar payloads or Docker registry.
Do not claim cleaned images from a history-only PASS. An incident-affected tar
must remain restricted even after this inspection.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import sys
import tarfile

CONFIG_NAME = re.compile(r"^[a-f0-9]{64}\.json$")
KEYS = (
    "DATABASE_URL", "POSTGRES_PASSWORD", "REDIS_PASSWORD",
    "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET",
    "COMMERCIAL_DOCUMENT_ENCRYPTION_KEY",
    "PAYMENT_CREDENTIAL_ENCRYPTION_KEY", "RAZORPAY_KEY_SECRET",
    "RAZORPAY_WEBHOOK_SECRET", "LIVEKIT_API_SECRET",
    "LIVEKIT_RECORDING_S3_SECRET_ACCESS_KEY",
    "AWS_SECRET_ACCESS_KEY", "BACKUP_AWS_SECRET_ACCESS_KEY",
    "SMTP_PASSWORD", "AI_API_KEY", "TWILIO_AUTH_TOKEN",
    "WHATSAPP_ACCESS_TOKEN",
)
MAX_MANIFEST = 1024 * 1024
MAX_CONFIG = 4 * 1024 * 1024


class UnsafeMetadata(Exception):
    pass


def assignment(text: str, name: str) -> bool:
    return bool(re.search(
        r"(^|[^A-Za-z0-9_])" + name + r"\s*(=|:)", text,
        re.IGNORECASE,
    ))


def inspect_config(config: dict) -> set[str]:
    if not isinstance(config, dict) or not isinstance(config.get("history"), list):
        raise UnsafeMetadata("INVALID_CONFIG_SCHEMA")
    runtime = config.get("config", {})
    if not isinstance(runtime, dict):
        raise UnsafeMetadata("INVALID_RUNTIME_CONFIG")
    env = runtime.get("Env", [])
    if not isinstance(env, list):
        raise UnsafeMetadata("INVALID_RUNTIME_ENV")
    labels = runtime.get("Labels") or {}
    if not isinstance(labels, dict):
        raise UnsafeMetadata("INVALID_RUNTIME_LABELS")
    fields = [
        *[v for v in env if isinstance(v, str)],
        *[row.get("created_by", "") for row in config["history"] if isinstance(row, dict)],
        *[str(k) + "=" + str(v) for k, v in labels.items()],
    ]
    if any(not isinstance(v, str) for v in fields):
        raise UnsafeMetadata("INVALID_IMAGE_HISTORY")
    return {name for name in KEYS
            if any(assignment(value, name) for value in fields)}


def inspect_docker_archive(file: Path) -> dict:
    with tarfile.open(file, mode="r:*") as tar:
        members = {m.name: m for m in tar.getmembers()}
        manifest = members.get("manifest.json")
        if manifest is None or not manifest.isfile() or not 0 < manifest.size <= MAX_MANIFEST:
            raise UnsafeMetadata("DOCKER_SAVE_MANIFEST_REQUIRED")
        fileobj = tar.extractfile(manifest)
        if fileobj is None:
            raise UnsafeMetadata("MANIFEST_NOT_READABLE")
        entries = json.loads(fileobj.read(MAX_MANIFEST + 1))
        if not isinstance(entries, list) or not 1 <= len(entries) <= 12:
            raise UnsafeMetadata("UNEXPECTED_IMAGE_COUNT")
        inspected = []
        for row in entries:
            name = row.get("Config") if isinstance(row, dict) else None
            if not isinstance(name, str) or not CONFIG_NAME.fullmatch(name):
                raise UnsafeMetadata("UNSAFE_IMAGE_CONFIG_REFERENCE")
            metadata = members.get(name)
            if metadata is None or not metadata.isfile() or not 16 < metadata.size <= MAX_CONFIG:
                raise UnsafeMetadata("IMAGE_CONFIG_MISSING_OR_TOO_LARGE")
            raw = tar.extractfile(metadata)
            if raw is None:
                raise UnsafeMetadata("IMAGE_CONFIG_NOT_READABLE")
            config = json.loads(raw.read(MAX_CONFIG + 1))
            inspected.append(inspect_config(config))
        names = sorted(set().union(*inspected))
        return {
            "images_inspected": len(inspected),
            "sensitive_metadata_names": names,
            "vault_key_name_in_metadata": "COMMERCIAL_DOCUMENT_ENCRYPTION_KEY" in names,
        }


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--archive", type=Path, required=True)
    a = p.parse_args()
    try:
        if sys.platform != "win32":
            raise UnsafeMetadata("WINDOWS_OWNER_LOCAL_REQUIRED")
        if not a.archive.is_file() or a.archive.is_symlink():
            raise UnsafeMetadata("ARCHIVE_NOT_FOUND")
        if str(a.archive).startswith("\\\\"):
            raise UnsafeMetadata("REMOTE_ARCHIVE_REFUSED")
        result = inspect_docker_archive(a.archive)
        print("IMAGE_ARCHIVE_CONFIGS_INSPECTED=" + str(result["images_inspected"]))
        print("IMAGE_ARCHIVE_SECRET_HISTORY=" + (
            "REJECT_PRESENT" if result["sensitive_metadata_names"] else "PASS_METADATA_ONLY"
        ))
        print("VAULT_KEY_NAME_IN_ARCHIVED_METADATA=" + (
            "YES" if result["vault_key_name_in_metadata"] else "NO_METADATA_ONLY"
        ))
        # names are public variable labels; never include values or raw history.
        if result["sensitive_metadata_names"]:
            print("EXPOSED_VARIABLE_NAMES=" + ",".join(result["sensitive_metadata_names"]))
        print("IMAGE_LAYERS_SCANNED=NO")
        print("IMAGE_ORIGIN_SIGNED=NOT_ATTESTED")
        print("PROTECTED_VAULT_ESCROW=NOT_ESTABLISHED_BY_THIS_TEST")
        print("STAGING_AND_PRODUCTION_CHANGED=NO")
        print("COMMERCIAL_GO=HOLD")
        return 2 if result["sensitive_metadata_names"] else 0
    except (UnsafeMetadata, OSError, ValueError, json.JSONDecodeError, tarfile.TarError):
        print("IMAGE_ARCHIVE_CONFIG_AUDIT=CHECK_REQUIRED")
        print("IMAGE_METADATA_SECRET_VALUES_PRINTED=NO")
        print("COMMERCIAL_GO=HOLD")
        return 2


if __name__ == "__main__":
    sys.exit(main())
