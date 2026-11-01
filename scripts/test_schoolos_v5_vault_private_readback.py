"""Only synthetic fixtures. Test path guards, no-value outputs and cleanup."""
import contextlib
import hashlib
import importlib.util
import io
from pathlib import Path
from unittest.mock import patch
import tempfile
import types
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    "v5_private_vault_readback",
    HERE / "schoolos-v5-vault-private-readback.py",
)
MODULE = importlib.util.module_from_spec(spec)
spec.loader.exec_module(MODULE)


class VaultOfflineReadbackTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.base = Path(tmp.name) / "SchoolOS-V5-Recovery-synthetic"
        self.checkpoint = self.base / MODULE.BASE.CHECKPOINT_ID
        self.checkpoint.mkdir(parents=True)
        self.escrow = self.base / "protected-escrow" / "original-vault-key.txt"
        self.escrow.parent.mkdir()
        self.escrow.write_text("synthetic-private-material-only-at-least-32-char")
        self.preflight = {
            "manifest_checksums": "PASS",
            "origin_manifest_authenticity": "NOT_ATTESTED",
        }

    def test_escrow_path_must_be_private_expected_location(self):
        with patch.object(MODULE.sys, "platform", "win32"):
            self.assertEqual(
                MODULE.protected_local_escrow(self.escrow, self.checkpoint),
                self.escrow.resolve(),
            )
            other = self.base / "outside.txt"
            other.write_text("x" * 64)
            with self.assertRaisesRegex(
                MODULE.BASE.RecoveryFailure,
                "ESCROW_OUTSIDE_RESTRICTED_WORKSPACE"
            ):
                MODULE.protected_local_escrow(other, self.checkpoint)

    def test_symlink_escrow_refused(self):
        link = self.base / "protected-escrow" / "original-vault-key.txt"
        link.unlink()
        link.symlink_to(self.base / "source-key.txt")
        with patch.object(MODULE.sys, "platform", "win32"):
            with self.assertRaisesRegex(
                MODULE.BASE.RecoveryFailure,
                "ESCROW_FILE_NOT_FOUND_OR_LINKED"
            ):
                MODULE.protected_local_escrow(link, self.checkpoint)

    def test_private_ciphertext_is_not_logged_and_exact_one_only(self):
        sample = (b"CDV1" + b"0" * 12 + b"1" * 16 + b"x")
        line = sample.hex() + "|" + "a" * 64 + "|1\n"
        with patch.object(MODULE.BASE, "pg_scalar", side_effect=[1, 0]), \
             patch.object(MODULE.subprocess, "run",
                          return_value=types.SimpleNamespace(
                              returncode=0, stdout=line.encode("ascii")
                          )) as run, \
             contextlib.redirect_stdout(io.StringIO()) as output:
            result = MODULE.read_private_ciphertext("a" * 64)
        self.assertEqual(result["fileSize"], 1)
        self.assertEqual(result["cipherHex"], sample.hex())
        self.assertEqual(output.getvalue(), "")
        args = run.call_args.args[0]
        self.assertEqual(args[0:3], ["docker", "--context", "desktop-linux"])
        self.assertIn('FROM "SaaSCommercialDocument" LIMIT 1', args[-1])
        self.assertNotIn("root@", " ".join(args))
        with patch.object(MODULE.BASE, "pg_scalar", return_value=2):
            with self.assertRaisesRegex(
                MODULE.BASE.RecoveryFailure,
                "VAULT_DOCUMENT_COUNT_NOT_EXACTLY_ONE",
            ):
                MODULE.read_private_ciphertext("a" * 64)

    def test_recovery_is_disposable_one_table_only_and_never_reports_values(self):
        cid = "c" * 64
        events = []
        packed = (b"CDV1" + b"0" * 12 + b"1" * 16 + b"x")
        private_payload = {
            "cipherHex": packed.hex(),
            "expectedSha256": "a" * 64,
            "fileSize": 1,
        }

        def fake_docker(args, **_):
            events.append(args)
            if args[0] == "run":
                return 0, cid.encode()
            if args[0] == "exec" and "sha256sum" in args:
                basename = args[-1].rsplit("/", 1)[-1]
                return 0, (
                    hashlib.sha256((self.checkpoint / basename).read_bytes())
                    .hexdigest() + "  /isolated-checkpoint/" + basename
                ).encode()
            return 0, b""

        (self.checkpoint / "database.dump").write_bytes(b"synthetic-only")
        (self.checkpoint / "files.tar.gz").write_bytes(b"synthetic-only")

        with patch.object(MODULE.BASE, "require_local_engine",
                          return_value="sha256:" + "f" * 64), \
             patch.object(MODULE.BASE, "docker", side_effect=fake_docker), \
             patch.object(MODULE.BASE, "verify_container_identity"), \
             patch.object(MODULE.BASE, "wait_for_isolated_pg"), \
             patch.object(MODULE, "read_private_ciphertext",
                          return_value=private_payload), \
             patch.object(MODULE, "run_local_crypto") as crypto_call, \
             contextlib.redirect_stdout(io.StringIO()) as output:
            result = MODULE.restore_and_verify(
                self.checkpoint, self.escrow, self.preflight
            )

        self.assertEqual(
            result["vault_decryption"],
            "PASS_GCM_TAG_AND_PLAINTEXT_SHA256",
        )
        self.assertEqual(
            result["original_key_provenance"], "NOT_ATTESTED"
        )
        self.assertFalse(result["plaintext_stored_or_printed"])
        self.assertEqual(result["r2_media_recovery"], "NOT_EXECUTED")
        crypto_call.assert_called_once_with(private_payload, self.escrow)
        events_run = [e for e in events if e[0] == "run"]
        self.assertEqual(len(events_run), 1)
        self.assertEqual(
            events_run[0][events_run[0].index("--network") + 1], "none"
        )
        self.assertEqual(len([
            e for e in events if e[0] == "exec" and "pg_restore" in e
        ]), 2)
        self.assertEqual(len([
            e for e in events if e[0] == "exec"
            and "--data-only" in e
            and "--table=SaaSCommercialDocument" in e
        ]), 1)
        self.assertTrue(any(e[0] == "rm" for e in events))
        printed = output.getvalue()
        self.assertNotIn(private_payload["cipherHex"], printed)
        self.assertNotIn(private_payload["expectedSha256"], printed)
        self.assertNotIn("synthetic-private-material", printed)
        self.assertIn("VAULT_OFFLINE_ISOLATE_CLEANUP=PASS", printed)

    def test_crypto_failure_still_cleans_isolate(self):
        cid = "c" * 64
        operations = []
        for filename in ("database.dump", "files.tar.gz"):
            (self.checkpoint / filename).write_bytes(b"synthetic")
        def fake_docker(args, **_):
            operations.append(args)
            if args[0] == "run":
                return 0, cid.encode()
            if args[0] == "exec" and "sha256sum" in args:
                name = args[-1].rsplit("/", 1)[-1]
                digest = hashlib.sha256(
                    (self.checkpoint / name).read_bytes()
                ).hexdigest()
                return 0, (digest + "  fake").encode()
            return 0, b""
        with patch.object(MODULE.BASE, "require_local_engine",
                          return_value="sha256:" + "f" * 64), \
             patch.object(MODULE.BASE, "docker", side_effect=fake_docker), \
             patch.object(MODULE.BASE, "verify_container_identity"), \
             patch.object(MODULE.BASE, "wait_for_isolated_pg"), \
             patch.object(MODULE, "read_private_ciphertext",
                          return_value={"cipherHex": "ab",
                                        "expectedSha256": "a" * 64,
                                        "fileSize": 1}), \
             patch.object(MODULE, "run_local_crypto",
                          side_effect=MODULE.BASE.RecoveryFailure(
                              "AUTHENTICATED_DECRYPTION_OR_DIGEST_FAILED"
                          )), \
             contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(
                MODULE.BASE.RecoveryFailure, "AUTHENTICATED_DECRYPTION"
            ):
                MODULE.restore_and_verify(
                    self.checkpoint, self.escrow, self.preflight
                )
        self.assertTrue(any(op[0] == "rm" for op in operations))


if __name__ == "__main__":
    unittest.main()
