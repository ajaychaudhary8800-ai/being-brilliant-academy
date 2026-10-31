#!/usr/bin/env python3
"""Read-only, values-free preflight for an ALREADY COPIED real V5 checkpoint.

Use only in a restricted owner-controlled recovery isolate, never CI with
customer data, never the staging/production host. No extraction or DB writes.
A passing result proves content checksums + archive structure, not origin
authenticity, real DB restore, key custody, media recovery, or commercial GO.
"""
import argparse
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import stat
import sys
import tarfile

EXPECTED_ID = "20261031T073407Z"
FILES = ("database.dump", "files.tar.gz")
MAX_MANIFEST_BYTES = 4096
MAX_TAR_MEMBERS = 1_000_000
MAX_DECLARED_FILE_BYTES = 300 * 1024 ** 3


class PreflightFailure(Exception):
    pass


def guarded_file(path: Path) -> None:
    try:
        mode = path.lstat().st_mode
    except OSError:
        raise PreflightFailure("MISSING_INPUT")
    if not stat.S_ISREG(mode):
        raise PreflightFailure("NONREGULAR_INPUT")


def digest(path: Path) -> str:
    h = sha256()
    with path.open("rb") as stream:
        for part in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            h.update(part)
    return h.hexdigest()


def verify_manifest(folder: Path, trusted_manifest_sha: str | None) -> str:
    manifest = folder / "SHA256SUMS"
    guarded_file(manifest)
    if manifest.stat().st_size > MAX_MANIFEST_BYTES:
        raise PreflightFailure("MANIFEST_TOO_LARGE")
    raw = manifest.read_bytes()
    if b"\r" in raw or b"\x00" in raw:
        raise PreflightFailure("INVALID_MANIFEST_ENCODING")
    try:
        rows = raw.decode("ascii").splitlines()
    except UnicodeDecodeError:
        raise PreflightFailure("INVALID_MANIFEST_ENCODING")
    if len(rows) != 2:
        raise PreflightFailure("MANIFEST_SHAPE")
    expected = {}
    for row in rows:
        match = re.fullmatch(r"([0-9a-f]{64})  ([^\n\r]+)", row)
        if not match:
            raise PreflightFailure("MANIFEST_ROW_FORMAT")
        digest_hex, name = match.groups()
        # Historical checksum paths may be absolute. Do not follow those paths.
        if "\\" in name or "\x00" in name:
            raise PreflightFailure("INVALID_MANIFEST_NAME")
        base = name.rsplit("/", 1)[-1]
        if base not in FILES or base in expected:
            raise PreflightFailure("MANIFEST_UNEXPECTED_OR_DUPLICATE_FILE")
        expected[base] = digest_hex
    for base in FILES:
        file = folder / base
        guarded_file(file)
        if digest(file) != expected[base]:
            raise PreflightFailure("DIGEST_MISMATCH")
    manifest_digest = digest(manifest)
    if trusted_manifest_sha:
        if manifest_digest != trusted_manifest_sha:
            raise PreflightFailure("TRUSTED_MANIFEST_MISMATCH")
        return "PASS_OUT_OF_BAND_DIGEST_MATCH"
    return "NOT_ATTESTED"


def inspect_archive(folder: Path) -> tuple[int, int]:
    name = folder / "files.tar.gz"
    count = 0
    declared_bytes = 0
    try:
        with tarfile.open(name, "r|gz") as archive:
            for member in archive:
                count += 1
                if count > MAX_TAR_MEMBERS:
                    raise PreflightFailure("TAR_MEMBER_LIMIT")
                path = member.name
                if (
                    not path or len(path) > 4096 or path.startswith("/")
                    or "\\" in path or "\x00" in path
                    or ".." in path.split("/")
                    or not (member.isfile() or member.isdir())
                ):
                    raise PreflightFailure("UNSAFE_TAR_ENTRY")
                if member.size < 0:
                    raise PreflightFailure("INVALID_TAR_MEMBER_SIZE")
                declared_bytes += member.size
                if declared_bytes > MAX_DECLARED_FILE_BYTES:
                    raise PreflightFailure("TAR_DECLARED_BYTES_LIMIT")
    except (OSError, EOFError, tarfile.TarError):
        raise PreflightFailure("INVALID_COMPRESSED_TAR")
    return count, declared_bytes


