#!/usr/bin/env python3
"""Phase 1 owner-local OFFLINE signing of two newly built, clean OCI candidates.

Only produces a pinned-key signed *custody byte manifest*. The statement
authenticates the signed byte checksums, not independent provenance, semantic
secret clearance, permission controls, R2 object persistence, or safe rollback.

No network, Docker, Cloudflare, key generation, image copying, R2 upload,
application restore, credential rotation, or staging/production mutation.
No image bytes, private key bytes, paths or subprocess stderr ever printed.
"""
from __future__ import annotations

import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys

MAX_KEY = 16 * 1024
MAX_PUBKEY = 8 * 1024
MAX_SIGNATURE = 8 * 1024
OUT_MANIFEST = "v5-rollback-custody.json"
OUT_SIGNATURE = "v5-rollback-custody.sig"
SOURCE_ROOT = Path(__file__).resolve().parent


class Hold(Exception):
    """Do not propagate potentially sensitive third-party messages."""


def _load(name, filename):
    spec = importlib.util.spec_from_file_location(name, SOURCE_ROOT / filename)
    if spec is None or spec.loader is None:
        raise Hold()
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
    except (OSError, ValueError, ImportError, AttributeError, SystemExit):
        raise Hold() from None
    return module


def _read_bounded(path, maximum, *, private=False):
    if not path or not hasattr(os, "O_NOFOLLOW"):
        raise Hold()
    fd = None
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0))
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= maximum or
                (private and (info.st_uid != os.getuid() or info.st_mode & 0o077))):
            raise Hold()
        with os.fdopen(fd, "rb") as stream:
            fd = None
            raw = stream.read(maximum + 1)
        if len(raw) != info.st_size:
            raise Hold()
        return raw
    except (OSError, ValueError):
        raise Hold() from None
    finally:
        if fd is not None:
            os.close(fd)


def _proc_memfd(label, contents):
    if not hasattr(os, "memfd_create") or not hasattr(os, "MFD_CLOEXEC"):
        raise Hold()
    fd = os.memfd_create(label, flags=os.MFD_CLOEXEC)
    try:
        if os.write(fd, contents) != len(contents):
            raise Hold()
        os.lseek(fd, 0, os.SEEK_SET)
        return fd
    except (OSError, ValueError):
        os.close(fd)
        raise Hold() from None


def _openssl(argv, message=None, pass_fds=()):
    try:
        result = subprocess.run(
            ["openssl"] + argv, input=message,
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            stdin=subprocess.PIPE if message is not None else subprocess.DEVNULL,
            check=False, timeout=20, pass_fds=pass_fds,
        )
    except (OSError, ValueError, subprocess.TimeoutExpired):
        raise Hold() from None
    if result.returncode != 0 or len(result.stdout) > MAX_PUBKEY:
        raise Hold()
    return result.stdout


def signature_bytes(manifest, private_key_path, public_key_path, pubkey_pin):
    if not isinstance(manifest, bytes) or not 0 < len(manifest) <= 16 * 1024:
        raise Hold()
    if (not isinstance(pubkey_pin, str) or len(pubkey_pin) != 64 or
            any(ch not in "0123456789abcdef" for ch in pubkey_pin)):
        raise Hold()
    public = _read_bounded(public_key_path, MAX_PUBKEY)
    if not hmac.compare_digest(hashlib.sha256(public).hexdigest(), pubkey_pin):
        raise Hold()
    private = _read_bounded(private_key_path, MAX_KEY, private=True)
    keyfd = pubfd = sigfd = None
    try:
        keyfd = _proc_memfd("v5-owner-local-signing-key", private)
        # Ensure the signing private key is actually paired with the exact
        # owner-pinned public key bytes; do not derive trust from a key path.
        derived = _openssl(["pkey", "-in", f"/proc/self/fd/{keyfd}", "-pubout"],
                           pass_fds=(keyfd,))
        if not hmac.compare_digest(derived, public):
            raise Hold()
        signature = _openssl([
            "dgst", "-sha256", "-sign", f"/proc/self/fd/{keyfd}"
        ], message=manifest, pass_fds=(keyfd,))
        if not 0 < len(signature) <= MAX_SIGNATURE:
            raise Hold()
        pubfd = _proc_memfd("v5-owner-pinned-public-key", public)
        sigfd = _proc_memfd("v5-owner-detached-signature", signature)
        _openssl([
            "dgst", "-sha256", "-verify", f"/proc/self/fd/{pubfd}",
            "-signature", f"/proc/self/fd/{sigfd}"
        ], message=manifest, pass_fds=(pubfd, sigfd))
        return signature
    finally:
        for fd in (keyfd, pubfd, sigfd):
            if fd is not None:
                os.close(fd)


