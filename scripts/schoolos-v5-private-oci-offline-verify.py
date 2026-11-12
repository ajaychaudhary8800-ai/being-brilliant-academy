#!/usr/bin/env python3
"""Owner-local, offline verification of a signed PRIVATE V5 OCI rollback pair.

Checks the *actual* OCI tar image manifest digest (not a Docker config ID or
self-reported label), every referenced config/layer blob's SHA-256 and uncompressed rootfs DiffID,
its signed full-archive checksum, and the source-revision label. It never
contacts R2, Docker, staging or production; does not publish, import or extract
private images. This is NOT a source-build attestation or application restore.

All paths and signed manifest inputs must be injected by a protected local
process environment. No private names, archive bytes or remote values print.
"""
from __future__ import annotations

import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys
import tarfile
import zlib

PARENT = Path(__file__).resolve().with_name("schoolos-v5-private-r2-signed-readback.py")
try:
    spec = importlib.util.spec_from_file_location("v5_private_r2_readback", PARENT)
    if spec is None or spec.loader is None:
        raise ImportError()
    signed = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(signed)
except (OSError, ImportError, AttributeError, ValueError):
    # Never echo protected owner file paths in a missing-dependency traceback.
    raise SystemExit("V5_ROLLBACK_LOCAL_OCI_CONTENT_VERIFICATION=HOLD_DEPENDENCY") from None

MAX_TAR_MEMBERS = 4096
MAX_MEMBER_CONTENT = 16 * 1024 * 1024 * 1024
MAX_SMALL_JSON = 2 * 1024 * 1024
MAX_CAPTURE_BYTES = 32 * 1024 * 1024
# Bound gzip expansion even when the compressed OCI layer is only a few bytes.
MAX_EXPANDED_LAYER_BYTES = 64 * 1024 * 1024 * 1024
READ_CHUNK = 256 * 1024
DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")
BLOB = re.compile(r"blobs/sha256/([a-f0-9]{64})\Z")


class Hold(Exception):
    pass


def _safe_json(raw):
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=signed._unique_pairs,
                          parse_constant=signed._reject_constant)
    except (UnicodeError, TypeError, ValueError, signed.Hold):
        raise Hold() from None


def _desc(obj):
    if not isinstance(obj, dict):
        raise Hold()
    digest = obj.get("digest")
    size = obj.get("size")
    if not isinstance(digest, str) or not DIGEST.fullmatch(digest):
        raise Hold()
    if type(size) is not int or size <= 0 or size > MAX_MEMBER_CONTENT:
        raise Hold()
    return digest, size


class HashingReader:
    def __init__(self, file):
        self.file = file
        self.sha = hashlib.sha256()
        self.count = 0

    def read(self, n=-1):
        if n is None or n < 0 or n > READ_CHUNK:
            n = READ_CHUNK
        data = self.file.read(n)
        self.count += len(data)
        self.sha.update(data)
        return data


