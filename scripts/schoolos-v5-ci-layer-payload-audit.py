#!/usr/bin/env python3
"""V5 candidate CI image-layer bounded safety scan.

Consumes the complete Docker-save TAR from stdin without creating a local
archive, extracting a layer to disk, or printing image/secret paths or content.
Checks EVERY regular-file payload for specific disposable CI-only credential
canaries; checks all layers for private recovery/credential file paths; checks
app-owned files for embedded private-key PEM headers. Checks deleted layers too.

This is not general secret detection, signed provenance, registry attestation,
or proof that an unrelated old deployed image/archive is clean.
"""
from __future__ import annotations
import io
import json
import posixpath
import re
import sys
import tarfile

MAX_OUTER_MEMBERS = 2500
MAX_LAYERS = 750
MAX_LAYER_FILES = 900_000
MAX_SCAN_BYTES = 12 * 1024 ** 3
CHUNK = 96 * 1024

# Disposable values used only by isolated CI; these are not production secrets.
SYNTHETIC_MARKERS = (
    b"ci-access-secret-at-least-thirty-two-characters",
    b"ci-refresh-secret-at-least-thirty-two-characters",
    b"ci-postgres-password",
    b"ci-redis-password",
    b"synthetic_ci_credential_only",
)

PRIVATE_KEY_HEADERS = (
    b"-----BEGIN PRIVATE KEY-----",
    b"-----BEGIN OPENSSH PRIVATE KEY-----",
    b"-----BEGIN RSA PRIVATE KEY-----",
    b"-----BEGIN EC PRIVATE KEY-----",
)

PRIVATE_SUFFIXES = (
    ".dpapi",
    ".dump",
    ".docker-save.tar",
    ".oci-archive.tar",
    ".image-archive.tar",
    ".image-archive.tar.gz",
)
ROOTS = ("workspace", "app", "data", "root", "home", "run")


class LayerAuditFailure(Exception):
    pass


def normalize(name: str) -> str:
    if not isinstance(name, str) or "\x00" in name or "\\" in name:
        raise LayerAuditFailure("INVALID_MEMBER_PATH")
    if name.startswith("/"):
        raise LayerAuditFailure("ABSOLUTE_LAYER_PATH")
    while name.startswith("./"):
        name = name[2:]
    if any(part == ".." for part in name.split("/")):
        raise LayerAuditFailure("TRAVERSAL_LAYER_PATH")
    return posixpath.normpath(name)


def forbidden_path(name: str) -> bool:
    path = normalize(name)
    parts = path.split("/")
    basename = parts[-1].lower()
    if any(p.lower().startswith("schoolos-v5-recovery-") for p in parts):
        return True
    if "schoolos-v5-private-recovery" in [p.lower() for p in parts]:
        return True
    if any(basename.endswith(suffix) for suffix in PRIVATE_SUFFIXES):
        return True
    if len(parts) >= 2 and parts[0] == "run" and parts[1] == "secrets":
        return True
    # Only app/operator user paths. Avoid interpreting base-image OS settings
    # or bundled system CA certs as a user-provided app secret.
    if parts[0] in ROOTS:
        if basename == ".env" or basename.startswith(".env."):
            return True
        if basename in ("id_rsa", "id_ed25519", "credentials.json"):
            return True
        if len(parts) >= 2 and parts[0] == "root" and parts[1] == ".aws":
            return True
    return False


def app_owned_path(name: str) -> bool:
    parts = normalize(name).split("/")
    return bool(parts and parts[0] in ROOTS)


