"""Synthetic-only tests: never load real backup, credentials or Vault bytes."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    "private_vault_media_scope",
    HERE / "schoolos-v5-vault-media-private-scope.py",
)
SCOPE = importlib.util.module_from_spec(spec)
spec.loader.exec_module(SCOPE)


class VaultMediaPrivateScopeTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.checkpoint = self.root / "private-checkpoint"
        self.checkpoint.mkdir()
        (self.checkpoint / "database.dump").write_bytes(
            b"PGDMPsynthetic-only-header"
        )
        with tarfile.open(self.checkpoint / "files.tar.gz", "w:gz") as archive:
            file = tarfile.TarInfo("./")
            file.type = tarfile.DIRTYPE
            archive.addfile(file)
        rows = []
        for name in ("database.dump", "files.tar.gz"):
            h = hashlib.sha256((self.checkpoint / name).read_bytes()).hexdigest()
            rows.append(h + "  /backups/20261031T073407Z/" + name)
        (self.checkpoint / "SHA256SUMS").write_text(
            "\n".join(rows) + "\n", encoding="ascii"
        )

    def test_only_five_pinned_tables_selected(self):
        self.assertEqual(SCOPE.VAULT_AND_MEDIA_TABLES, (
            "SaaSCommercialDocument", "LiveClass", "StudyMaterial",
            "MeetingRecording", "MeetingAttachment",
        ))

    def test_aggregate_queries_do_not_return_content(self):
        for field in SCOPE.COUNT_SQL:
            sql = SCOPE.validated_count_query(field)
            self.assertTrue(sql.lstrip().lower().startswith("select count(*)"))
            self.assertNotIn(";", sql)
            self.assertNotIn("SELECT *", sql.upper())
            for forbidden in (
                "encryptedFileData as", "storageKey as",
                "recordingObjectKey as", "fileName as", "contentSha256 as"
            ):
                self.assertNotIn(forbidden.lower(), sql.lower())
        with patch.dict(SCOPE.COUNT_SQL, {"bad": 'SELECT "encryptedFileData" FROM "SaaSCommercialDocument"'}):
            with self.assertRaisesRegex(
                SCOPE.BASE.RecoveryFailure, "NON_AGGREGATE_QUERY_REFUSED"
            ):
                SCOPE.validated_count_query("bad")

    def run_mocked_isolate(self, counts):
        cid = "a" * 64
        events = []
        def fake_docker(args, **_):
            events.append(args)
            if args[0] == "run":
                return 0, cid.encode()
            return 0, b""
        def fake_pg_scalar(container, sql):
            self.assertEqual(container, cid)
            for label in SCOPE.COUNT_SQL:
                if SCOPE.COUNT_SQL[label] == sql:
                    return counts.get(label, 0)
            raise AssertionError("unexpected SQL: content not printed")
        with patch.object(SCOPE.BASE, "require_local_engine",
                          return_value="sha256:" + "f" * 64), \
             patch.object(SCOPE.BASE, "docker",
                          side_effect=fake_docker), \
             patch.object(SCOPE.BASE, "verify_container_identity"), \
             patch.object(SCOPE.BASE, "wait_for_isolated_pg"), \
             patch.object(SCOPE.BASE, "pg_scalar",
                          side_effect=fake_pg_scalar), \
             contextlib.redirect_stdout(io.StringIO()) as output:
            result = SCOPE.run_owner_isolated_scope(
                self.checkpoint,
                {"manifest_checksums": "PASS",
                 "origin_manifest_authenticity": "NOT_ATTESTED"},
            )
        return result, events, output.getvalue()

    def test_scoped_metadata_inventory_no_media_or_keys_queried(self):
        result, commands, output = self.run_mocked_isolate({
            "vault_document_rows": 2,
            "vault_ciphertext_header_invalid": 0,
            "liveclass_rows": 5,
            "liveclass_recording_object_references": 2,
            "liveclass_egress_references": 1,
            "liveclass_recording_url_references": 1,
            "study_material_rows": 4,
            "study_material_external_storage_references": 1,
            "study_material_inline_file_rows": 2,
            "meeting_recording_rows": 1,
            "meeting_recording_external_storage_references": 1,
            "meeting_attachment_external_storage_references": 1,
        })
        self.assertEqual(result["vault_document_rows"], 2)
        self.assertEqual(result["vault_ciphertext_header_check"], "PASS_HEADER_ONLY")
        self.assertEqual(result["vault_decryption"], "NOT_EXECUTED")
        self.assertEqual(result["vault_key_custody"], "NOT_VERIFIED")
        self.assertEqual(result["external_media_reference_presence"], "YES")
        self.assertEqual(result["r2_head_and_playback"], "NOT_EXECUTED")
        self.assertEqual(result["commercial_go"], "HOLD")
        self.assertNotIn("key", output.lower())
        self.assertNotIn("password", output.lower())
        self.assertEqual(len([c for c in commands
                              if c[0] == "exec" and "pg_restore" in c]), 5)
        runs = [c for c in commands if c[0] == "run"]
        self.assertEqual(len(runs), 1)
        args = runs[0]
        self.assertEqual(args[args.index("--network") + 1], "none")
        self.assertEqual(args.count("--mount"), 1)
        self.assertIn("--read-only", args)
        self.assertIn("--pull=never", args)
        self.assertNotIn("--publish", args)
        self.assertNotIn("--privileged", args)
        self.assertTrue(any(c[0] == "rm" for c in commands))

    def test_empty_checkpoint_has_no_references_but_not_a_signed_NA(self):
        result, _events, _output = self.run_mocked_isolate({})
        self.assertEqual(result["vault_document_rows"], 0)
        self.assertEqual(result["vault_key_custody"], "NOT_VERIFIED")
        self.assertEqual(result["vault_decryption"], "NOT_EXECUTED")
        self.assertEqual(result["external_media_reference_presence"],
                         "NO_DB_REFERENCE_FOUND")
        self.assertEqual(result["media_scope_final_signoff"], "PENDING")

    def test_invalid_vault_aggregate_aborts_cleanup(self):
        calls = []
        cid = "a" * 64
        def fake_docker(args, **_):
            calls.append(args)
            return 0, cid.encode() if args[0] == "run" else b""
        def fake_pg_scalar(_cid, sql):
            if "octet_length" in sql:
                return 3
            if '"SaaSCommercialDocument"' in sql:
                return 1
            return 0
        with patch.object(SCOPE.BASE, "require_local_engine",
                          return_value="sha256:" + "f" * 64), \
             patch.object(SCOPE.BASE, "docker",
                          side_effect=fake_docker), \
             patch.object(SCOPE.BASE, "verify_container_identity"), \
             patch.object(SCOPE.BASE, "wait_for_isolated_pg"), \
             patch.object(SCOPE.BASE, "pg_scalar",
                          side_effect=fake_pg_scalar), \
             contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(
                SCOPE.BASE.RecoveryFailure, "IMPOSSIBLE_VAULT_AGGREGATES"
            ):
                SCOPE.run_owner_isolated_scope(self.checkpoint, {
                    "manifest_checksums": "PASS",
                    "origin_manifest_authenticity": "NOT_ATTESTED",
                })
        self.assertTrue(any(c[0] == "rm" for c in calls))

    def test_acknowledgement_and_exact_checkpoint_id_are_mandatory(self):
        for args, expected in [
            ([], "OWNER_PRIVATE_ISOLATE_ACK_REQUIRED"),
            (["--acknowledge-private-offline-checkpoint"],
             "CHECKPOINT_ID_MISMATCH"),
        ]:
            report = self.root / "summary.json"
            argv = [
                "scope",
                "--checkpoint-dir", str(self.checkpoint),
                "--checkpoint-id",
                "20261031T073407Z" if not args else "20240101T000000Z",
                "--report", str(report),
                *args,
            ]
            with patch("sys.argv", argv), \
                 patch.object(SCOPE.BASE, "docker") as mocked_docker, \
                 contextlib.redirect_stdout(io.StringIO()) as output:
                rc = SCOPE.main()
            self.assertEqual(rc, 2)
            mocked_docker.assert_not_called()
            self.assertIn(expected, output.getvalue())
            self.assertFalse(report.exists())

    def test_report_inside_checkpoint_is_refused(self):
        report = self.checkpoint / "status.json"
        argv = [
            "scope", "--checkpoint-dir", str(self.checkpoint),
            "--checkpoint-id", SCOPE.CHECKPOINT_ID,
            "--report", str(report),
            "--acknowledge-private-offline-checkpoint",
        ]
        with patch("sys.argv", argv), \
             patch.object(SCOPE.BASE, "docker") as mock_docker, \
             contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(SCOPE.main(), 2)
        self.assertFalse(report.exists())
        mock_docker.assert_not_called()


if __name__ == "__main__":
    unittest.main()
