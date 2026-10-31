"""Values-free fixture tests for local-only V5 checkpoint preflight."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest


SCRIPTS = Path(__file__).parent
spec = importlib.util.spec_from_file_location(
    "v5_private_checkpoint_preflight",
    SCRIPTS / "schoolos-v5-private-checkpoint-preflight.py",
)
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)


def digest(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


class PrivateCheckpointPreflight(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.db = b"PGDMP" + b"synthetic-custom-dump-not-real-postgres"
        (self.root / "database.dump").write_bytes(self.db)
        self.write_tar()
        self.write_manifest()

    def write_tar(self, name: str = "./fake-upload.txt", symlink: bool = False):
        with tarfile.open(self.root / "files.tar.gz", "w:gz") as tar:
            if symlink:
                info = tarfile.TarInfo(name)
                info.type = tarfile.SYMTYPE
                info.linkname = "/outside"
                tar.addfile(info)
            else:
                b = b"synthetic-test-only"
                info = tarfile.TarInfo(name)
                info.size = len(b)
                tar.addfile(info, io.BytesIO(b))

    def write_manifest(self, extras=None, relative=False):
        d = digest((self.root / "database.dump").read_bytes())
        f = digest((self.root / "files.tar.gz").read_bytes())
        root = "" if relative else "/backups/20261031T073407Z/"
        rows = [f"{d}  {root}database.dump", f"{f}  {root}files.tar.gz"]
        if extras:
            rows += extras
        (self.root / "SHA256SUMS").write_text("\n".join(rows) + "\n", encoding="ascii")

    def test_legacy_absolute_manifest_is_portable_but_not_authenticated(self):
        data = preflight.preflight(self.root, None)
        self.assertEqual(data["manifest_checksums"], "PASS")
        self.assertEqual(data["origin_manifest_authenticity"], "NOT_ATTESTED")
        self.assertEqual(data["tar_archive_path_safety"], "PASS")
        self.assertEqual(data["database_restore"], "NOT_EXECUTED")
        self.assertEqual(data["staging_and_production_changed"], False)

    def test_out_of_band_manifest_digest_authenticates_exact_manifest_only(self):
        good = digest((self.root / "SHA256SUMS").read_bytes())
        data = preflight.preflight(self.root, good)
        self.assertEqual(data["origin_manifest_authenticity"], "PASS_OUT_OF_BAND_DIGEST_MATCH")
        with self.assertRaisesRegex(preflight.PreflightFailure, "TRUSTED_MANIFEST_MISMATCH"):
            preflight.preflight(self.root, "0" * 64)

    def test_relative_manifest_supported(self):
        self.write_manifest(relative=True)
        self.assertEqual(preflight.preflight(self.root, None)["manifest_checksums"], "PASS")

    def test_database_tampering_rejected(self):
        (self.root / "database.dump").write_bytes(self.db + b"tamper")
        with self.assertRaisesRegex(preflight.PreflightFailure, "DIGEST_MISMATCH"):
            preflight.preflight(self.root, None)

    def test_duplicate_manifest_record_rejected(self):
        self.write_manifest(["0" * 64 + "  /backups/old/database.dump"])
        with self.assertRaisesRegex(preflight.PreflightFailure, "MANIFEST_SHAPE"):
            preflight.preflight(self.root, None)

    def test_bad_tar_traversal_rejected(self):
        self.write_tar("../../escape.txt")
        self.write_manifest()
        with self.assertRaisesRegex(preflight.PreflightFailure, "UNSAFE_TAR_ENTRY"):
            preflight.preflight(self.root, None)

    def test_symlink_tar_entry_rejected(self):
        self.write_tar("./link", symlink=True)
        self.write_manifest()
        with self.assertRaisesRegex(preflight.PreflightFailure, "UNSAFE_TAR_ENTRY"):
            preflight.preflight(self.root, None)

    def test_db_magic_invalid(self):
        (self.root / "database.dump").write_bytes(b"notcustomdump")
        self.write_manifest()
        with self.assertRaisesRegex(preflight.PreflightFailure, "CUSTOM_DUMP_HEADER_INVALID"):
            preflight.preflight(self.root, None)

    def test_symlink_input_rejected(self):
        path = self.root / "files.tar.gz"
        target = self.root / "files-copy.tar.gz"
        target.write_bytes(path.read_bytes())
        path.unlink()
        try:
            path.symlink_to(target)
        except OSError:
            self.skipTest("symlink unsupported on runner")
        with self.assertRaisesRegex(preflight.PreflightFailure, "NONREGULAR_INPUT"):
            preflight.preflight(self.root, None)

    def test_report_created_exclusively_with_safe_values(self):
        data = preflight.preflight(self.root, None)
        dest = self.root / "sanitized-report.json"
        preflight.write_report_exclusive(dest, data)
        parsed = json.loads(dest.read_text())
        self.assertEqual(parsed["customer_data_printed"], False)
        self.assertEqual(parsed["deployment_authorization"], "HOLD")
        if os.name == "posix":
            self.assertEqual(dest.stat().st_mode & 0o777, 0o600)
        with self.assertRaisesRegex(preflight.PreflightFailure, "REPORT_CREATION_FAILED"):
            preflight.write_report_exclusive(dest, data)


if __name__ == "__main__":
    unittest.main()
