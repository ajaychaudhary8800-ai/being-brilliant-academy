"""Synthetic OCI archive tests for UNSIGNED previous-source manifest draft."""
from __future__ import annotations

import gzip
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

SCRIPT = Path(__file__).with_name("schoolos-v5-prior-oci-candidate-manifest.py")
spec = importlib.util.spec_from_file_location("prior_candidate_receipt", SCRIPT)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def canonical(value):
    return json.dumps(value, separators=(",", ":"), sort_keys=True).encode()


def descriptor(payload, kind):
    return {"digest": "sha256:" + hashlib.sha256(payload).hexdigest(),
            "mediaType": kind, "size": len(payload)}


def archive(role, *, label=None, gzip_layer=False, bad_diff=False,
            extra_index=False, orphan=False, bad_layer=False,
            include_secret_metadata=False):
    layer_payload = (f"prior-{role}-synthetic-layer").encode()
    compressed = gzip.compress(layer_payload, mtime=0) if gzip_layer else layer_payload
    diffid = "sha256:" + hashlib.sha256(layer_payload).hexdigest()
    if bad_diff:
        diffid = "sha256:" + "f" * 64
    config = {"os": "linux", "architecture": "amd64",
              "rootfs": {"type": "layers", "diff_ids": [diffid]},
              "config": {"Labels": {"org.opencontainers.image.revision":
                                    label or mod.OLDER}}}
    if include_secret_metadata:
        config["history"] = [{"created_by": "POSTGRES_PASSWORD=synthetic-but-unsafe"}]
    c = canonical(config)
    cd = descriptor(c, "application/vnd.oci.image.config.v1+json")
    lm = ("application/vnd.oci.image.layer.v1.tar+gzip" if gzip_layer
          else "application/vnd.oci.image.layer.v1.tar")
    ld = descriptor(compressed, lm)
    manifest = canonical({"schemaVersion": 2,
                          "mediaType": "application/vnd.oci.image.manifest.v1+json",
                          "config": cd, "layers": [ld]})
    md = descriptor(manifest, "application/vnd.oci.image.manifest.v1+json")
    descriptions = [md]
    if extra_index:
        descriptions.append(md)
    idx = canonical({"schemaVersion": 2, "manifests": descriptions})
    members = [
        ("oci-layout", canonical({"imageLayoutVersion": "1.0.0"})),
        ("index.json", idx),
        ("blobs/sha256/" + md["digest"].split(":")[1], manifest),
        ("blobs/sha256/" + cd["digest"].split(":")[1], c),
        ("blobs/sha256/" + ld["digest"].split(":")[1],
         compressed + (b"x" if bad_layer else b"")),
    ]
    if orphan:
        secret = b"unreviewed extra blob"
        members.append(("blobs/sha256/" + hashlib.sha256(secret).hexdigest(), secret))
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w") as tar:
        for name, payload in members:
            info = tarfile.TarInfo(name)
            info.size = len(payload)
            tar.addfile(info, io.BytesIO(payload))
    return output.getvalue(), md["digest"]


class CandidateReceiptTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="v5-prior-oci-test-")
        self.addCleanup(self.temp.cleanup)
        self.dir = Path(self.temp.name)
        self.api = self.dir / "api.oci.tar"
        self.web = self.dir / "web.oci.tar"
        self.api.write_bytes(archive("api")[0])
        self.web.write_bytes(archive("web", gzip_layer=True)[0])

    def test_valid_two_distinct_prior_archives(self):
        payload = mod.candidate_receipt(self.api, self.web)
        self.assertEqual(payload["sourceSha"], mod.OLDER)
        self.assertEqual(payload["schema"], "schoolos-v5-private-rollback-readback-v1")
        self.assertEqual(payload["api"]["sizeBytes"], self.api.stat().st_size)
        self.assertEqual(payload["web"]["sha256"], hashlib.sha256(self.web.read_bytes()).hexdigest())
        self.assertEqual(payload["api"]["key"], f"v5-rollback/{mod.OLDER}/api.oci.tar")
        self.assertNotEqual(payload["api"]["ociManifestDigest"], payload["web"]["ociManifestDigest"])

    def test_valid_gzip_rootfs_diffid_is_recomputed(self):
        record = mod._candidate(self.web)
        self.assertTrue(record["oci_manifest"].startswith("sha256:"))

    def test_sensitive_build_history_assignment_rejected(self):
        self.api.write_bytes(archive("api", include_secret_metadata=True)[0])
        with self.assertRaises(mod.Hold):
            mod.candidate_receipt(self.api, self.web)

    def test_sensitive_runtime_env_assignment_rejected(self):
        with self.assertRaises(mod.Hold):
            mod._reject_sensitive_config({
                "config": {"Env": ["DATABASE_URL=masked-test-value"]},
                "history": [],
            })

    def test_sensitive_image_label_assignment_rejected(self):
        with self.assertRaises(mod.Hold):
            mod._reject_sensitive_config({
                "config": {"Labels": {"REDIS_PASSWORD": "masked-test-value"}},
                "history": [],
            })

    def test_non_secret_build_revision_label_allowed(self):
        mod._reject_sensitive_config({
            "config": {"Env": ["NODE_ENV=production"],
                       "Labels": {"org.opencontainers.image.revision": mod.OLDER}},
            "history": [{"created_by": "RUN pnpm install --frozen-lockfile"}],
        })

    def test_source_revision_mismatch_rejected(self):
        self.api.write_bytes(archive("api", label="a" * 40)[0])
        with self.assertRaises(mod.Hold):
            mod.candidate_receipt(self.api, self.web)

    def test_wrong_expected_previous_revision_rejected(self):
        with self.assertRaises(mod.Hold):
            mod._candidate(self.api, source="b" * 40)

    def test_digest_mismatch_in_layer_rejected(self):
        self.api.write_bytes(archive("api", bad_layer=True)[0])
        with self.assertRaises(mod.Hold):
            mod.candidate_receipt(self.api, self.web)

    def test_uncompressed_diffid_mismatch_rejected(self):
        self.api.write_bytes(archive("api", bad_diff=True)[0])
        with self.assertRaises(mod.Hold):
            mod.candidate_receipt(self.api, self.web)

    def test_extra_unreferenced_blob_rejected(self):
        self.api.write_bytes(archive("api", orphan=True)[0])
        with self.assertRaises(mod.Hold):
            mod.candidate_receipt(self.api, self.web)

    def test_more_than_one_oci_index_descriptor_rejected(self):
        self.web.write_bytes(archive("web", extra_index=True)[0])
        with self.assertRaises(mod.Hold):
            mod.candidate_receipt(self.api, self.web)

    def test_non_oci_tar_rejected(self):
        self.api.write_bytes(b"synthetic wrong format, not OCI")
        with self.assertRaises(mod.Hold):
            mod.candidate_receipt(self.api, self.web)

    def test_symlink_archive_rejected(self):
        alias = self.dir / "alias.tar"
        alias.symlink_to(self.api)
        with self.assertRaises(mod.Hold):
            mod.candidate_receipt(alias, self.web)

    def test_same_archive_path_cannot_be_both_roles(self):
        with self.assertRaises(mod.Hold):
            mod.candidate_receipt(self.api, self.api)

    def test_same_contents_in_different_files_refused(self):
        self.web.write_bytes(self.api.read_bytes())
        with self.assertRaises(mod.Hold):
            mod.candidate_receipt(self.api, self.web)

    def test_private_receipt_written_only_new_in_runner_temp(self):
        payload = mod.candidate_receipt(self.api, self.web)
        dest = self.dir / "receipt.json"
        mod.write_new_receipt(payload, dest, temp_root=self.dir)
        self.assertEqual(json.loads(dest.read_text()), payload)
        self.assertEqual(dest.stat().st_mode & 0o777, 0o600)
        with self.assertRaises(mod.Hold):
            mod.write_new_receipt(payload, dest, temp_root=self.dir)

    def test_output_outside_private_runner_temp_rejected(self):
        payload = mod.candidate_receipt(self.api, self.web)
        outside = self.dir.parent / "unsafe.json"
        with self.assertRaises(mod.Hold):
            mod.write_new_receipt(payload, outside, temp_root=self.dir)
        self.assertFalse(outside.exists())

    def test_symlink_receipt_target_refused_without_overwrite(self):
        payload = mod.candidate_receipt(self.api, self.web)
        protected = self.dir / "safekeep"
        protected.write_text("DO-NOT-MODIFY")
        alias = self.dir / "receipt.json"
        alias.symlink_to(protected)
        with self.assertRaises(mod.Hold):
            mod.write_new_receipt(payload, alias, temp_root=self.dir)
        self.assertEqual(protected.read_text(), "DO-NOT-MODIFY")

    def test_main_has_no_signing_or_upload_and_fails_without_runner_temp(self):
        dest = self.dir / "private-receipt.json"
        with patch.dict(os.environ, {"RUNNER_TEMP": ""}):
            self.assertEqual(mod.main([
                "--api", str(self.api), "--web", str(self.web), "--out", str(dest)
            ]), 2)
        self.assertFalse(dest.exists())


if __name__ == "__main__":
    unittest.main()