def inspect_regular_file(member, stream, checks, member_path):
    if member.size < 0 or checks["bytes"] + member.size > MAX_SCAN_BYTES:
        raise LayerAuditFailure("SCAN_BYTE_LIMIT_EXCEEDED")
    fileobj = stream.extractfile(member)
    if fileobj is None:
        raise LayerAuditFailure("LAYER_FILE_UNREADABLE")
    overlap = max(
        len(m) for m in (*SYNTHETIC_MARKERS, *PRIVATE_KEY_HEADERS)
    ) - 1
    tail = b""
    remaining = member.size
    dependency_pem_seen = False
    while remaining:
        block = fileobj.read(min(CHUNK, remaining))
        if not block:
            raise LayerAuditFailure("TRUNCATED_IMAGE_LAYER")
        remaining -= len(block)
        checks["bytes"] += len(block)
        window = tail + block
        if any(marker in window for marker in SYNTHETIC_MARKERS):
            raise LayerAuditFailure("CI_CREDENTIAL_CANARY_EMBEDDED")
        if app_owned_path(member_path) and any(
            h in window for h in PRIVATE_KEY_HEADERS
        ):
            # Third-party packages sometimes ship public test-key fixtures.
            # Never equate their headers with a confirmed real credential.
            # Retain an explicit review-required finding, not false clearance.
            if "node_modules" in normalize(member_path).split("/"):
                if not dependency_pem_seen:
                    checks["dependency_pem_files"] += 1
                    dependency_pem_seen = True
            else:
                raise LayerAuditFailure("APP_SOURCE_PEM_HEADER_FOUND")
        tail = window[-overlap:]


class ReattachedPrefix:
    """Re-expose a small inspected header without buffering a whole blob."""
    def __init__(self, prefix, source):
        self.prefix = io.BytesIO(prefix)
        self.source = source

    def read(self, count=-1):
        if count is None or count < 0:
            return self.prefix.read() + self.source.read()
        if count == 0:
            return b""
        first = self.prefix.read(count)
        if len(first) == count:
            return first
        return first + self.source.read(count - len(first))


OCI_BLOB = re.compile(r"blobs/sha256/[a-f0-9]{64}\Z")


def layer_input(archive, member, name, checks):
    """Return a stream only for actual tar layers, not OCI JSON descriptors."""
    if not member.isfile():
        return None
    source = archive.extractfile(member)
    if source is None:
        raise LayerAuditFailure("ARCHIVE_BLOB_UNREADABLE")
    if name.endswith("/layer.tar"):
        return source
    if not OCI_BLOB.fullmatch(name):
        return None
    prefix = source.read(min(512, member.size))
    stripped = prefix.lstrip()
    if stripped.startswith((b"{", b"[")):
        if member.size > 8 * 1024 * 1024:
            raise LayerAuditFailure("OCI_JSON_METADATA_OVERSIZED")
        # Validate descriptor/config JSON; never print their contents.
        raw = prefix + source.read()
        try:
            json.loads(raw)
        except (ValueError, UnicodeError):
            raise LayerAuditFailure("OCI_JSON_METADATA_MALFORMED")
        checks["oci_json_metadata_blobs"] += 1
        return None
    magic = prefix[:6]
    supported = (
        prefix[257:262] == b"ustar"
        or prefix.startswith(b"\x1f\x8b")
        or prefix.startswith(b"BZh")
        or prefix.startswith(b"\xfd7zXZ")
    )
    if not supported:
        raise LayerAuditFailure("UNSUPPORTED_OCI_LAYER_FORMAT")
    checks["oci_layer_blobs"] += 1
    return ReattachedPrefix(prefix, source)


