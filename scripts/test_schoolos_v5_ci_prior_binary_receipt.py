"""Synthetic-only tests for source-pinned previous binary receipt (no Docker needed)."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "v5_prior_receipt",
    HERE / "schoolos-v5-ci-prior-binary-receipt.py",
)
mod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mod)

PREVIOUS = mod.OLDER
CANDIDATE = "f" * 40
API = "sha256:" + "a" * 64
WEB = "sha256:" + "b" * 64
LAYER = "sha256:" + "c" * 64

def fake_run(args, **kwargs):
    if args[0:3] != ["docker", "image", "inspect"]:
        raise AssertionError("unexpected Docker command")
    if args[4] != "--format":
        raise AssertionError("unexpected inspect format")
    image = args[3]
    fmt = args[5]
    if image not in mod.ROLES.values():
        raise AssertionError("unexpected image")
    if fmt == "{{.Id}}":
        output = API if "api" in image else WEB
    elif "org.opencontainers.image.revision" in fmt:
        output = PREVIOUS
    elif fmt == "{{json .RootFS.Layers}}":
        output = json.dumps([LAYER])
    else:
        raise AssertionError("image env/history was queried")
    return subprocess.CompletedProcess(args, 0, output + "\n", "")

class PriorReceiptTests(unittest.TestCase):
    def test_known_previous_source_and_unique_roles(self):
        with patch.object(mod.subprocess, "run", side_effect=fake_run):
            result = mod.create_receipt(CANDIDATE)
        self.assertEqual(result["previous_source_sha"], PREVIOUS)
        self.assertEqual(result["image_observations"]["api"]["config_id"], API)
        self.assertEqual(result["image_observations"]["web"]["config_id"], WEB)
        self.assertEqual(result["immutable_artifact_custody"], "NOT_ESTABLISHED")
        self.assertNotIn("password", json.dumps(result).lower())
        self.assertEqual(result["deployment_authorization"], "HOLD")

    def test_bad_revision_is_denied(self):
        def fake_wrong(args, **kwargs):
            r = fake_run(args, **kwargs)
            if "revision" in args[5]:
                return subprocess.CompletedProcess(args, 0, CANDIDATE, "")
            return r
        with patch.object(mod.subprocess, "run", side_effect=fake_wrong):
            with self.assertRaises(mod.InvalidReceipt):
                mod.create_receipt(CANDIDATE)

    def test_same_source_and_invalid_sha_fail_closed(self):
        with self.assertRaises(mod.InvalidReceipt):
            mod.create_receipt(PREVIOUS)
        with self.assertRaises(mod.InvalidReceipt):
            mod.create_receipt("untrusted")

    def test_non_ci_cannot_write_anything(self):
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / "receipt.json"
            with patch.dict(os.environ, {"GITHUB_ACTIONS": "false", "RUNNER_TEMP": temp}):
                with contextlib.redirect_stdout(io.StringIO()) as out:
                    rc = mod.main(["--out", str(target), "--controls-sha", CANDIDATE])
            self.assertEqual(rc, 2)
            self.assertFalse(target.exists())
            self.assertIn("CHECK_REQUIRED", out.getvalue())

    def test_synthetic_ci_receipt_is_private_and_exclusive(self):
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / "receipt.json"
            with patch.dict(os.environ, {"GITHUB_ACTIONS": "true", "RUNNER_TEMP": temp}):
                with patch.object(mod.subprocess, "run", side_effect=fake_run):
                    with contextlib.redirect_stdout(io.StringIO()) as out:
                        rc = mod.main(["--out", str(target), "--controls-sha", CANDIDATE])
                    self.assertEqual(rc, 0)
                    self.assertIn("PASS_METADATA_ONLY", out.getvalue())
                    self.assertTrue(target.is_file())
                    data = json.loads(target.read_text())
                    self.assertEqual(data["registry_manifest_digest"], "NOT_OBSERVED")
                    with contextlib.redirect_stdout(io.StringIO()):
                        self.assertEqual(
                            mod.main(["--out", str(target), "--controls-sha", CANDIDATE]), 2
                        )

if __name__ == "__main__":
    unittest.main()
