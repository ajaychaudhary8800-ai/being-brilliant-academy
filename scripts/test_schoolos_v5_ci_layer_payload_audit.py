"""Synthetic Docker-save tar/layer fixture only. No real images or credentials."""
import importlib.util
import io
import gzip
import json
from pathlib import Path
import tarfile
import unittest
import contextlib
from types import SimpleNamespace
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "v5_payload_audit",
    Path(__file__).with_name("schoolos-v5-ci-layer-payload-audit.py"),
)
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)

def archive_for(member_name="workspace/apps/web/server.js",
                payload=b"example public source", mode="regular", repeat_layers=1):
    layer = io.BytesIO()
    with tarfile.open(fileobj=layer, mode="w") as tar:
        t = tarfile.TarInfo(member_name)
        t.size = len(payload)
        if mode == "regular":
            tar.addfile(t, io.BytesIO(payload))
        else:
            t.type = tarfile.DIRTYPE
            t.size = 0
            tar.addfile(t)
    nested = layer.getvalue()
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w") as tar:
        for index in range(repeat_layers):
            t = tarfile.TarInfo(f"syntheticlayer{index}/layer.tar")
            t.size = len(nested)
            tar.addfile(t, io.BytesIO(nested))
    output.seek(0)
    return output

def oci_for(member_name="workspace/apps/web/server.js",
            payload=b"harmless fixture", compressed=True):
    layer = io.BytesIO()
    with tarfile.open(fileobj=layer, mode="w") as tar:
        item = tarfile.TarInfo(member_name)
        item.size = len(payload)
        tar.addfile(item, io.BytesIO(payload))
    raw = gzip.compress(layer.getvalue()) if compressed else layer.getvalue()
    outer = io.BytesIO()
    with tarfile.open(fileobj=outer, mode="w") as tar:
        for index, blob in enumerate((
            json.dumps({"schemaVersion": 2, "config": {}}).encode(),
            raw,
        )):
            info = tarfile.TarInfo("blobs/sha256/" + format(index + 1, "064x"))
            info.size = len(blob)
            tar.addfile(info, io.BytesIO(blob))
        index_data = b'{"schemaVersion":2}'
        index_info = tarfile.TarInfo("index.json")
        index_info.size = len(index_data)
        tar.addfile(index_info, io.BytesIO(index_data))
    outer.seek(0)
    return outer


