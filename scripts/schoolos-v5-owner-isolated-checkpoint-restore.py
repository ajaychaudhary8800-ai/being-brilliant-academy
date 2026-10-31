#!/usr/bin/env python3
"""Restore a privately copied V5 checkpoint in an ephemeral, networkless Docker.

OWNER-LOCAL WINDOWS DOCKER DESKTOP ONLY. No access to staging, Coolify, R2 or
production. No customer bytes printed or uploaded. Does not attest Vault,
media, source-to-image provenance or payment/ledger correctness.

Default mode is READ-ONLY preflight. Explicit --execute-isolated-restore
is required to create a disposable PostgreSQL container and extract files
INSIDE ONLY that container's tmpfs. Never use on a shared staging Docker host.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import time

SCRIPT_DIR = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "v5_checkpoint_preflight",
    SCRIPT_DIR / "schoolos-v5-private-checkpoint-preflight.py",
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("PRIVATE_PREFLIGHT_MODULE_MISSING")
PREFLIGHT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PREFLIGHT)

CHECKPOINT_ID = "20261031T073407Z"
POSTGRES_IMAGE = "postgres:16-alpine"
DOCKER_CONTEXT = "desktop-linux"
DOCKER_NPIPE = re.compile(
    r"^npipe:////\./pipe/(?:dockerDesktopLinuxEngine|docker_engine)$", re.I
)
CONTAINER_ID = re.compile(r"^[0-9a-f]{64}$")
MAX_CAPTURE = 128 * 1024


class RecoveryFailure(Exception):
    pass


def scrub_docker_environment() -> dict:
    result = os.environ.copy()
    for key in ("DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY",
                "DOCKER_CERT_PATH", "DOCKER_API_VERSION"):
        result.pop(key, None)
    return result


def docker(argv: list[str], *, timeout: int = 60, env: dict | None = None,
           expected: bool = True) -> tuple[int, bytes]:
    """Never forward stderr, command arguments, Docker env or SQL output."""
    try:
        result = subprocess.run(
            ["docker", "--context", DOCKER_CONTEXT, *argv],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=timeout,
            env=env or scrub_docker_environment(),
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise RecoveryFailure("DOCKER_COMMAND_UNAVAILABLE_OR_TIMED_OUT")
    if expected and result.returncode != 0:
        raise RecoveryFailure("DOCKER_COMMAND_FAILED")
    if len(result.stdout) > MAX_CAPTURE:
        raise RecoveryFailure("DOCKER_OUTPUT_OVERFLOW")
    return result.returncode, result.stdout


def require_local_engine() -> str:
    """Pin local Windows Docker Desktop Linux daemon; refuse remote endpoints."""
    code, raw = docker([
        "context", "inspect", DOCKER_CONTEXT,
        "--format", "{{json .Endpoints.docker.Host}}",
    ])
    if code != 0:
        raise RecoveryFailure("DOCKER_CONTEXT_NOT_FOUND")
    try:
        endpoint = json.loads(raw.decode("ascii").strip())
    except (UnicodeError, ValueError):
        raise RecoveryFailure("DOCKER_CONTEXT_INVALID")
    if not isinstance(endpoint, str) or not DOCKER_NPIPE.fullmatch(endpoint):
        raise RecoveryFailure("NONLOCAL_DOCKER_CONTEXT_REFUSED")
    _, os_type = docker(["info", "--format", "{{.OSType}}"])
    if os_type.strip() != b"linux":
        raise RecoveryFailure("NONLINUX_DOCKER_REFUSED")
    _, image_id = docker(["image", "inspect", POSTGRES_IMAGE,
                          "--format", "{{.Id}}"])
    image_id = image_id.decode("ascii", errors="ignore").strip()
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", image_id):
        raise RecoveryFailure("POSTGRES_IMAGE_NOT_CACHED")
    return image_id


def guarded_checkpoint_path(path: Path) -> Path:
    if str(path).startswith("\\\\") or str(path).startswith("//"):
        raise RecoveryFailure("REMOTE_CHECKPOINT_PATH_REFUSED")
    try:
        absolute = path.resolve(strict=True)
    except OSError:
        raise RecoveryFailure("CHECKPOINT_NOT_FOUND")
    if path.is_symlink() or not absolute.is_dir():
        raise RecoveryFailure("CHECKPOINT_PATH_UNSAFE")
    if absolute.parent == absolute or len(str(absolute)) < 12:
        raise RecoveryFailure("CHECKPOINT_PATH_TOO_BROAD")
    if any(char in str(absolute) for char in (",", "\r", "\n", "\x00")):
        raise RecoveryFailure("CHECKPOINT_PATH_INVALID")
    return absolute


def build_container_command(checkpoint: Path, name: str,
                            password: str, db_mb: int, files_mb: int) -> list[str]:
    mount = "type=bind,source=" + str(checkpoint) + ",target=/isolated-checkpoint,readonly"
    return [
        "run", "-d", "--rm", "--pull=never",
        "--name", name,
        "--label", "schoolos.recovery.owner=private-v5-checkpoint",
        "--label", "schoolos.recovery.id=" + name,
        "--network", "none",              # Stronger than --internal
        "--read-only",                     # Only tmpfs state may be written
        "--security-opt", "no-new-privileges",
        "--pids-limit", "512",
        "--memory", "4g",
        "--shm-size", "128m",
        "--tmpfs", f"/var/lib/postgresql/data:rw,nosuid,nodev,size={db_mb}m",
        "--tmpfs", "/var/run/postgresql:rw,nosuid,nodev,size=64m",
        "--tmpfs", "/tmp:rw,nosuid,nodev,size=256m",
        "--tmpfs", f"/isolated-files:rw,nosuid,nodev,noexec,size={files_mb}m",
        "--mount", mount,
        "-e", "POSTGRES_DB=v5_isolated_restore",
        "-e", "POSTGRES_USER=v5_isolated_restore",
        "-e", "POSTGRES_PASSWORD=" + password,
        "-e", "PGDATA=/var/lib/postgresql/data/pgdata",
        POSTGRES_IMAGE,
    ]


def verify_container_identity(cid: str, name: str) -> None:
    if not CONTAINER_ID.fullmatch(cid):
        raise RecoveryFailure("INVALID_CONTAINER_ID")
    _, raw = docker(["inspect", "--format", "{{json .Config.Labels}}", cid])
    try:
        labels = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeError):
        raise RecoveryFailure("CONTAINER_LABELS_UNREADABLE")
    if not isinstance(labels, dict) or labels.get("schoolos.recovery.id") != name:
        raise RecoveryFailure("CONTAINER_OWNERSHIP_MISMATCH")
    if labels.get("schoolos.recovery.owner") != "private-v5-checkpoint":
        raise RecoveryFailure("CONTAINER_SCOPE_MISMATCH")


def wait_for_isolated_pg(cid: str) -> None:
    for _ in range(75):
        code, _ = docker([
            "exec", cid, "pg_isready", "-U", "v5_isolated_restore",
            "-d", "v5_isolated_restore",
        ], expected=False, timeout=10)
        if code == 0:
            return
        state_rc, state = docker(
            ["inspect", "--format", "{{.State.Running}}", cid],
            expected=False,
        )
        if state_rc != 0 or state.strip() != b"true":
            raise RecoveryFailure("POSTGRES_PROCESS_EXITED")
        time.sleep(2)
    raise RecoveryFailure("POSTGRES_NOT_READY")


def pg_scalar(cid: str, sql: str) -> int:
    _, raw = docker([
        "exec", "--user", "postgres", cid, "psql",
        "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
        "-U", "v5_isolated_restore", "-d", "v5_isolated_restore",
        "-c", sql,
    ], timeout=60)
    value = raw.decode("ascii", errors="ignore").strip()
    if not re.fullmatch(r"[0-9]{1,8}", value):
        raise RecoveryFailure("NON_NUMERIC_DATABASE_AGGREGATE")
    return int(value)


def restore_in_isolation(checkpoint: Path, preflight: dict,
                         db_tmpfs_mb: int, files_tmpfs_mb: int) -> dict:
    """Restore never points to host database, network or persistent volume."""
    image_id = require_local_engine()
    name = "v5-private-restore-" + secrets.token_hex(10)
    password = secrets.token_hex(24)  # Synthetic, disposable, never printed
    started = datetime.now(timezone.utc)
    cid = None
    cleanup = False
    owned_container = False
    try:
        args = build_container_command(
            checkpoint, name, password, db_tmpfs_mb, files_tmpfs_mb
        )
        # Guard even future changes to command construction.
        if "--network" not in args or args[args.index("--network") + 1] != "none":
            raise RecoveryFailure("NETWORK_ISOLATION_MISSING")
        if "--read-only" not in args or "--mount" not in args:
            raise RecoveryFailure("FILESYSTEM_ISOLATION_MISSING")
        if any(flag in args for flag in ("-p", "--publish", "-v", "--volume",
                                        "--network-alias", "--privileged")):
            raise RecoveryFailure("PERSISTENT_OR_PUBLIC_RESOURCE_REFUSED")
        _, raw = docker(args, timeout=90)
        cid = raw.decode("ascii", errors="ignore").strip()
        verify_container_identity(cid, name)
        owned_container = True
        print("REAL_CHECKPOINT_ISOLATION=NETWORK_NONE_TMPFS_ONLY")
        wait_for_isolated_pg(cid)
        print("REAL_CHECKPOINT_DISPOSABLE_POSTGRES=PASS")

        # Additional container-side hash check after mount. No values output.
        for basename in ("database.dump", "files.tar.gz"):
            digest = PREFLIGHT.digest(checkpoint / basename)
            _, raw_hash = docker([
                "exec", "--user", "postgres", cid, "sha256sum",
                "/isolated-checkpoint/" + basename,
            ], timeout=180)
            first_field = raw_hash.decode("ascii", errors="ignore").split(" ", 1)[0]
            if first_field != digest:
                raise RecoveryFailure("CONTAINER_INPUT_DIGEST_DRIFT")
        print("REAL_CHECKPOINT_CONTAINER_INPUT_DIGESTS=PASS")

        # A genuine pg_restore - not a dry run - but only on an empty temp DB.
        docker([
            "exec", "--user", "postgres", cid, "pg_restore",
            "--no-owner", "--no-acl", "--exit-on-error",
            "--single-transaction",
            "--username=v5_isolated_restore",
            "--dbname=v5_isolated_restore",
            "/isolated-checkpoint/database.dump",
        ], timeout=900)

        migrations = pg_scalar(cid,
            'SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL')
        tables = pg_scalar(cid,
            "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname='public'")
        if migrations < 114 or tables < 300:
            raise RecoveryFailure("RESTORED_SCHEMA_BELOW_ACCEPTED_BASELINE")
        print("REAL_CHECKPOINT_ISOLATED_DB_RESTORE=PASS")

        # Tar was checked by host-side Python (symlink/traversal veto).
        # Extract only into container-private, discarded-on-stop tmpfs.
        docker([
            "exec", "--user", "root", cid,
            "tar", "-xzf", "/isolated-checkpoint/files.tar.gz",
            "-C", "/isolated-files",
        ], timeout=900)
        _, count_raw = docker([
            "exec", cid, "sh", "-c",
            "find /isolated-files -type f | wc -l",
        ], timeout=120)
        value = count_raw.decode("ascii", errors="ignore").strip()
        if not re.fullmatch(r"[0-9]{1,9}", value):
            raise RecoveryFailure("NON_NUMERIC_FILE_COUNT")
        file_count = int(value)
        print("REAL_CHECKPOINT_ISOLATED_FILE_RESTORE=PASS")

        ended = datetime.now(timezone.utc)
        evidence = dict(preflight)
        evidence.update({
            "database_restore": "PASS_ISOLATED_ONLY",
            "files_extraction": "PASS_ISOLATED_ONLY",
            "postgres_completed_migrations": migrations,
            "postgres_public_tables": tables,
            "isolated_regular_files": file_count,
            "postgres_image_local_digest": image_id,
            "docker_context": "desktop-linux_named_pipe",
            "network": "none",
            "storage": "tmpfs_only_no_persistent_volume",
            "restore_utc_started": started.isoformat(),
            "restore_utc_finished": ended.isoformat(),
            "restore_elapsed_seconds": int((ended - started).total_seconds()),
            "vault_key_custody": "NOT_VERIFIED",
            "vault_decryption": "NOT_EXECUTED",
            "media_recovery": "NOT_EXECUTED",
            "payment_ledger_consistency": "NOT_EVALUATED",
            "source_build_signed_provenance": "NOT_ATTESTED",
            "human_witnessed_acceptance": "PENDING",
            "rpo_rto_approved": False,
            "deployment_authorization": "HOLD",
        })
        return evidence
    finally:
        if cid and owned_container and CONTAINER_ID.fullmatch(cid):
            # Recheck owner label before deleting this exact ephemeral ID.
            try:
                verify_container_identity(cid, name)
                code, _ = docker(["rm", "-f", cid], expected=False, timeout=60)
                cleanup = code == 0
            except RecoveryFailure:
                cleanup = False
        if cid is not None:
            if not cleanup:
                print("REAL_CHECKPOINT_CLEANUP=CHECK_REQUIRED")
                raise RecoveryFailure("EPHEMERAL_CONTAINER_OWNERSHIP_OR_CLEANUP_FAILED")
            print("REAL_CHECKPOINT_CLEANUP=PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint-dir", required=True, type=Path)
    parser.add_argument("--checkpoint-id", required=True)
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--trusted-manifest-sha256")
    parser.add_argument("--execute-isolated-restore", action="store_true")
    parser.add_argument("--acknowledge-private-offline-checkpoint", action="store_true")
    parser.add_argument("--db-tmpfs-mb", type=int, default=2048)
    parser.add_argument("--files-tmpfs-mb", type=int, default=1024)
    args = parser.parse_args()
    try:
        if args.checkpoint_id != CHECKPOINT_ID:
            raise RecoveryFailure("UNEXPECTED_CHECKPOINT_ID")
        if args.trusted_manifest_sha256 and not re.fullmatch(
            r"[0-9a-f]{64}", args.trusted_manifest_sha256):
            raise RecoveryFailure("INVALID_TRUSTED_DIGEST")
        folder = guarded_checkpoint_path(args.checkpoint_dir)
        report_location = args.report.resolve(strict=False)
        if report_location == folder or folder in report_location.parents:
            raise RecoveryFailure("REPORT_INSIDE_CHECKPOINT_REFUSED")
        evidence = PREFLIGHT.preflight(folder, args.trusted_manifest_sha256)
        print("REAL_CHECKPOINT_READ_ONLY_PREFLIGHT=PASS_CONTENT_ONLY")
        print("CHECKPOINT_ORIGIN_AUTHENTICITY="
              + evidence["origin_manifest_authenticity"])
        if not args.execute_isolated_restore:
            evidence["restore_mode"] = "READ_ONLY_PREFLIGHT"
            PREFLIGHT.write_report_exclusive(args.report, evidence)
            print("REAL_CHECKPOINT_DB_AND_FILES_RESTORE=NOT_EXECUTED")
            print("SANITIZED_REPORT=PASS")
            print("DEPLOYMENT_AUTHORIZATION=HOLD")
            return 0
        if not args.acknowledge_private_offline_checkpoint:
            raise RecoveryFailure("PRIVATE_ISOLATE_ACK_REQUIRED")
        if not (256 <= args.db_tmpfs_mb <= 8192 and
                64 <= args.files_tmpfs_mb <= 8192):
            raise RecoveryFailure("TMPFS_LIMITS_INVALID")
        if evidence["tar_declared_file_bytes"] > (args.files_tmpfs_mb - 32) * 1024 * 1024:
            raise RecoveryFailure("ISOLATED_FILE_TMPFS_CAPACITY_TOO_SMALL")
        print("REAL_CHECKPOINT_ISOLATED_RESTORE=STARTED")
        outcome = restore_in_isolation(
            folder, evidence, args.db_tmpfs_mb, args.files_tmpfs_mb
        )
        outcome["restore_mode"] = "EPHEMERAL_NO_NETWORK"
        outcome["cleanup"] = "PASS"
        PREFLIGHT.write_report_exclusive(args.report, outcome)
        print("REAL_CHECKPOINT_DB_AND_FILES_RESTORE=PASS_ISOLATED_ONLY")
        print("SANITIZED_REPORT=PASS")
        print("VAULT_AND_MEDIA_RESTORED=NO")
        print("SIGNED_PROVENANCE=NOT_ATTESTED")
        print("STAGING_AND_PRODUCTION_CHANGED=NO")
        print("DEPLOYMENT_AUTHORIZATION=HOLD")
        return 0
    except (RecoveryFailure, PREFLIGHT.PreflightFailure) as err:
        code = str(err)
        if not re.fullmatch(r"[A-Z0-9_]{2,80}", code):
            code = "CHECK_REQUIRED"
        print("REAL_CHECKPOINT_RECOVERY=CHECK_REQUIRED_" + code)
        print("RAW_LOGS_AND_CUSTOMER_VALUES_PRINTED=NO")
        print("DEPLOYMENT_AUTHORIZATION=HOLD")
        return 2
    except (OSError, ValueError, json.JSONDecodeError):
        print("REAL_CHECKPOINT_RECOVERY=CHECK_REQUIRED_IO_OR_FORMAT")
        print("RAW_LOGS_AND_CUSTOMER_VALUES_PRINTED=NO")
        print("DEPLOYMENT_AUTHORIZATION=HOLD")
        return 2


if __name__ == "__main__":
    sys.exit(main())