def _inspect_tar(reader, expected_digest, expected_source):
    seen = set()
    scanned = {}
    scanned_diffids = {}
    scanned_gzip = {}
    small = {}
    capture_size = 0
    index = None
    layout = None
    members = 0
    try:
        with tarfile.open(fileobj=reader, mode="r|") as archive:
            for member in archive:
                members += 1
                if members > MAX_TAR_MEMBERS:
                    raise Hold()
                name = member.name
                if name.startswith("./"):
                    name = name[2:]
                if member.isdir():
                    # Standard OCI exporters include trailing "/" for these
                    # two structural directories. Allow only those exact
                    # forms; still reject traversal and all unrelated dirs.
                    if name not in ("blobs", "blobs/", "blobs/sha256", "blobs/sha256/"):
                        raise Hold()
                    continue
                if (not name or name.startswith("/") or "\\" in name or
                        any(component in ("", ".", "..") for component in name.split("/"))):
                    raise Hold()
                if not member.isfile() or name in seen:
                    raise Hold()
                seen.add(name)
                match = BLOB.fullmatch(name)
                if name not in ("index.json", "oci-layout") and not match:
                    raise Hold()
                if member.size < 1 or member.size > MAX_MEMBER_CONTENT:
                    raise Hold()
                if name in ("index.json", "oci-layout") and member.size > MAX_SMALL_JSON:
                    raise Hold()
                source = archive.extractfile(member)
                if source is None:
                    raise Hold()
                hashed = hashlib.sha256()
                uncompressed = hashlib.sha256()
                payload = bytearray()
                remaining = member.size
                encoding = None
                decoder = None
                expanded_size = 0
                capture = (name in ("index.json", "oci-layout") or
                           (match is not None and member.size <= MAX_SMALL_JSON))
                if capture and capture_size + member.size > MAX_CAPTURE_BYTES:
                    raise Hold()
                while remaining:
                    block = source.read(min(READ_CHUNK, remaining))
                    if not block:
                        raise Hold()
                    remaining -= len(block)
                    hashed.update(block)
                    if match:
                        # Check decompressed OCI rootfs DiffIDs, not merely the
                        # syntactic 64-hex values stored in image config.
                        if encoding is None:
                            encoding = "gzip" if block.startswith(b"\x1f\x8b") else "plain"
                            if encoding == "gzip":
                                decoder = zlib.decompressobj(wbits=16 + zlib.MAX_WBITS)
                        if decoder is None:
                            uncompressed.update(block)
                        else:
                            pending = block
                            while pending:
                                before = len(pending)
                                chunk = decoder.decompress(pending, READ_CHUNK)
                                expanded_size += len(chunk)
                                if expanded_size > MAX_EXPANDED_LAYER_BYTES or decoder.unused_data:
                                    raise Hold()
                                uncompressed.update(chunk)
                                pending = decoder.unconsumed_tail
                                if not chunk and len(pending) >= before:
                                    raise Hold()
                    if capture:
                        payload.extend(block)
                if match:
                    if not hmac.compare_digest(hashed.hexdigest(), match.group(1)):
                        raise Hold()
                    if decoder is not None and (not decoder.eof or decoder.unused_data):
                        raise Hold()
                    address = "sha256:" + match.group(1)
                    scanned[address] = member.size
                    scanned_diffids[address] = "sha256:" + uncompressed.hexdigest()
                    scanned_gzip[address] = decoder is not None
                    if capture:
                        small["sha256:" + match.group(1)] = bytes(payload)
                        capture_size += len(payload)
                elif name == "index.json":
                    index = _safe_json(payload)
                elif name == "oci-layout":
                    layout = _safe_json(payload)
    except (tarfile.TarError, OSError, EOFError, ValueError, zlib.error):
        raise Hold() from None

    # tarfile stops at TAR end records, which do NOT necessarily exhaust the
    # complete archive. Consume remainder to hash every trailing byte.
    while reader.read(READ_CHUNK):
        pass
    if not isinstance(layout, dict) or layout.get("imageLayoutVersion") != "1.0.0":
        raise Hold()
    if not isinstance(index, dict) or index.get("schemaVersion") != 2:
        raise Hold()
    descriptors = index.get("manifests")
    # One signed rollback role must resolve to exactly ONE OCI image.
    # Additional index entries can conceal unreviewed platforms or images.
    if not isinstance(descriptors, list) or len(descriptors) != 1:
        raise Hold()
    matching = [d for d in descriptors if isinstance(d, dict) and d.get("digest") == expected_digest]
    if len(matching) != 1 or matching[0].get("mediaType") != "application/vnd.oci.image.manifest.v1+json":
        raise Hold()
    manifest_digest, manifest_size = _desc(matching[0])
    if scanned.get(manifest_digest) != manifest_size or manifest_digest not in small:
        raise Hold()
    manifest = _safe_json(small[manifest_digest])
    if (not isinstance(manifest, dict) or manifest.get("schemaVersion") != 2 or
            manifest.get("mediaType") != "application/vnd.oci.image.manifest.v1+json" or
            not isinstance(manifest.get("layers"), list)):
        raise Hold()
    if not manifest["layers"] or len(manifest["layers"]) > 512:
        raise Hold()
    c = manifest.get("config")
    cd, cs = _desc(c)
    if c.get("mediaType") != "application/vnd.oci.image.config.v1+json" or scanned.get(cd) != cs or cd not in small:
        raise Hold()
    config = _safe_json(small[cd])
    if (not isinstance(config, dict) or config.get("os") != "linux" or
        config.get("architecture") != "amd64" or
        not isinstance(config.get("config"), dict) or
        not isinstance(config["config"].get("Labels"), dict) or
        config["config"]["Labels"].get("org.opencontainers.image.revision") != expected_source):
        raise Hold()
    rootfs = config.get("rootfs")
    if (not isinstance(rootfs, dict) or rootfs.get("type") != "layers" or
            not isinstance(rootfs.get("diff_ids"), list) or
            len(rootfs["diff_ids"]) != len(manifest["layers"]) or
            any(not isinstance(d, str) or not DIGEST.fullmatch(d) for d in rootfs["diff_ids"])):
        raise Hold()
    required_blobs = {manifest_digest, cd}
    for i, layer in enumerate(manifest["layers"]):
        d, size = _desc(layer)
        media = layer.get("mediaType")
        if (media not in ("application/vnd.oci.image.layer.v1.tar+gzip",
                          "application/vnd.oci.image.layer.v1.tar") or
                scanned.get(d) != size):
            # Zstd requires an independently reviewed streaming decoder.
            # Refuse it rather than falsely claiming we checked DiffIDs.
            raise Hold()
        if (scanned_gzip.get(d) != (media == "application/vnd.oci.image.layer.v1.tar+gzip") or
                not hmac.compare_digest(scanned_diffids[d], rootfs["diff_ids"][i])):
            raise Hold()
        required_blobs.add(d)
    # A valid-looking unreferenced SHA-addressed blob may contain secret
    # payloads; exact closed-world inventory is required for rollback custody.
    if set(scanned) != required_blobs:
        raise Hold()
    return len(manifest["layers"])