class V5CleanLayerPayloadTests(unittest.TestCase):
    def test_scans_modern_oci_docker_save_with_compressed_layer(self):
        r = AUDIT.audit_layers(oci_for(compressed=True))
        self.assertEqual(r["layers"], 1)
        self.assertEqual(r["oci_layer_blobs"], 1)
        self.assertEqual(r["oci_json_metadata_blobs"], 1)
        self.assertGreater(r["bytes"], 0)

    def test_scans_modern_oci_docker_save_uncompressed_layer(self):
        r = AUDIT.audit_layers(oci_for(compressed=False))
        self.assertEqual(r["layers"], 1)
        self.assertEqual(r["oci_layer_blobs"], 1)

    def test_modern_oci_path_violation_is_rejected(self):
        with self.assertRaisesRegex(
            AUDIT.LayerAuditFailure, "PRIVATE_FILE_IN_IMAGE_LAYER"
        ):
            AUDIT.audit_layers(oci_for("app/owner-checkpoint.dump"))

    def test_scans_genuine_nested_docker_tar_stream(self):
        result = AUDIT.audit_layers(archive_for())
        self.assertEqual(result["layers"], 1)
        self.assertEqual(result["files"], 1)
        self.assertGreater(result["bytes"], 0)

    def test_catches_private_checkpoint_archives_and_env_paths(self):
        for path in [
            "workspace/SchoolOS-V5-Recovery-fake123/private",
            "workspace/apps/web/.env.production",
            "app/owner-vault.dpapi",
            "workspace/image-archive.image-archive.tar.gz",
            "run/secrets/untracked-credential",
        ]:
            with self.subTest(path=path), self.assertRaises(AUDIT.LayerAuditFailure):
                AUDIT.audit_layers(archive_for(path))

    def test_ci_synthetic_credential_canary_is_rejected_without_printing(self):
        with self.assertRaisesRegex(
            AUDIT.LayerAuditFailure, "CI_CREDENTIAL_CANARY_EMBEDDED"
        ):
            AUDIT.audit_layers(archive_for(
                "workspace/app/index.js",
                b"hello\n" + AUDIT.SYNTHETIC_MARKERS[0] + b"\n",
            ))

    def test_ci_credential_canary_crosses_chunk_boundary(self):
        payload = b"x" * (AUDIT.CHUNK - 10) + AUDIT.SYNTHETIC_MARKERS[1]
        with self.assertRaisesRegex(
            AUDIT.LayerAuditFailure, "CI_CREDENTIAL_CANARY_EMBEDDED"
        ):
            AUDIT.audit_layers(archive_for(payload=payload))

    def test_app_private_key_header_is_rejected(self):
        with self.assertRaisesRegex(
            AUDIT.LayerAuditFailure, "APP_SOURCE_PEM_HEADER_FOUND"
        ):
            AUDIT.audit_layers(archive_for(
                "workspace/config/owner-key.dat",
                b"-----BEGIN OPENSSH PRIVATE KEY-----\nFICTIONAL",
            ))

    def test_dependency_fixture_pem_is_marked_for_review(self):
        result = AUDIT.audit_layers(archive_for(
            "workspace/node_modules/safe-test-fixture/file",
            b"-----BEGIN PRIVATE KEY-----\\nFICTIONAL",
        ))
        self.assertEqual(result["dependency_pem_files"], 1)
        self.assertEqual(result["layers"], 1)

    def test_fixture_path_screen_remains_review_required(self):
        result = AUDIT.audit_layers(archive_for(
            "workspace/node_modules/synthetic-package/tests/data/private.pem",
            b"-----BEGIN PRIVATE KEY-----\\nFICTIONAL",
        ))
        self.assertEqual(result["dependency_pem_files"], 1)
        self.assertEqual(result["dependency_pem_fixture_path_candidates"], 1)
        self.assertEqual(result["dependency_pem_nonfixture_path_candidates"], 0)
        self.assertEqual(len(result["dependency_pem_unique_paths"]), 1)

    def test_nonfixture_dependency_path_is_not_falsely_cleared(self):
        result = AUDIT.audit_layers(archive_for(
            "workspace/node_modules/synthetic-package/dist/embedded.pem",
            b"-----BEGIN RSA PRIVATE KEY-----\\nFICTIONAL",
        ))
        self.assertEqual(result["dependency_pem_files"], 1)
        self.assertEqual(result["dependency_pem_fixture_path_candidates"], 0)
        self.assertEqual(result["dependency_pem_nonfixture_path_candidates"], 1)

    def test_duplicate_layer_occurrences_do_not_mean_two_unique_paths(self):
        result = AUDIT.audit_layers(archive_for(
            "workspace/node_modules/synthetic-package/fixtures/private.pem",
            b"-----BEGIN PRIVATE KEY-----\\nFICTIONAL",
            repeat_layers=2,
        ))
        self.assertEqual(result["layers"], 2)
        self.assertEqual(result["dependency_pem_files"], 2)
        self.assertEqual(len(result["dependency_pem_unique_paths"]), 1)
        self.assertEqual(result["dependency_pem_fixture_path_candidates"], 2)

    def test_dependency_package_token_is_stable_redacted_and_name_safe(self):
        pkg = AUDIT.dependency_package_token(
            "workspace/node_modules/.pnpm/some+pkg@1.0.0/node_modules/@public/safe-example/dist/key.pem"
        )
        duplicate = AUDIT.dependency_package_token(
            "workspace/apps/api/node_modules/@public/safe-example/test/cert.js"
        )
        self.assertEqual(pkg, duplicate)
        self.assertRegex(pkg, r"^PKG-[0-9A-F]{16}$")
        self.assertNotIn("safe-example", pkg)
        self.assertNotIn("key.pem", pkg)
        self.assertNotIn("/workspace", pkg)
        self.assertEqual(AUDIT.dependency_package_token(
            "workspace/node_modules/@private"
        ), "PKG-UNKNOWN")
        self.assertEqual(AUDIT.dependency_package_token(
            "workspace/node_modules/unsafe\r\nLEAK/dist/key.js"
        ), "PKG-UNKNOWN")

    def test_dependency_pem_report_contains_only_package_token_not_path(self):
        hidden_path = "workspace/node_modules/fictional-package/dist/customer-private-key.pem"
        fake_stdin = SimpleNamespace(
            buffer=archive_for(hidden_path, b"-----BEGIN PRIVATE KEY-----\\nFICTIONAL"),
            isatty=lambda: False,
        )
        with patch.object(AUDIT.sys, "argv", ["audit", "--docker-save-stdin"]), \
             patch.object(AUDIT.sys, "stdin", fake_stdin), \
             contextlib.redirect_stdout(io.StringIO()) as captured:
            exit_code = AUDIT.main()
        output = captured.getvalue()
        self.assertEqual(exit_code, 0)
        self.assertRegex(output, r"V5_DEPENDENCY_PEM_PACKAGE_TOKENS=PKG-[0-9A-F]{16}")
        self.assertNotIn(hidden_path, output)
        self.assertNotIn("fictional-package", output)
        self.assertNotIn("FICTIONAL", output)
        self.assertIn("DEPENDENCY_REVIEW_PENDING", output)

    def test_strict_promotion_mode_rejects_unreviewed_dependency_pem(self):
        fake_stdin = SimpleNamespace(
            buffer=archive_for(
                "workspace/node_modules/package/dist/private.pem",
                b"-----BEGIN PRIVATE KEY-----\\nFICTIONAL",
            ),
            isatty=lambda: False,
        )
        with patch.object(AUDIT.sys, "argv", ["audit", "--docker-save-stdin",
                                              "--require-no-dependency-pem"]), \
             patch.object(AUDIT.sys, "stdin", fake_stdin), \
             contextlib.redirect_stdout(io.StringIO()) as captured:
            exit_code = AUDIT.main()
        output = captured.getvalue()
        self.assertEqual(exit_code, 2)
        self.assertIn("V5_LAYER_PUBLISH_GATE=FAIL_CLOSED", output)
        self.assertIn("V5_LAYER_AUDIT=BLOCKED_DEPENDENCY_PEM_UNREVIEWED", output)
        self.assertNotIn("private.pem", output)
        self.assertNotIn("FICTIONAL", output)

    def test_strict_promotion_mode_accepts_only_no_pem_bounded_scan(self):
        fake_stdin = SimpleNamespace(buffer=archive_for(), isatty=lambda: False)
        with patch.object(AUDIT.sys, "argv", ["audit", "--docker-save-stdin",
                                              "--require-no-dependency-pem"]), \
             patch.object(AUDIT.sys, "stdin", fake_stdin), \
             contextlib.redirect_stdout(io.StringIO()) as captured:
            exit_code = AUDIT.main()
        self.assertEqual(exit_code, 0)
        self.assertIn("PASS_BOUNDED_CHECKS_NOT_SIGNED_PROVENANCE", captured.getvalue())
        self.assertIn("SOURCE_TO_OCI_SIGNED_PROVENANCE=NOT_ATTESTED", captured.getvalue())

    def test_observational_mode_keeps_dependency_review_pending_without_promotion(self):
        fake_stdin = SimpleNamespace(
            buffer=archive_for(
                "workspace/node_modules/example/fixtures/key.pem",
                b"-----BEGIN RSA PRIVATE KEY-----\\nFICTIONAL",
            ),
            isatty=lambda: False,
        )
        with patch.object(AUDIT.sys, "argv", ["audit", "--docker-save-stdin"]), \
             patch.object(AUDIT.sys, "stdin", fake_stdin), \
             contextlib.redirect_stdout(io.StringIO()) as captured:
            exit_code = AUDIT.main()
        self.assertEqual(exit_code, 0)
        self.assertIn("V5_LAYER_PUBLISH_GATE=NOT_EXECUTED_OBSERVATIONAL_MODE",
                      captured.getvalue())
        self.assertIn("DEPENDENCY_REVIEW_PENDING", captured.getvalue())

    def test_reject_empty_outer_tar_and_directory_traversal(self):
        empty = io.BytesIO()
        with tarfile.open(fileobj=empty, mode="w"):
            pass
        empty.seek(0)
        with self.assertRaises(AUDIT.LayerAuditFailure):
            AUDIT.audit_layers(empty)
        with self.assertRaises(AUDIT.LayerAuditFailure):
            AUDIT.audit_layers(archive_for("../outside/file"))

    def test_error_contains_no_sensitive_member_content(self):
        private_data = b"private-only-synthetic-fixture"
        try:
            AUDIT.audit_layers(archive_for(
                "workspace/.env.local", private_data
            ))
            self.fail("expected veto")
        except AUDIT.LayerAuditFailure as err:
            self.assertNotIn(private_data.decode(), str(err))
            self.assertNotIn(".env.local", str(err))

if __name__ == "__main__":
    unittest.main()