def preflight(folder: Path, trusted_manifest_sha: str | None) -> dict:
    if folder.is_symlink() or not folder.is_dir():
        raise PreflightFailure("CHECKPOINT_DIRECTORY_INVALID")
    authenticity = verify_manifest(folder, trusted_manifest_sha)
    guarded_file(folder / "database.dump")
    with (folder / "database.dump").open("rb") as stream:
        if stream.read(5) != b"PGDMP":
            raise PreflightFailure("CUSTOM_DUMP_HEADER_INVALID")
    members, declared_bytes = inspect_archive(folder)
    return {
        "checkpoint_id": EXPECTED_ID,
        "checkpoint_input": "OWNER_SUPPLIED_COPIED_ISOLATED_DIRECTORY",
        "manifest_checksums": "PASS",
        "origin_manifest_authenticity": authenticity,
        "postgres_custom_dump_magic": "PASS",
        "tar_archive_path_safety": "PASS",
        "tar_entries": members,
        "tar_declared_file_bytes": declared_bytes,
        "database_restore": "NOT_EXECUTED",
        "files_extraction": "NOT_EXECUTED",
        "vault_decryption": "NOT_EXECUTED",
        "media_recovery": "NOT_EXECUTED",
        "signed_image_provenance": "NOT_ATTESTED",
        "customer_data_printed": False,
        "staging_and_production_changed": False,
        "deployment_authorization": "HOLD",
    }


def write_report_exclusive(report_path: Path, data: dict) -> None:
    if report_path.is_symlink():
        raise PreflightFailure("UNSAFE_REPORT_DESTINATION")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        fd = os.open(report_path, flags, 0o600)
    except OSError:
        raise PreflightFailure("REPORT_CREATION_FAILED")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(data, stream, sort_keys=True, indent=2)
            stream.write("\n")
    except OSError:
        raise PreflightFailure("REPORT_WRITE_FAILED")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint-dir", type=Path, required=True)
    parser.add_argument("--checkpoint-id", required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--trusted-manifest-sha256")
    args = parser.parse_args()
    try:
        if args.checkpoint_id != EXPECTED_ID:
            raise PreflightFailure("WRONG_CHECKPOINT_ID")
        trusted = args.trusted_manifest_sha256
        if trusted and not re.fullmatch(r"[0-9a-f]{64}", trusted):
            raise PreflightFailure("INVALID_TRUSTED_MANIFEST_DIGEST")
        report = preflight(args.checkpoint_dir, trusted)
        write_report_exclusive(args.report, report)
        print("V5_REAL_CHECKPOINT_PREFLIGHT=PASS_CONTENT_ONLY")
        print("DB_DUMP_MAGIC=PASS")
        print("ARCHIVE_PATH_SAFETY=PASS")
        print("MANIFEST_AUTHENTICITY=" + report["origin_manifest_authenticity"])
        print("SANITIZED_REPORT=PASS")
        print("REAL_DB_RESTORE=NOT_EXECUTED")
        print("VAULT_MEDIA_RECOVERY=NOT_EXECUTED")
        print("CREDENTIAL_VALUES_PRINTED=NO")
        print("STAGING_AND_PRODUCTION_CHANGED=NO")
        print("DEPLOYMENT_AUTHORIZATION=HOLD")
        return 0
    except (PreflightFailure, OSError) as error:
        code = str(error) if isinstance(error, PreflightFailure) else "IO_CHECK_REQUIRED"
        # Never report paths, contents, DB identifiers or underlying OSError text.
        print("V5_REAL_CHECKPOINT_PREFLIGHT=CHECK_REQUIRED_" + code)
        print("RAW_VALUES_PRINTED=NO")
        print("DEPLOYMENT_AUTHORIZATION=HOLD")
        return 2


if __name__ == "__main__":
    sys.exit(main())
