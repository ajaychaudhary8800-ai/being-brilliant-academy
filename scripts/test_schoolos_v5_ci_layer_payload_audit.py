"""Synthetic Docker-save tar/layer fixture only. No real images or credentials."""
import importlib.util
import io
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

class V5CleanLayerPayloadTests(unittest.TestCase):
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
            AUDIT.LayerAuditFailure, "APP_PRIVATE_KEY_HEADER_EMBEDDED"
        ):
            AUDIT.audit_layers(archive_for(
                "workspace/config/owner-key.dat",
                b"-----BEGIN OPENSSH PRIVATE KEY-----\nFICTIONAL",
            ))

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
