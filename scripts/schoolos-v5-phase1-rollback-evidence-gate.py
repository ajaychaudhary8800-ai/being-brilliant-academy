#!/usr/bin/env python3
"""V5 Phase-1 immutable rollback PREPARATION policy; non-deploying, fail-closed.

Consumes a SANITIZED operator evidence index only. Tests completeness, NOT
authenticity. Never reads image layers, source secrets, registry credentials,
environment files, database data or customer identifiers; never emits raw input.
Even policy PASS cannot authorize deployment, migration, rotation or commercial GO.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import re
import sys

PROJECT = "96ffcu0jinuwlnaqxpltln4p"
HEX40 = re.compile(r"[0-9a-f]{40}\Z")
DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")
REF = re.compile(r"EVIDENCE-[A-Z0-9][A-Z0-9_-]{5,95}\Z")
ROLES = ("api", "web", "backup")
REQUIRED = (
    "archive_access_restricted",
    "registry_pull_audience_reviewed",
    "legacy_artifacts_retained_under_forensic_hold",
    "build_args_scoped_to_nonsensitive_values",
    "deployment_config_reviewed",
    "existing_volume_map_verified",
    "offline_restore_reused",
    "db_forward_backward_compatibility_reviewed",
    "staging_recovery_runbook_reviewed",
)
IMAGE_CHECKS = (
    "metadata_audit",
    "full_layer_audit",
    "immutable_copy_retrieval",
    "source_to_image_attestation",
    "isolated_app_boot",
)
LIMIT_BYTES = 24 * 1024

class InvalidEvidence(Exception):
    pass

def receipt_valid(value):
    return isinstance(value, dict) and set(value) == {"result", "ref"} and (
        value["result"] in ("PASS", "PENDING", "FAIL")
    ) and isinstance(value["ref"], str) and bool(REF.fullmatch(value["ref"]))

def review(data):
    """Return only PUBLIC field names and policy status; never echo raw values."""
    if not isinstance(data, dict):
        raise InvalidEvidence()
    if set(data) != {"schema", "staging_project", "candidate_source_sha",
                     "images", "controls", "phase2_release", "rotation_window"}:
        raise InvalidEvidence()
    if data["schema"] != "schoolos-v5-rollback-v1" or data["staging_project"] != PROJECT:
        raise InvalidEvidence()
    if not isinstance(data["candidate_source_sha"], str) or not HEX40.fullmatch(
        data["candidate_source_sha"]
    ):
        raise InvalidEvidence()
    images = data["images"]
    controls = data["controls"]
    if not isinstance(images, dict) or set(images) != set(ROLES):
        raise InvalidEvidence()
    if not isinstance(controls, dict) or set(controls) != set(REQUIRED):
        raise InvalidEvidence()
    if any(not receipt_valid(v) for v in controls.values()):
        raise InvalidEvidence()
    problems = ["CONTROL_" + k.upper() for k in REQUIRED if controls[k]["result"] != "PASS"]
    for role in ROLES:
        entry = images[role]
        if not isinstance(entry, dict) or set(entry) != {
            "image_digest", "source_sha", *IMAGE_CHECKS
        }:
            raise InvalidEvidence()
        if not isinstance(entry["image_digest"], str) or not DIGEST.fullmatch(entry["image_digest"]):
            raise InvalidEvidence()
        if not isinstance(entry["source_sha"], str) or not HEX40.fullmatch(entry["source_sha"]):
            raise InvalidEvidence()
        if entry["source_sha"] != data["candidate_source_sha"]:
            problems.append("SOURCE_MISMATCH_" + role.upper())
        for name in IMAGE_CHECKS:
            if not receipt_valid(entry[name]):
                raise InvalidEvidence()
            if entry[name]["result"] != "PASS":
                problems.append("IMAGE_" + role.upper() + "_" + name.upper())
    for flag in ("phase2_release", "rotation_window"):
        if not receipt_valid(data[flag]):
            raise InvalidEvidence()
        if data[flag]["result"] != "PASS":
            problems.append(flag.upper() + "_NOT_APPROVED")
    return problems

def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--sanitized-index", type=Path, required=True)
    opts = parser.parse_args(argv)
    try:
        info = opts.sanitized_index
        if info.is_symlink() or not info.is_file() or info.stat().st_size > LIMIT_BYTES:
            raise InvalidEvidence()
        with info.open("r", encoding="utf-8") as file:
            payload = json.load(file)
        problems = review(payload)
        for name in sorted(set(problems)):
            print("ROLLBACK_POLICY_MISSING=" + name)
        # PASS means the declared index satisfies the checklist, NOT that
        # its external evidence is authentic or the rollback was exercised.
        print("ROLLBACK_EVIDENCE_INDEX=" + (
            "PASS_DECLARATIONS_ONLY" if not problems else "HOLD_INCOMPLETE"
        ))
        print("IMMUTABLE_ARTIFACTS_AUTHENTICITY=NOT_ATTESTED_BY_THIS_TOOL")
        print("ACTUAL_DB_COMPATIBILITY=NOT_TESTED_BY_THIS_TOOL")
        print("IMAGE_ARCHIVE_ACCESS_CHANGES=NO")
        print("STAGING_AND_PRODUCTION_CHANGED=NO")
        print("CREDENTIAL_ROTATION=NOT_EXECUTED")
        print("DEPLOYMENT_AUTHORIZATION=HOLD")
        print("COMMERCIAL_GO=HOLD")
        return 0 if not problems else 2
    except (InvalidEvidence, OSError, UnicodeError, ValueError, TypeError):
        print("ROLLBACK_EVIDENCE_INDEX=CHECK_REQUIRED")
        print("INPUT_OR_SECRET_VALUES_PRINTED=NO")
        print("STAGING_AND_PRODUCTION_CHANGED=NO")
        print("CREDENTIAL_ROTATION=NOT_EXECUTED")
        print("DEPLOYMENT_AUTHORIZATION=HOLD")
        return 2

if __name__ == "__main__":
    sys.exit(main())
