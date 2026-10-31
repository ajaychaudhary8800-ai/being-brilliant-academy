"""Synthetic-only safety and CLI contract tests for owner-local real-checkpoint restore."""
import contextlib
import hashlib
import importlib.util
import io
from pathlib import Path
import json
import os
import tarfile
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    "owner_isolated_recovery",
    HERE / "schoolos-v5-owner-isolated-checkpoint-restore.py",
)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class IsolatedRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name) / "private-checkpoint"
        self.folder.mkdir()
        (self.folder / "database.dump").write_bytes(
            b"PGDMPsynthetic-not-real-backup"
        )
        with tarfile.open(self.folder / "files.tar.gz", "w:gz") as t:
            b = b"synthetic-file"
            f = tarfile.TarInfo("./synthetic-file.txt")
            f.size = len(b)
            t.addfile(f, io.BytesIO(b))
        checks = []
        for name in ("database.dump", "files.tar.gz"):
            d = hashlib.sha256((self.folder / name).read_bytes()).hexdigest()
            checks.append(d + "  /backups/20261031T073407Z/" + name)
        (self.folder / "SHA256SUMS").write_text(
            "\n".join(checks) + "\n", encoding="ascii"
        )

    def test_docker_command_is_networkless_tmpfs_only_single_read_only_input(self):
        args = runner.build_container_command(
            self.folder, "v5-private-restore-testfixture",
            "synthetic-secret", 512, 256
        )
        self.assertEqual(args[args.index("--network") + 1], "none")
        self.assertIn("--read-only", args)
        self.assertIn("no-new-privileges", args)
        self.assertIn("--pull=never", args)
        self.assertEqual(args.count("--mount"), 1)
        self.assertTrue(args[args.index("--mount") + 1].endswith(
            ",target=/isolated-checkpoint,readonly"))
        self.assertNotIn("type=tmpfs", args)
        for forbidden in ("-p", "--publish", "-v", "--volume", "--privileged"):
            self.assertNotIn(forbidden, args)
        self.assertIn("--tmpfs", args)
        self.assertTrue(any(
            arg.startswith("/var/lib/postgresql/data:") for arg in args
        ))
        self.assertTrue(any(arg.startswith("/isolated-files:") for arg in args))
        self.assertEqual(args[-1], "postgres:16-alpine")

    def test_remote_docker_context_refused(self):
        calls = [
            (0, json.dumps("ssh://remote").encode()),
        ]
        with patch.object(runner, "docker", side_effect=calls):
            with self.assertRaisesRegex(
                runner.RecoveryFailure, "NONLOCAL_DOCKER_CONTEXT_REFUSED"
            ):
                runner.require_local_engine()

    def test_windows_desktop_context_and_cached_image_only(self):
        calls = [
            (0, json.dumps(
                "npipe:////./pipe/dockerDesktopLinuxEngine").encode()),
            (0, b"linux\n"),
            (0, ("sha256:" + "a" * 64).encode()),
        ]
        with patch.object(runner, "docker", side_effect=calls):
            self.assertEqual(
                runner.require_local_engine(), "sha256:" + "a" * 64)

    def test_scrubs_remote_docker_override_variables(self):
        with patch.dict(os.environ, {
            "DOCKER_HOST": "ssh://unsafe.example",
            "DOCKER_TLS_VERIFY": "1",
            "DOCKER_CONTEXT": "remote",
        }, clear=False):
            env = runner.scrub_docker_environment()
        for key in ("DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY",
                    "DOCKER_CERT_PATH", "DOCKER_API_VERSION"):
            self.assertNotIn(key, env)

    def test_broad_and_unc_path_rejected(self):
        with self.assertRaisesRegex(runner.RecoveryFailure, "TOO_BROAD"):
            runner.guarded_checkpoint_path(Path("/"))
        with self.assertRaisesRegex(runner.RecoveryFailure, "REMOTE_CHECKPOINT"):
            runner.guarded_checkpoint_path(Path(r"\\remote\share"))
        self.assertEqual(
            runner.guarded_checkpoint_path(self.folder), self.folder.resolve())

    def test_default_mode_is_read_only_without_any_docker_calls(self):
        report = Path(self.temp.name) / "sanitized-report.json"
        argv = [
            "runner", "--checkpoint-dir", str(self.folder),
            "--checkpoint-id", runner.CHECKPOINT_ID,
            "--report", str(report),
        ]
        with patch("sys.argv", argv), \
             patch.object(runner, "docker") as docker, \
             contextlib.redirect_stdout(io.StringIO()) as out:
            rc = runner.main()
        self.assertEqual(rc, 0)
        docker.assert_not_called()
        payload = json.loads(report.read_text())
        self.assertEqual(payload["restore_mode"], "READ_ONLY_PREFLIGHT")
        self.assertEqual(payload["database_restore"], "NOT_EXECUTED")
        self.assertEqual(payload["deployment_authorization"], "HOLD")
        self.assertIn("REAL_CHECKPOINT_DB_AND_FILES_RESTORE=NOT_EXECUTED",
                      out.getvalue())

    def test_restore_requires_explicit_private_isolate_acknowledgement(self):
        report = Path(self.temp.name) / "denied.json"
        argv = [
            "runner", "--checkpoint-dir", str(self.folder),
            "--checkpoint-id", runner.CHECKPOINT_ID,
            "--report", str(report), "--execute-isolated-restore",
        ]
        with patch("sys.argv", argv), \
             patch.object(runner, "docker") as docker, \
             contextlib.redirect_stdout(io.StringIO()) as out:
            rc = runner.main()
        self.assertEqual(rc, 2)
        docker.assert_not_called()
        self.assertFalse(report.exists())
        self.assertIn("CHECK_REQUIRED_PRIVATE_ISOLATE_ACK_REQUIRED",
                      out.getvalue())

    def test_wrong_checkpoint_id_is_denied_before_data_access(self):
        report = Path(self.temp.name) / "wrong.json"
        argv = [
            "runner", "--checkpoint-dir", str(self.folder),
            "--checkpoint-id", "20260101T000000Z",
            "--report", str(report),
        ]
        with patch("sys.argv", argv), \
             patch.object(runner, "docker") as docker, \
             contextlib.redirect_stdout(io.StringIO()) as out:
            rc = runner.main()
        self.assertEqual(rc, 2)
        docker.assert_not_called()
        self.assertFalse(report.exists())
        self.assertIn("UNEXPECTED_CHECKPOINT_ID", out.getvalue())

    def test_successful_isolated_path_records_no_fabricated_vault_media(self):
        report = Path(self.temp.name) / "accepted.json"
        argv = [
            "runner", "--checkpoint-dir", str(self.folder),
            "--checkpoint-id", runner.CHECKPOINT_ID,
            "--report", str(report), "--execute-isolated-restore",
            "--acknowledge-private-offline-checkpoint",
        ]
        def fake_restore(folder, preflight, db_mb, files_mb):
            self.assertEqual(folder, self.folder.resolve())
            self.assertEqual((db_mb, files_mb), (2048, 1024))
            return {
                **preflight,
                "database_restore": "PASS_ISOLATED_ONLY",
                "files_extraction": "PASS_ISOLATED_ONLY",
                "vault_decryption": "NOT_EXECUTED",
                "media_recovery": "NOT_EXECUTED",
            }
        with patch("sys.argv", argv), \
             patch.object(runner, "restore_in_isolation", fake_restore), \
             contextlib.redirect_stdout(io.StringIO()) as out:
            rc = runner.main()
        self.assertEqual(rc, 0)
        data = json.loads(report.read_text())
        self.assertEqual(data["vault_decryption"], "NOT_EXECUTED")
        self.assertEqual(data["media_recovery"], "NOT_EXECUTED")
        self.assertEqual(data["cleanup"], "PASS")
        self.assertIn("VAULT_AND_MEDIA_RESTORED=NO", out.getvalue())

    def test_disposable_container_cleanup_on_restore_failure(self):
        cid = "b" * 64
        calls = []
        def fake_docker(args, **kwargs):
            calls.append(args)
            if args[0] == "run":
                return 0, cid.encode()
            if args[0] == "rm":
                return 0, b""
            if args[0] == "inspect":
                return 0, json.dumps({
                    "schoolos.recovery.id": args[0] + "-wrong",
                }).encode()
            return 0, b""
        with patch.object(runner, "docker", side_effect=fake_docker), \
             patch.object(runner, "require_local_engine",
                          return_value="sha256:" + "a" * 64), \
             contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(
                runner.RecoveryFailure, "CONTAINER_OWNERSHIP_MISMATCH"
            ):
                runner.restore_in_isolation(self.folder, {}, 1024, 256)
        self.assertTrue(any(a[0] == "rm" and a[-1] == cid for a in calls))


if __name__ == "__main__":
    unittest.main()
