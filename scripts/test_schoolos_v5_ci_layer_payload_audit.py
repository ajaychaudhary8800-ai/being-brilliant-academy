"""Synthetic Docker-save tar/layer fixture only. No real images or credentials."""
import importlib.util
import io
import gzip
import json
from pathlib import Path
import tarfile
import unittest

SPEC = importlib.util.spec_from_file_location(
    "v5_payload_audit",
    Path(__file__).with_name("schoolos-v5-ci-layer-payload-audit.py"),
)
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)

def archive_for(member_name="workspace/apps/web/server.js",
                payload=b"example public source", mode="regular"):
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
        t = tarfile.TarInfo("syntheticlayer/layer.tar")
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