def _restricted_output_dir(outdir):
    if not outdir:
        raise Hold()
    root = Path(outdir)
    try:
        if root.is_symlink():
            raise Hold()
        meta = root.stat()
        if (not stat.S_ISDIR(meta.st_mode) or
                meta.st_uid != os.getuid() or meta.st_mode & 0o077):
            raise Hold()
        for name in (OUT_MANIFEST, OUT_SIGNATURE):
            # No overwrite, including pre-existing broken/incomplete outputs.
            if (root / name).exists() or (root / name).is_symlink():
                raise Hold()
        return root
    except (OSError, ValueError):
        raise Hold() from None


def _write_exclusive(root, name, data):
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
    fd = os.open(root / name, flags, 0o600)
    with os.fdopen(fd, "wb") as target:
        target.write(data)
        target.flush()
        os.fsync(target.fileno())


def sign_offline(api_path, web_path, private_key, public_key, pubkey_pin, outdir):
    # Precheck files before spending time examining the OCI images.
    root = _restricted_output_dir(outdir)
    candidate = _load("v5_offline_candidate_manifest",
                      "schoolos-v5-prior-oci-candidate-manifest.py")
    readback = _load("v5_offline_custody_readback",
                     "schoolos-v5-private-r2-signed-readback.py")
    try:
        payload = candidate.candidate_receipt(api_path, web_path)
        raw = (json.dumps(payload, sort_keys=True, separators=(",", ":")) + "\n").encode()
        readback.decode_signed_manifest(raw)
        signature = signature_bytes(raw, private_key, public_key, pubkey_pin)
        created = []
        try:
            _write_exclusive(root, OUT_MANIFEST, raw)
            created.append(root / OUT_MANIFEST)
            _write_exclusive(root, OUT_SIGNATURE, signature)
            created.append(root / OUT_SIGNATURE)
            # Existing independent verifier ensures compatibility with R2
            # signed readback's pinned-key signature contract.
            readback.verify_detached_signature(
                raw, root / OUT_SIGNATURE, public_key, pubkey_pin
            )
        except (OSError, ValueError, readback.Hold):
            for path in created:
                try:
                    path.unlink()
                except OSError:
                    pass
            raise Hold() from None
    except (candidate.Hold, readback.Hold, OSError, ValueError, TypeError):
        raise Hold() from None


def main():
    try:
        sign_offline(
            os.environ.get("V5_CUSTODY_API_OCI_ARCHIVE_PATH"),
            os.environ.get("V5_CUSTODY_WEB_OCI_ARCHIVE_PATH"),
            os.environ.get("V5_CUSTODY_PRIVATE_SIGNING_KEY_PATH"),
            os.environ.get("V5_CUSTODY_PUBKEY_PATH"),
            os.environ.get("V5_CUSTODY_PUBKEY_SHA256"),
            os.environ.get("V5_CUSTODY_SIGNED_OUTPUT_DIR"),
        )
        status, rc = "PASS_PINNED_LOCAL_SIGNATURE_ONLY", 0
    except Hold:
        status, rc = "HOLD", 2
    print("V5_PRIOR_CUSTODY_BYTE_MANIFEST_SIGNING=" + status)
    print("V5_OWNER_SIGNING_KEY_EXPORTED_OR_PRINTED=NO")
    print("V5_OCI_SOURCE_TO_BUILD_INDEPENDENT_PROVENANCE=NOT_ATTESTED")
    print("V5_IMAGE_FULL_SEMANTIC_SECRET_CLEARANCE=NOT_ATTESTED")
    print("V5_PRIVATE_R2_WRITES=NO")
    print("V5_PRIVATE_R2_RETRIEVAL=NOT_VERIFIED")
    print("V5_REAL_CHECKPOINT_APPLICATION_ROLLBACK=NOT_VERIFIED")
    print("V5_STAGING_PRODUCTION_CHANGED=NO")
    print("DEPLOYMENT_AUTHORIZATION=HOLD")
    return rc


if __name__ == "__main__":
    sys.exit(main())
