#!/usr/bin/env python3
"""SchoolOS V5: OWNER-LOCAL Windows DPAPI escrow, single Vault key only.

Explicit, read-only server file access over strict-host-key-checked SSH.
No Docker, Compose, database, Coolify or staging config mutation. No log,
console, command-line argument or environment variable ever carries the key.
Secret arrives over SSH stdout into memory, then is encrypted via Windows DPAPI
for CURRENT WINDOWS USER before exclusive restricted local file write.
The original server secret stays unchanged; all other keys remain untouched.
"""
from __future__ import annotations

import argparse
import ctypes
from ctypes import wintypes
import hmac
import json
import os
from pathlib import Path
import re
import subprocess
import sys

SERVER = "root@200.141.12.225"
KEY_LABEL = b"COMMERCIAL_DOCUMENT_ENCRYPTION_KEY="
CHECKPOINT_ID = "20261031T073407Z"
CUSTODY_FILE = "original-vault-key.dpapi"
REMOTE_SCRIPT = """
import sys
try:
    key = b'COMMERCIAL_DOCUMENT_ENCRYPTION_KEY='
    with open('/etc/schoolos/v5-staging/app-v5-api.env','rb') as f:
        lines = [x.rstrip(b'\\r\\n')[len(key):] for x in f if x.startswith(key)]
    if len(lines) != 1: sys.exit(21)
    raw = lines[0]
    if len(raw) >= 2 and raw[0:1] in (b'"', b"'") and raw[-1:] == raw[0:1]:
        raw = raw[1:-1]
    if not (32 <= len(raw) <= 512) or any(n in raw for n in (b'\\r', b'\\n', b'\\0')):
        sys.exit(22)
    raw.decode('utf-8', errors='strict')
    sys.stdout.buffer.write(raw)
except:
    sys.exit(23)
"""

class CustodyFailure(Exception):
    pass

class DATA_BLOB(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD),
                ("pbData", ctypes.POINTER(ctypes.c_ubyte))]


def _blob(data: bytes):
    if not data or len(data) > 2048:
        raise CustodyFailure("SECRET_INPUT_INVALID")
    buf = (ctypes.c_ubyte * len(data)).from_buffer_copy(data)
    return DATA_BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_ubyte))), buf


def _dpapi(data: bytes, decrypt: bool) -> bytes:
    if sys.platform != "win32":
        raise CustodyFailure("OWNER_WINDOWS_REQUIRED")
    crypt = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    fn = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    fn.restype = wintypes.BOOL
    fn.argtypes = [
        ctypes.POINTER(DATA_BLOB), ctypes.c_void_p,
        ctypes.POINTER(DATA_BLOB), ctypes.c_void_p, ctypes.c_void_p,
        wintypes.DWORD, ctypes.POINTER(DATA_BLOB),
    ]
    # Both APIs share the same ABI; the 2nd pointer is a description
    # output for UnprotectData and an optional string for ProtectData.
    blob, backing = _blob(data)
    out = DATA_BLOB()
    try:
        if not fn(ctypes.byref(blob), None, None, None, None,
                  0x1, ctypes.byref(out)):
            raise CustodyFailure("WINDOWS_DPAPI_OPERATION_FAILED")
        if not out.pbData or out.cbData > 8192:
            raise CustodyFailure("WINDOWS_DPAPI_RESULT_INVALID")
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        ctypes.memset(ctypes.addressof(backing), 0, ctypes.sizeof(backing))
        if out.pbData:
            kernel.LocalFree.argtypes = [ctypes.c_void_p]
            kernel.LocalFree.restype = ctypes.c_void_p
            kernel.LocalFree(ctypes.cast(out.pbData, ctypes.c_void_p))


def protect(secret: bytes) -> bytes:
    if not 32 <= len(secret) <= 512:
        raise CustodyFailure("KEY_LENGTH_INVALID")
    return _dpapi(secret, False)


def unprotect(blob: bytes) -> bytes:
    return _dpapi(blob, True)