def verify_archive(path, record, source_sha):
    """Only return if entire local OCI tar matches SIGNED archive+manifest digest."""
    if not isinstance(path, (str, Path)) or not isinstance(record, dict):
        raise Hold()
    try:
        options = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
        if not hasattr(os, "O_NOFOLLOW"):
            raise Hold()
        fd = os.open(path, options)
        with os.fdopen(fd, "rb", closefd=True) as f:
            info = os.fstat(f.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size != record["sizeBytes"]:
                raise Hold()
            reader = HashingReader(f)
            _inspect_tar(reader, record["ociManifestDigest"], source_sha)
            if reader.count != record["sizeBytes"] or not hmac.compare_digest(
                    reader.sha.hexdigest(), record["sha256"]):
                raise Hold()
    except (OSError, ValueError, TypeError, KeyError, signed.Hold):
        raise Hold() from None


def inspect(manifest, signature, key, key_pin, api_tar, web_tar):
    raw = signed._bounded_regular(manifest, signed.MAX_MANIFEST_BYTES)
    payload = signed.decode_signed_manifest(raw)
    signed.verify_detached_signature(raw, signature, key, key_pin)
    if not api_tar or not web_tar or os.fspath(api_tar) == os.fspath(web_tar):
        raise Hold()
    for role, path in (("api", api_tar), ("web", web_tar)):
        verify_archive(path, payload[role], payload["sourceSha"])


def main():
    result = "HOLD"
    try:
        inspect(os.environ.get("V5_CUSTODY_MANIFEST_PATH"),
                os.environ.get("V5_CUSTODY_SIGNATURE_PATH"),
                os.environ.get("V5_CUSTODY_PUBKEY_PATH"),
                os.environ.get("V5_CUSTODY_PUBKEY_SHA256"),
                os.environ.get("V5_CUSTODY_API_OCI_ARCHIVE_PATH"),
                os.environ.get("V5_CUSTODY_WEB_OCI_ARCHIVE_PATH"))
        result = "PASS_LOCAL_SIGNED_ARCHIVES_OCI_DIGESTS"
    except (Hold, signed.Hold, OSError, ValueError, TypeError):
        pass
    print("V5_ROLLBACK_LOCAL_OCI_CONTENT_VERIFICATION=" + result)
    print("OCI_PROVENANCE_ATTESTATION=NOT_VERIFIED_BY_THIS_TOOL")
    print("SOURCE_BUILD_SIGNATURE=NOT_VERIFIED_BY_THIS_TOOL")
    print("PRIVATE_R2_INDEPENDENT_RETRIEVAL=NOT_VERIFIED_BY_THIS_TOOL")
    print("REAL_CHECKPOINT_APP_COMPATIBILITY=NOT_VERIFIED_BY_THIS_TOOL")
    print("PRIVATE_ARCHIVE_OR_CREDENTIAL_VALUES_PRINTED=NO")
    print("R2_OR_STAGING_WRITES=NO")
    print("DEPLOYMENT_AUTHORIZATION=HOLD")
    return 0 if result.startswith("PASS_") else 2


if __name__ == "__main__":
    sys.exit(main())
