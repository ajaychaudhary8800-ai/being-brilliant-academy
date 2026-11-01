#!/usr/bin/env python3
"""Offline, owner-controlled V5 Vault plaintext-authentication *readback only*.

NO staging secrets. NO VPS, Coolify, R2 or cloud access. Requires an already
independently escrowed, authorized original key, with custody outside the
suspected exposed image/runtime path; aborts otherwise.

Private ciphertext is queried ONLY from networkless disposable PostgreSQL
restored from the already privately copied checkpoint. Bytes pass in memory
to local Node AES-256-GCM; neither secret nor plaintext is printed/stored.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "private_v5_restore",
    HERE / "schoolos-v5-owner-isolated-checkpoint-restore.py",
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("BASE_RESTORE_HELPER_NOT_AVAILABLE")
BASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BASE)

MAX_ENCRYPTED = 10 * 1024 * 1024 + 32
READ_LIMIT = 2 * MAX_ENCRYPTED + 1024
ALLOWED_CONTEXT = "desktop-linux"
QUERY = (
    'SELECT encode("encryptedFileData", \'hex\') || \'|\' || '
    '"contentSha256" || \'|\' || "fileSize"::text '
    'FROM "SaaSCommercialDocument" LIMIT 1'
)


def protected_local_escrow(key_file: Path, checkpoint: Path) -> Path:
    if sys.platform != "win32":
        raise BASE.RecoveryFailure("OWNER_WINDOWS_REQUIRED")
    if key_file.is_symlink() or not key_file.is_file():
        raise BASE.RecoveryFailure("ESCROW_FILE_NOT_FOUND_OR_LINKED")
    path = key_file.resolve(strict=True)
    expected = checkpoint.parent / "protected-escrow" / "original-vault-key.txt"
    if path != expected.resolve(strict=False):
        raise BASE.RecoveryFailure("ESCROW_OUTSIDE_RESTRICTED_WORKSPACE")
    if path.stat().st_size < 32 or path.stat().st_size > 512:
        raise BASE.RecoveryFailure("ESCROW_FILE_SIZE_INVALID")
    # Do not read the actual secret here. Node reads it directly, in RAM.
    # A filesystem location is only owner-supplied custody, not proof of
    # original-key continuity or independent protected provenance.
    return path


def assert_windows_bitlocker() -> None:
    if sys.platform != "win32":
        raise BASE.RecoveryFailure("OWNER_WINDOWS_REQUIRED")
    command = (
        "$b=Get-BitLockerVolume -MountPoint 'C:';"
        "if($b.ProtectionStatus.ToString() -eq 'On' "
        "-and $b.EncryptionPercentage -eq 100){exit 0}else{exit 5}"
    )
    result = subprocess.run(
        ["powershell.exe", "-NoProfile", "-NonInteractive",
         "-Command", command],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=30,
        check=False,
    )
    if result.returncode != 0:
        raise BASE.RecoveryFailure("PROTECTED_LOCAL_STORAGE_REQUIRED")


def read_private_ciphertext(cid: str) -> dict:
    # Only one documented record in this actual checkpoint. A second record
    # requires separate human scope/authorization, never silently inspect it.
    count = BASE.pg_scalar(cid, 'SELECT count(*) FROM "SaaSCommercialDocument"')
    if count != 1:
        raise BASE.RecoveryFailure("VAULT_DOCUMENT_COUNT_NOT_EXACTLY_ONE")
    large = BASE.pg_scalar(
        cid,
        'SELECT count(*) FROM "SaaSCommercialDocument" WHERE '
        f'octet_length("encryptedFileData") > {MAX_ENCRYPTED}'
    )
    if large:
        raise BASE.RecoveryFailure("VAULT_CIPHERTEXT_TOO_LARGE")
    # Purpose-specific fixed SQL, no IDs, filenames, customer metadata,
    # REST API, credential env, host TCP port, SQL print or raw logs.
    cmd = [
        "docker", "--context", ALLOWED_CONTEXT,
        "exec", "--user", "postgres", cid,
        "psql", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1",
        "-U", "v5_isolated_restore", "-d", "v5_isolated_restore",
        "-c", QUERY,
    ]
    try:
        result = subprocess.run(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            timeout=120, check=False, env=BASE.scrub_docker_environment()
        )
    except (OSError, subprocess.TimeoutExpired):
        raise BASE.RecoveryFailure("PRIVATE_CIPHERTEXT_QUERY_UNAVAILABLE")
    if result.returncode != 0 or len(result.stdout) > READ_LIMIT:
        raise BASE.RecoveryFailure("PRIVATE_CIPHERTEXT_QUERY_FAILED")
    try:
        encoded = result.stdout.decode("ascii").strip()
        cipher, digest, size = encoded.split("|")
        if (not re.fullmatch(r"[a-f0-9]+", cipher) or
            not 66 <= len(cipher) <= MAX_ENCRYPTED * 2 or
            not re.fullmatch(r"[a-f0-9]{64}", digest) or
            not re.fullmatch(r"[0-9]{1,8}", size) or
            int(size) != len(cipher) // 2 - 32):
            raise ValueError("INVALID_ENVELOPE")
        return {
            "cipherHex": cipher,
            "expectedSha256": digest,
            "fileSize": int(size),
        }
    except (UnicodeError, ValueError):
        raise BASE.RecoveryFailure("CIPHERTEXT_RECORD_FORMAT_INVALID")


def run_local_crypto(payload: dict, key_path: Path) -> None:
    js = HERE / "schoolos-v5-vault-offline-aesgcm.mjs"
    if not js.is_file():
        raise BASE.RecoveryFailure("PINNED_CRYPTO_CHECKER_MISSING")
    args = dict(payload)
    args["escrowKeyFile"] = str(key_path)
    raw = json.dumps(args, separators=(",", ":")).encode("ascii")
    if len(raw) > READ_LIMIT:
        raise BASE.RecoveryFailure("CRYPTO_INPUT_TOO_LARGE")
    try:
        result = subprocess.run(
            ["node", str(js), "--owner-private-stdin"],
            input=raw, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            timeout=120, check=False, env=BASE.scrub_docker_environment(),
        )
    except (OSError, subprocess.TimeoutExpired):
        raise BASE.RecoveryFailure("LOCAL_NODE_CRYPTO_UNAVAILABLE")
    expected = (
        b"VAULT_OFFLINE_GCM_TAG_AND_CONTENT_DIGEST=PASS\n"
        b"VAULT_PLAINTEXT_AND_KEY_PRINTED=NO\n"
    )
    if result.returncode != 0 or result.stdout.replace(b"\r\n", b"\n") != expected:
        raise BASE.RecoveryFailure("AUTHENTICATED_DECRYPTION_OR_DIGEST_FAILED")


def restore_and_verify(checkpoint: Path, escrow: Path, preflight: dict) -> dict:
    BASE.require_local_engine()
    name = "v5-private-vaultdecrypt-" + secrets.token_hex(10)
    cid = None
    owned = False
    deleted = False
    try:
        args = BASE.build_container_command(
            checkpoint, name, secrets.token_hex(24), 2048, 64
        )
        if (args[args.index("--network") + 1] != "none" or
            "--read-only" not in args or "--pull=never" not in args or
            any(x in args for x in (
                "-p", "--publish", "-v", "--volume", "--privileged"
            ))):
            raise BASE.RecoveryFailure("ISOLATION_POLICY_NOT_MET")
        _, out = BASE.docker(args, timeout=90)
        cid = out.decode("ascii", errors="ignore").strip()
        BASE.verify_container_identity(cid, name)
        owned = True
        print("VAULT_OFFLINE_ISOLATION=NETWORK_NONE_TMPFS_ONLY")
        BASE.wait_for_isolated_pg(cid)
        print("VAULT_OFFLINE_POSTGRES=PASS")

        # Verify mounted checkpoint bytes do not drift since preflight.
        for item in ("database.dump", "files.tar.gz"):
            expected = BASE.PREFLIGHT.digest(checkpoint / item)
            _, hashed = BASE.docker([
                "exec", "--user", "postgres", cid, "sha256sum",
                "/isolated-checkpoint/" + item,
            ], timeout=180)
            if hashed.decode("ascii", errors="ignore").split(" ", 1)[0] != expected:
                raise BASE.RecoveryFailure("PRIVATE_CHECKPOINT_DIGEST_DRIFT")
        print("VAULT_OFFLINE_CHECKPOINT_PARITY=PASS")

        # No full database/files restore; schema-only plus the one Vault table.
        BASE.docker([
            "exec", "--user", "postgres", cid, "pg_restore",
            "--section=pre-data", "--no-owner", "--no-acl",
            "--exit-on-error", "--single-transaction",
            "--username=v5_isolated_restore",
            "--dbname=v5_isolated_restore",
            "/isolated-checkpoint/database.dump",
        ], timeout=900)
        BASE.docker([
            "exec", "--user", "postgres", cid, "pg_restore",
            "--data-only", "--table=SaaSCommercialDocument",
            "--no-owner", "--no-acl", "--exit-on-error",
            "--single-transaction",
            "--username=v5_isolated_restore",
            "--dbname=v5_isolated_restore",
            "/isolated-checkpoint/database.dump",
        ], timeout=900)
        print("VAULT_OFFLINE_SINGLE_TABLE_DATA=PASS")

        encrypted_only = read_private_ciphertext(cid)
        print("VAULT_OFFLINE_CIPHERTEXT_QUERY=PASS")
        run_local_crypto(encrypted_only, escrow)
        print("VAULT_OFFLINE_GCM_TAG_AND_CONTENT_DIGEST=PASS")
        return {
            "checkpoint_id": BASE.CHECKPOINT_ID,
            "checkpoint_consistency": preflight["manifest_checksums"],
            "checkpoint_origin_authenticity":
                preflight["origin_manifest_authenticity"],
            "document_count_scoped": 1,
            "vault_original_key_escrow_origin":
                "OWNER_SUPPLIED_PRIVATE_FILE_NOT_INDEPENDENTLY_ATTESTED",
            "vault_decryption": "PASS_GCM_TAG_AND_PLAINTEXT_SHA256",
            "original_key_provenance": "NOT_ATTESTED",
            "plaintext_stored_or_printed": False,
            "secret_stored_or_printed": False,
            "staging_and_production_changed": False,
            "r2_media_recovery": "NOT_EXECUTED",
            "commercial_go": "HOLD",
        }
    finally:
        if cid and owned and BASE.CONTAINER_ID.fullmatch(cid):
            try:
                BASE.verify_container_identity(cid, name)
                code, _ = BASE.docker(["rm", "-f", cid],
                                      expected=False, timeout=60)
                deleted = code == 0
            except BASE.RecoveryFailure:
                deleted = False
        if cid is not None:
            if not deleted:
                print("VAULT_OFFLINE_ISOLATE_CLEANUP=CHECK_REQUIRED")
                raise BASE.RecoveryFailure("EPHEMERAL_VAULT_ISOLATE_CLEANUP_FAILED")
            print("VAULT_OFFLINE_ISOLATE_CLEANUP=PASS")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--checkpoint-dir", type=Path, required=True)
    p.add_argument("--checkpoint-id", required=True)
    p.add_argument("--escrow-key-file", type=Path, required=True)
    p.add_argument("--report", type=Path, required=True)
    p.add_argument("--acknowledge-private-offline-checkpoint",
                   action="store_true")
    args = p.parse_args()
    try:
        if (args.checkpoint_id != BASE.CHECKPOINT_ID or
            not args.acknowledge_private_offline_checkpoint):
            raise BASE.RecoveryFailure("PRIVATE_AUTHORIZATION_REQUIRED")
        assert_windows_bitlocker()
        checkpoint = BASE.guarded_checkpoint_path(args.checkpoint_dir)
        escrow = protected_local_escrow(args.escrow_key_file, checkpoint)
        target = args.report.resolve(strict=False)
        if checkpoint == target or checkpoint in target.parents:
            raise BASE.RecoveryFailure("REPORT_UNDER_CHECKPOINT_REFUSED")
        evidence = BASE.PREFLIGHT.preflight(checkpoint, None)
        print("VAULT_OFFLINE_CHECKPOINT_PREFLIGHT=PASS_CONTENT_ONLY")
        result = restore_and_verify(checkpoint, escrow, evidence)
        result["cleanup"] = "PASS"
        BASE.PREFLIGHT.write_report_exclusive(args.report, result)
        print("VAULT_OFFLINE_AUTHENTICATED_READBACK=PASS")
        print("SANITIZED_REPORT=PASS")
        print("R2_MEDIA_RECOVERY=NOT_EXECUTED")
        print("DEPLOYMENT_AUTHORIZATION=HOLD")
        return 0
    except (BASE.RecoveryFailure, BASE.PREFLIGHT.PreflightFailure):
        print("VAULT_OFFLINE_AUTHENTICATED_READBACK=CHECK_REQUIRED")
        print("VAULT_SECRET_AND_PLAINTEXT_PRINTED=NO")
        print("DEPLOYMENT_AUTHORIZATION=HOLD")
        return 2
    except (OSError, ValueError, subprocess.TimeoutExpired):
        print("VAULT_OFFLINE_AUTHENTICATED_READBACK=CHECK_REQUIRED_LOCAL_IO")
        print("VAULT_SECRET_AND_PLAINTEXT_PRINTED=NO")
        print("DEPLOYMENT_AUTHORIZATION=HOLD")
        return 2


if __name__ == "__main__":
    sys.exit(main())
