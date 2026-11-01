"""Synthetic-only Docker-save config (no real image tar/layer data)."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "private_image_archive_audit",
    Path(__file__).with_name("schoolos-v5-private-archive-secret-audit.py"),
)
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)


def make_archive(file, config, config_name="a" * 64 + ".json"):
    rawconfig = json.dumps(config).encode()
    rawmanifest = json.dumps([{"Config": config_name}]).encode()
    with tarfile.open(file, "w") as tar:
        for name, data in (
            ("manifest.json", rawmanifest),
            (config_name, rawconfig),
        ):
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))


class V5ArchivedImageAuditTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.archive = Path(tmp.name) / "synthetic-only.tar"

    def sample(self):
        return {
            "history": [{"created_by": "RUN /bin/sh -c pnpm build"}],
            "config": {
                "Env": ["NODE_ENV=production"],
                "Labels": {"org.opencontainers.image.revision": "a" * 40},
            },
        }

    def test_clean_config_has_no_marker(self):
        make_archive(self.archive, self.sample())
        r = AUDIT.inspect_docker_archive(self.archive)
        self.assertEqual(r["images_inspected"], 1)
        self.assertEqual(r["sensitive_metadata_names"], [])
        self.assertFalse(r["vault_key_name_in_metadata"])

    def test_injected_builder_history_secret_names_detected_without_values(self):
        config = self.sample()
        config["history"][0]["created_by"] = (
            "RUN |57 DATABASE_URL=postgresql://user:private-password@db/v5 "
            "POSTGRES_PASSWORD=private-password "
            "REDIS_PASSWORD=private-redis "
            "COMMERCIAL_DOCUMENT_ENCRYPTION_KEY=private-vault "
            "/bin/sh -c pnpm build"
        )
        make_archive(self.archive, config)
        r = AUDIT.inspect_docker_archive(self.archive)
        self.assertEqual(r["images_inspected"], 1)
        self.assertEqual(r["sensitive_metadata_names"], [
            "COMMERCIAL_DOCUMENT_ENCRYPTION_KEY", "DATABASE_URL",
            "POSTGRES_PASSWORD", "REDIS_PASSWORD",
        ])
        self.assertTrue(r["vault_key_name_in_metadata"])
        self.assertNotIn("private-password", str(r))
        self.assertNotIn("private-redis", str(r))
        self.assertNotIn("private-vault", str(r))

    def test_sensitive_env_and_labels_vetoed(self):
        config = self.sample()
        config["config"]["Env"].append("JWT_ACCESS_SECRET=private-jwt")
        config["config"]["Labels"]["secret"] = "SMTP_PASSWORD=private-mail"
        make_archive(self.archive, config)
        r = AUDIT.inspect_docker_archive(self.archive)
        self.assertEqual(
            r["sensitive_metadata_names"],
            ["JWT_ACCESS_SECRET", "SMTP_PASSWORD"],
        )

    def test_bad_manifest_paths_are_not_extracted(self):
        make_archive(self.archive, self.sample(), "../secret.json")
        with self.assertRaises(AUDIT.UnsafeMetadata):
            AUDIT.inspect_docker_archive(self.archive)

    def test_main_is_windows_owner_local_only_without_secret_echo(self):
        make_archive(self.archive, self.sample())
        with patch.object(AUDIT.sys, "platform", "linux"), \
             patch("sys.argv", [
                 "audit", "--archive", str(self.archive),
             ]), \
             contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(AUDIT.main(), 2)
        self.assertIn("IMAGE_ARCHIVE_CONFIG_AUDIT=CHECK_REQUIRED", out.getvalue())
        self.assertNotIn(str(self.archive), out.getvalue())


if __name__ == "__main__":
    unittest.main()
