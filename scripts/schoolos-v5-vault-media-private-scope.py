#!/usr/bin/env python3
"""V5 offline checkpoint: Vault/media *scope* only, not keys or media retrieval.

Uses a privately copied V5 backup and an owner-local Windows Docker Desktop
named-pipe engine. Restores ONLY five selected schema tables into ephemeral
network-none PostgreSQL; prints/records aggregate counts only. Never selects
encrypted document bytes, file names, object keys, URLs, IDs, PII or secrets.
No vault decryption, R2 request, providers, live services, external networks,
CI customer data, or staging/production access.

This is a distinct evidence scope from full real DB/file restore, already PASS.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import re
import secrets
import sys

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "schoolos-v5-owner-isolated-checkpoint-restore.py"
SPEC = importlib.util.spec_from_file_location("private_restore", SOURCE)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("BASE_RECOVERY_HELPER_NOT_AVAILABLE")
BASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BASE)

CHECKPOINT_ID = BASE.CHECKPOINT_ID

# Exact table names from the pinned Prisma V5 schema; pg_restore -t selects
# only that table's definition and data, not the rest of the customer database.
VAULT_AND_MEDIA_TABLES = (
    "SaaSCommercialDocument",
    "LiveClass",
    "StudyMaterial",
    "MeetingRecording",
    "MeetingAttachment",
)

# Every SQL query is strictly aggregate-only. No raw document/key/URL/id field
# may be selected, exported, hashed, printed, or transmitted.
COUNT_SQL = {
    "vault_document_rows":
        'SELECT count(*) FROM "SaaSCommercialDocument"',
    "vault_ciphertext_header_invalid":
        '''SELECT count(*) FROM "SaaSCommercialDocument"
           WHERE octet_length("encryptedFileData") < 33
              OR substring("encryptedFileData" from 1 for 4)
                 <> decode('43445631','hex')''',
    "liveclass_rows":
        'SELECT count(*) FROM "LiveClass"',
    "liveclass_recording_object_references":
        '''SELECT count(*) FROM "LiveClass" WHERE
           nullif(btrim("recordingObjectKey"),'') IS NOT NULL''',
    "liveclass_egress_references":
        '''SELECT count(*) FROM "LiveClass" WHERE
           nullif(btrim("recordingEgressId"),'') IS NOT NULL''',
    "liveclass_recording_url_references":
        '''SELECT count(*) FROM "LiveClass" WHERE
           nullif(btrim("recordingUrl"),'') IS NOT NULL''',
    "study_material_rows":
        'SELECT count(*) FROM "StudyMaterial"',
    "study_material_external_storage_references":
        '''SELECT count(*) FROM "StudyMaterial" WHERE
           nullif(btrim("storageKey"),'') IS NOT NULL''',
    "study_material_inline_file_rows":
        'SELECT count(*) FROM "StudyMaterial" WHERE "fileData" IS NOT NULL',
    "meeting_recording_rows":
        'SELECT count(*) FROM "MeetingRecording"',
    "meeting_recording_external_storage_references":
        '''SELECT count(*) FROM "MeetingRecording" WHERE
           nullif(btrim("storageKey"),'') IS NOT NULL''',
    "meeting_attachment_external_storage_references":
        'SELECT count(*) FROM "MeetingAttachment" WHERE "storageKey" IS NOT NULL',
}

# Explicit allowlist to prevent a future accidental content query.
SCALAR_QUERY = re.compile(r"""(?is)^\s*select\s+count\(\*\)\s+from\s+"(?:SaaSCommercialDocument|LiveClass|StudyMaterial|MeetingRecording|MeetingAttachment)"(?:\s+where\s+.+)?\s*$""")


def validated_count_query(label: str) -> str:
    query = COUNT_SQL.get(label, "")
    if not SCALAR_QUERY.fullmatch(query):
        raise BASE.RecoveryFailure("NON_AGGREGATE_QUERY_REFUSED")
    if ";" in query or "--" in query:
        raise BASE.RecoveryFailure("UNSAFE_SQL_REFUSED")
    return query


def audit_live_restored_subset(cid: str) -> dict[str, int]:
    values = {}
    for field in COUNT_SQL:
        values[field] = BASE.pg_scalar(cid, validated_count_query(field))
    return values


def run_owner_isolated_scope(checkpoint: Path, preflight: dict) -> dict:
    image = BASE.require_local_engine()
    name = "v5-private-vaultscope-" + secrets.token_hex(10)
    pwd = secrets.token_hex(24)
    cid = None
    owned = False
    deleted = False
    started = datetime.now(timezone.utc)
    try:
        args = BASE.build_container_command(checkpoint, name, pwd, 2048, 64)
        if args[args.index("--network") + 1] != "none":
            raise BASE.RecoveryFailure("NETWORK_ISOLATION_REQUIRED")
        if "--read-only" not in args or "--pull=never" not in args:
            raise BASE.RecoveryFailure("IMMUTABLE_ISOLATION_REQUIRED")
        if any(item in args for item in ("-p", "--publish", "-v", "--volume", "--privileged")):
            raise BASE.RecoveryFailure("LIVE_RESOURCE_FLAG_REFUSED")
        _, raw = BASE.docker(args, timeout=90)
        cid = raw.decode("ascii", errors="ignore").strip()
        BASE.verify_container_identity(cid, name)
        owned = True
        print("VAULT_MEDIA_SCOPE_ISOLATION=NETWORK_NONE_TMPFS_ONLY")
        BASE.wait_for_isolated_pg(cid)
        print("VAULT_MEDIA_SCOPE_POSTGRES=PASS")

        # Protect against an input change between host-side SHA preflight
        # and container-side selected-table restore.
        for basename in ("database.dump", "files.tar.gz"):
            expected = BASE.PREFLIGHT.digest(checkpoint / basename)
            _, raw_hash = BASE.docker([
                "exec", "--user", "postgres", cid, "sha256sum",
                "/isolated-checkpoint/" + basename,
            ], timeout=180)
            actual = raw_hash.decode("ascii", errors="ignore").split(" ", 1)[0]
            if actual != expected:
                raise BASE.RecoveryFailure("CHECKPOINT_MOUNT_CONTENT_DRIFT")
        print("VAULT_MEDIA_SCOPE_INPUT_PARITY=PASS")

        # Only the needed archive tables are restored, with no application boot.
        # No SQL values, pg_restore output or stderr may enter the caller log.
        for table in VAULT_AND_MEDIA_TABLES:
            BASE.docker([
                "exec", "--user", "postgres", cid,
                "pg_restore", "--no-owner", "--no-acl",
                "--exit-on-error", "--single-transaction",
                "--username=v5_isolated_restore",
                "--dbname=v5_isolated_restore",
                "--table=" + table,
                "/isolated-checkpoint/database.dump",
            ], timeout=900)

        counts = audit_live_restored_subset(cid)
        if counts["vault_ciphertext_header_invalid"] > counts["vault_document_rows"]:
            raise BASE.RecoveryFailure("IMPOSSIBLE_VAULT_AGGREGATES")
        if (counts["liveclass_recording_object_references"] > counts["liveclass_rows"] or
            counts["liveclass_egress_references"] > counts["liveclass_rows"] or
            counts["liveclass_recording_url_references"] > counts["liveclass_rows"] or
            counts["study_material_external_storage_references"] > counts["study_material_rows"] or
            counts["study_material_inline_file_rows"] > counts["study_material_rows"] or
            counts["meeting_recording_external_storage_references"] > counts["meeting_recording_rows"]):
            raise BASE.RecoveryFailure("IMPOSSIBLE_MEDIA_AGGREGATES")

        print("VAULT_MEDIA_SCOPE_AGGREGATES=PASS")
        ended = datetime.now(timezone.utc)
        media_refs = (
            counts["liveclass_recording_object_references"]
            + counts["liveclass_recording_url_references"]
            + counts["study_material_external_storage_references"]
            + counts["meeting_recording_external_storage_references"]
            + counts["meeting_attachment_external_storage_references"]
        )
        return {
            "checkpoint_id": CHECKPOINT_ID,
            "scope_mode": "OWNER_LOCAL_SELECTED_TABLES_ONLY",
            "checkpoint_internal_checksums": preflight["manifest_checksums"],
            "checkpoint_origin_authenticity": preflight["origin_manifest_authenticity"],
            "vault_document_rows": counts["vault_document_rows"],
            "vault_ciphertext_header_invalid": counts["vault_ciphertext_header_invalid"],
            "vault_ciphertext_header_check": (
                "PASS_HEADER_ONLY" if counts["vault_ciphertext_header_invalid"] == 0
                else "CHECK_REQUIRED_INVALID_HEADER"
            ),
            "vault_key_custody": "NOT_VERIFIED",
            "vault_decryption": "NOT_EXECUTED",
            "liveclass_rows": counts["liveclass_rows"],
            "liveclass_recording_object_references": counts["liveclass_recording_object_references"],
            "liveclass_egress_references": counts["liveclass_egress_references"],
            "liveclass_recording_url_references": counts["liveclass_recording_url_references"],
            "study_material_rows": counts["study_material_rows"],
            "study_material_external_storage_references": counts["study_material_external_storage_references"],
            "study_material_inline_file_rows": counts["study_material_inline_file_rows"],
            "meeting_recording_rows": counts["meeting_recording_rows"],
            "meeting_recording_external_storage_references": counts["meeting_recording_external_storage_references"],
            "meeting_attachment_external_storage_references": counts["meeting_attachment_external_storage_references"],
            "external_media_reference_presence": "YES" if media_refs else "NO_DB_REFERENCE_FOUND",
            "r2_head_and_playback": "NOT_EXECUTED",
            "media_scope_final_signoff": "PENDING",
            "postgres_base_image_digest": image,
            "postgresql_network": "none",
            "postgresql_storage": "tmpfs_only",
            "isolated_scope_utc_start": started.isoformat(),
            "isolated_scope_utc_finish": ended.isoformat(),
            "customer_data_or_object_keys_printed": False,
            "staging_and_production_changed": False,
            "commercial_go": "HOLD",
        }
    finally:
        if cid and owned and BASE.CONTAINER_ID.fullmatch(cid):
            try:
                BASE.verify_container_identity(cid, name)
                code, _ = BASE.docker(["rm", "-f", cid], expected=False, timeout=60)
                deleted = code == 0
            except BASE.RecoveryFailure:
                deleted = False
        if cid is not None:
            if not deleted:
                print("VAULT_MEDIA_SCOPE_CLEANUP=CHECK_REQUIRED")
                raise BASE.RecoveryFailure("OWNER_ISOLATED_SCOPE_CLEANUP_FAILED")
            print("VAULT_MEDIA_SCOPE_CLEANUP=PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint-dir", type=Path, required=True)
    parser.add_argument("--checkpoint-id", required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--acknowledge-private-offline-checkpoint", action="store_true")
    parser.add_argument("--trusted-manifest-sha256")
    args = parser.parse_args()
    try:
        if args.checkpoint_id != CHECKPOINT_ID:
            raise BASE.RecoveryFailure("CHECKPOINT_ID_MISMATCH")
        if not args.acknowledge_private_offline_checkpoint:
            raise BASE.RecoveryFailure("OWNER_PRIVATE_ISOLATE_ACK_REQUIRED")
        if args.trusted_manifest_sha256 and not re.fullmatch(r"[0-9a-f]{64}", args.trusted_manifest_sha256):
            raise BASE.RecoveryFailure("TRUSTED_MANIFEST_DIGEST_INVALID")
        checkpoint = BASE.guarded_checkpoint_path(args.checkpoint_dir)
        reportpath = args.report.resolve(strict=False)
        if reportpath == checkpoint or checkpoint in reportpath.parents:
            raise BASE.RecoveryFailure("REPORT_UNDER_CHECKPOINT_REFUSED")
        preflight = BASE.PREFLIGHT.preflight(checkpoint, args.trusted_manifest_sha256)
        print("VAULT_MEDIA_CHECKPOINT_PREFLIGHT=PASS_CONTENT_ONLY")
        report = run_owner_isolated_scope(checkpoint, preflight)
        BASE.PREFLIGHT.write_report_exclusive(args.report, report)
        print("VAULT_MEDIA_METADATA_SCOPE=PASS")
        print("VAULT_KEY_CUSTODY=NOT_VERIFIED")
        print("VAULT_DECRYPTION=NOT_EXECUTED")
        print("R2_HEAD_PLAYBACK=NOT_EXECUTED")
        print("SANITIZED_REPORT=PASS")
        print("STAGING_AND_PRODUCTION_CHANGED=NO")
        print("COMMERCIAL_GO=HOLD")
        return 0
    except (BASE.RecoveryFailure, BASE.PREFLIGHT.PreflightFailure) as err:
        code = str(err)
        if not re.fullmatch(r"[A-Z_0-9]{2,90}", code):
            code = "UNCLASSIFIED_FAILURE"
        print("VAULT_MEDIA_METADATA_SCOPE=CHECK_REQUIRED_" + code)
        print("PRIVATE_DATA_PRINTED=NO")
        print("COMMERCIAL_GO=HOLD")
        return 2
    except (OSError, ValueError):
        print("VAULT_MEDIA_METADATA_SCOPE=CHECK_REQUIRED_LOCAL_IO")
        print("PRIVATE_DATA_PRINTED=NO")
        print("COMMERCIAL_GO=HOLD")
        return 2


if __name__ == "__main__":
    sys.exit(main())
