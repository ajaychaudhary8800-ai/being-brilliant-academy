"""Synthetic only. Does not call SSH, inspect credentials or run DPAPI in CI."""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "private_dpapi_vault_custody",
    HERE / "schoolos-v5-private-dpapi-vault-custody.py",
)
CUSTODY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CUSTODY)


class V5OwnerVaultCustodyTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.local = Path(temp.name)
        self.workspace = self.local / ("SchoolOS-V5-Recovery-" + "a" * 32)
        self.workspace.mkdir()
        checkpoint = self.workspace / CUSTODY.CHECKPOINT_ID
        checkpoint.mkdir()
        (checkpoint / "database.dump").write_bytes(b"synthetic")
        (checkpoint / "SHA256SUMS").write_text("synthetic")

    def test_remote_script_exact_allowlisted_key_and_path_only(self):
        compile(CUSTODY.REMOTE_SCRIPT, "trusted-remote-script", "exec")
        self.assertIn("COMMERCIAL_DOCUMENT_ENCRYPTION_KEY=", CUSTODY.REMOTE_SCRIPT)
        self.assertIn("/etc/schoolos/v5-staging/app-v5-api.env", CUSTODY.REMOTE_SCRIPT)
        self.assertNotIn("POSTGRES_PASSWORD", CUSTODY.REMOTE_SCRIPT)
        self.assertNotIn("REDIS_PASSWORD", CUSTODY.REMOTE_SCRIPT)
        self.assertNotIn("RAZORPAY_KEY_SECRET", CUSTODY.REMOTE_SCRIPT)
        self.assertNotIn("print(", CUSTODY.REMOTE_SCRIPT)

    def test_owner_private_workspace_must_reside_under_localappdata(self):
        with patch.dict(os.environ, {"LOCALAPPDATA": str(self.local)}):
            self.assertEqual(
                CUSTODY.validate_workspace(self.workspace),
                self.workspace.resolve(),
            )
            wrong = self.local / "Another-Recovery"
            wrong.mkdir()
            with self.assertRaises(CUSTODY.CustodyFailure):
                CUSTODY.validate_workspace(wrong)

    def test_synthetic_secret_never_written_raw_and_no_overwrite(self):
        password = b"SYNTHETIC-ONLY-ORIGINAL-KEY-EXAMPLE-ABCDE"  # no real key
        ciphertext = b"Windows-user-bound-DPAPI-ENCRYPTED-FIXTURE-" + b"x" * 70
        with patch.object(CUSTODY, "validate_storage"), \
             patch.object(CUSTODY, "validate_workspace",
                          return_value=self.workspace), \
             patch.object(CUSTODY, "sid", return_value="S-1-5-21-99"), \
             patch.object(CUSTODY, "restrict_acl"), \
             patch.object(CUSTODY, "obtain_single_secret", return_value=password) as getkey, \
             patch.object(CUSTODY, "protect", return_value=ciphertext), \
             patch.object(CUSTODY, "unprotect", return_value=password), \
             contextlib.redirect_stdout(io.StringIO()) as output:
            CUSTODY.acquire(self.workspace)
            with self.assertRaisesRegex(
                CUSTODY.CustodyFailure, "EXISTING_ESCROW_REFUSED"
            ):
                CUSTODY.acquire(self.workspace)
        found = self.workspace / "protected-escrow" / CUSTODY.CUSTODY_FILE
        self.assertEqual(found.read_bytes(), ciphertext)
        self.assertNotEqual(found.read_bytes(), password)
        getkey.assert_called_once()
        self.assertIn("VAULT_KEY_CUSTODY=PASS_LOCAL_USER_DPAPI", output.getvalue())
        self.assertNotIn(password.decode("utf-8"), output.getvalue())

    def test_owner_flag_is_required_and_no_ssh_before_ack(self):
        with patch("sys.argv", ["vault-custody",
                                "--workspace", str(self.workspace)]), \
             patch.object(CUSTODY, "obtain_single_secret") as ssh, \
             contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(CUSTODY.main(), 2)
            ssh.assert_not_called()
        self.assertIn("VAULT_KEY_CUSTODY=CHECK_REQUIRED", output.getvalue())


if __name__ == "__main__":
    unittest.main()