def audit_layers(source) -> dict:
    checks = {
        "layers": 0, "files": 0, "bytes": 0,
        "oci_json_metadata_blobs": 0, "oci_layer_blobs": 0,
        "dependency_pem_files": 0,
    }
    outer_count = 0
    with tarfile.open(fileobj=source, mode="r|*") as archive:
        for member in archive:
            outer_count += 1
            if outer_count > MAX_OUTER_MEMBERS:
                raise LayerAuditFailure("IMAGE_ARCHIVE_MEMBER_LIMIT_EXCEEDED")
            name = normalize(member.name)
            if not name.endswith("/layer.tar") and not OCI_BLOB.fullmatch(name):
                continue
            layer = layer_input(archive, member, name, checks)
            if layer is None:
                continue
            checks["layers"] += 1
            if checks["layers"] > MAX_LAYERS:
                raise LayerAuditFailure("IMAGE_LAYER_COUNT_LIMIT_EXCEEDED")
            # Docker-save and OCI/Containerd manifests may use different
            # layouts: inspect each actual uncompressed or gzip/xz/bz2 TAR.
            with tarfile.open(fileobj=layer, mode="r|*") as contents:
                for entry in contents:
                    checks["files"] += 1
                    if checks["files"] > MAX_LAYER_FILES:
                        raise LayerAuditFailure("LAYER_FILE_COUNT_LIMIT_EXCEEDED")
                    entry_name = normalize(entry.name)
                    if forbidden_path(entry_name):
                        raise LayerAuditFailure("PRIVATE_FILE_IN_IMAGE_LAYER")
                    if entry.isfile():
                        inspect_regular_file(
                            entry, contents, checks,
                            entry_name,
                        )
    if checks["layers"] < 1 or checks["files"] < 1:
        raise LayerAuditFailure("NO_IMAGE_LAYERS_SCANNED")
    return checks


def main() -> int:
    if sys.argv[1:] != ["--docker-save-stdin"] or sys.stdin.isatty():
        print("V5_CLEAN_LAYER_AUDIT=CHECK_REQUIRED_INPUT")
        return 2
    try:
        counts = audit_layers(sys.stdin.buffer)
        print("V5_IMAGE_LAYER_ARCHIVES_SCANNED=" + str(counts["layers"]))
        print("V5_IMAGE_LAYER_ENTRIES_CHECKED=" + str(counts["files"]))
        print("V5_IMAGE_LAYER_BYTES_SCANNED=" + str(counts["bytes"]))
        print("V5_OCI_LAYER_BLOBS_SCANNED=" + str(counts["oci_layer_blobs"]))
        print("V5_OCI_JSON_METADATA_BLOBS_VALIDATED=" + str(
            counts["oci_json_metadata_blobs"]
        ))
        print("V5_DEPENDENCY_PEM_FILES_REQUIRE_REVIEW=" + str(
            counts["dependency_pem_files"]
        ))
        print("V5_CI_CANARY_VALUES_FOUND=NO")
        print("V5_PRIVATE_FILES_IN_LAYERS=NO")
        print("V5_LAYER_AUDIT=" + (
            "PASS_BOUNDED_PATTERNS_WITH_DEPENDENCY_REVIEW_PENDING"
            if counts["dependency_pem_files"]
            else "PASS_BOUNDED_PATTERNS_ONLY"
        ))
        print("UNRELATED_SECRET_PATTERNS_OR_OLD_IMAGES_CLEARED=NO")
        print("SOURCE_TO_OCI_SIGNED_PROVENANCE=NOT_ATTESTED")
        print("STAGING_PRODUCTION_CHANGED=NO")
        print("COMMERCIAL_GO=HOLD")
        return 0
    except LayerAuditFailure as exc:
        # All raised LayerAuditFailure messages are hard-coded public enums.
        # Never propagate untrusted TAR names, file content or image metadata.
        print("V5_LAYER_AUDIT=CHECK_REQUIRED")
        print("V5_LAYER_AUDIT_FAILURE_CODE=" + str(exc))
        print("IMAGE_NAMES_PATHS_SECRET_VALUES_PRINTED=NO")
        print("STAGING_PRODUCTION_CHANGED=NO")
        print("COMMERCIAL_GO=HOLD")
        return 2
    except (tarfile.TarError, OSError, ValueError):
        print("V5_LAYER_AUDIT=CHECK_REQUIRED")
        print("V5_LAYER_AUDIT_FAILURE_CODE=UNREADABLE_IMAGE_TAR")
        print("IMAGE_NAMES_PATHS_SECRET_VALUES_PRINTED=NO")
        print("STAGING_PRODUCTION_CHANGED=NO")
        print("COMMERCIAL_GO=HOLD")
        return 2


if __name__ == "__main__":
    sys.exit(main())