def validate_storage() -> None:
    if sys.platform != "win32":
        raise CustodyFailure("OWNER_WINDOWS_REQUIRED")
    code = (
        "$b=Get-BitLockerVolume -MountPoint 'C:';"
        "if($b.ProtectionStatus.ToString() -eq 'On' "
        "-and $b.EncryptionPercentage -eq 100){exit 0}else{exit 5}"
    )
    try:
        x = subprocess.run([
            "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", code
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
           timeout=30, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise CustodyFailure("BITLOCKER_VERIFICATION_UNAVAILABLE")
    if x.returncode != 0:
        raise CustodyFailure("BITLOCKER_PROTECTION_REQUIRED")


def validate_workspace(workspace: Path) -> Path:
    absolute = workspace.resolve(strict=True)
    local = Path(os.environ["LOCALAPPDATA"]).resolve(strict=True)
    if absolute.parent != local or not re.fullmatch(
        r"SchoolOS-V5-Recovery-[a-f0-9]{32}", absolute.name
    ) or workspace.is_symlink() or not (
        absolute / CHECKPOINT_ID / "database.dump"
    ).is_file() or not (absolute / CHECKPOINT_ID / "SHA256SUMS").is_file():
        raise CustodyFailure("UNTRUSTED_PRIVATE_WORKSPACE")
    return absolute


def sid() -> str:
    result = subprocess.run([
        "powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
        "[Security.Principal.WindowsIdentity]::GetCurrent().User.Value"
    ], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
       timeout=20, check=False)
    value = result.stdout.decode("ascii", errors="ignore").strip()
    if result.returncode or not re.fullmatch(r"S-1-(?:[0-9]+-){2,15}[0-9]+", value):
        raise CustodyFailure("OWNER_SID_UNAVAILABLE")
    return value


def restrict_acl(path: Path, owner_sid: str) -> None:
    grant = "*" + owner_sid + (
        ":(OI)(CI)F" if path.is_dir() else ":F"
    )
    cmd = ["icacls", str(path), "/inheritance:r", "/grant:r", grant]
    result = subprocess.run(
        cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        timeout=30, check=False,
    )
    if result.returncode:
        raise CustodyFailure("PRIVATE_ACL_SETUP_FAILED")


def obtain_single_secret() -> bytes:
    # Do NOT print remote stdout; it contains ONLY the one allowed Vault key.
    # Strict host key checking forbids a previously unseen/changed server key.
    try:
        p = subprocess.run([
            "ssh", "-T", "-o", "StrictHostKeyChecking=yes",
            "-o", "ConnectTimeout=20", "-o", "NumberOfPasswordPrompts=2",
            SERVER, "python3 -",
        ], input=REMOTE_SCRIPT.encode("ascii"), stdout=subprocess.PIPE,
           stderr=subprocess.DEVNULL, timeout=120, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise CustodyFailure("PROTECTED_SSH_ACQUISITION_UNAVAILABLE")
    secret = p.stdout
    if p.returncode or not 32 <= len(secret) <= 512:
        raise CustodyFailure("PROTECTED_SSH_ACQUISITION_FAILED")
    try:
        decoded = secret.decode("utf-8", errors="strict")
    except UnicodeError:
        raise CustodyFailure("VAULT_KEY_ENCODING_INVALID")
    if any(char in decoded for char in ("\r", "\n", "\0")):
        raise CustodyFailure("VAULT_KEY_FORMAT_INVALID")
    return secret


def acquire(workspace: Path) -> None:
    validate_storage()
    root = validate_workspace(workspace)
    escrow_dir = root / "protected-escrow"
    if escrow_dir.exists():
        if not escrow_dir.is_dir() or escrow_dir.is_symlink():
            raise CustodyFailure("ESCROW_LOCATION_UNSAFE")
    else:
        escrow_dir.mkdir(mode=0o700)
    identity = sid()
    restrict_acl(escrow_dir, identity)
    target = escrow_dir / CUSTODY_FILE
    if target.exists() or target.is_symlink():
        raise CustodyFailure("EXISTING_ESCROW_REFUSED")
    secret = bytearray(obtain_single_secret())
    try:
        packed = protect(bytes(secret))
    finally:
        for i in range(len(secret)):
            secret[i] = 0
    # Exclusive, never overwrite a prior original-key escrow.
    fd = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_BINARY, 0o600)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(packed)
            f.flush()
            os.fsync(f.fileno())
        restrict_acl(target, identity)
        # Confirm DPAPI escrow is usable by THIS Windows user, not just saved.
        decoded = bytearray(unprotect(target.read_bytes()))
        try:
            if not (32 <= len(decoded) <= 512):
                raise CustodyFailure("DPAPI_READBACK_INVALID")
        finally:
            for i in range(len(decoded)):
                decoded[i] = 0
    except Exception:
        try:
            target.unlink(missing_ok=True)
        except OSError:
            pass
        raise
    print("VAULT_ORIGINAL_FILE_READ_ONLY=PASS")
    print("VAULT_KEY_TRANSFER=SSH_STRICT_HOSTKEY_ENCRYPTED")
    print("VAULT_KEY_CUSTODY=PASS_LOCAL_USER_DPAPI")
    print("VAULT_INDEPENDENT_OFFSITE_ESCROW=NOT_ATTESTED")
    print("VAULT_KEY_AND_PLAINTEXT_PRINTED=NO")
    print("STAGING_AND_PRODUCTION_CHANGED=NO")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--workspace", type=Path, required=True)
    p.add_argument("--acquire-vault-key", action="store_true")
    p.add_argument("--acknowledge-protected-readonly-transfer",
                   action="store_true")
    a = p.parse_args()
    try:
        if not (a.acquire_vault_key and
                a.acknowledge_protected_readonly_transfer):
            raise CustodyFailure("KEY_TRANSFER_OWNER_ACK_REQUIRED")
        acquire(a.workspace)
        return 0
    except (CustodyFailure, OSError, UnicodeError, ValueError):
        print("VAULT_KEY_CUSTODY=CHECK_REQUIRED")
        print("NO_CREDENTIAL_VALUES_PRINTED=YES")
        print("STAGING_AND_PRODUCTION_CHANGED=NO")
        return 2


if __name__ == "__main__":
    sys.exit(main())
