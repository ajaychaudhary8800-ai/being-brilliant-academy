"""Synthetic-only owner-offline signing tests; no owner keys, images, or R2."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

BASE = Path(__file__).parent


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, BASE / filename)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


signer = module("v5_custody_signer", "schoolos-v5-private-custody-offline-sign.py")
helper = module("v5_custody_synthetic_oci", "test_schoolos_v5_prior_oci_candidate_manifest.py")
readback = module("v5_custody_readback", "schoolos-v5-private-r2-signed-readback.py")


class PrivateCustodyOfflineSignTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="v5-offline-sign-synthetic-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.out = self.root / "private-out"
        self.out.mkdir(mode=0o700)
        self.out.chmod(0o700)
        self.api = self.root / "api.oci.tar"
        self.web = self.root / "web.oci.tar"
        self.api.write_bytes(helper.archive("api")[0])
        self.web.write_bytes(helper.archive("web", gzip_layer=True)[0])
        self.private = self.root / "private-key.pem"
        self.public = self.root / "public-key.pem"
        self._genkey(self.private, self.public)
        self.private.chmod(0o600)
        self.pin = hashlib.sha256(self.public.read_bytes()).hexdigest()

    def _genkey(self, key, pub):
        subprocess.run(["openssl", "genpkey", "-algorithm", "RSA",
                        "-pkeyopt", "rsa_keygen_bits:2048", "-out", str(key)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        subprocess.run(["openssl", "pkey", "-in", str(key), "-pubout", "-out", str(pub)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)

    def _do(self, *, pin=None, private=None, output=None):
        return signer.sign_offline(
            self.api, self.web, private or self.private,
            self.public, pin or self.pin, output or self.out
        )

    def test_real_synthetic_pair_signs_and_existing_independent_verifier_accepts(self):
        self._do()
        manifest = self.out / signer.OUT_MANIFEST
        signature = self.out / signer.OUT_SIGNATURE
        self.assertTrue(manifest.is_file())
        self.assertTrue(signature.is_file())
        self.assertEqual(manifest.stat().st_mode & 0o777, 0o600)
        self.assertEqual(signature.stat().st_mode & 0o777, 0o600)
        payload = readback.decode_signed_manifest(manifest.read_bytes())
        self.assertEqual(payload["sourceSha"], signer._load(
            "v5_test_older_source", "schoolos-v5-prior-oci-candidate-manifest.py"
        ).OLDER)
        readback.verify_detached_signature(
            manifest.read_bytes(), signature, self.public, self.pin
        )
        self.assertNotEqual(payload["api"]["sha256"], payload["web"]["sha256"])

    def test_manifest_never_overwritten_even_with_new_images(self):
        self._do()
        old_manifest = (self.out / signer.OUT_MANIFEST).read_bytes()
        old_signature = (self.out / signer.OUT_SIGNATURE).read_bytes()
        with self.assertRaises(signer.Hold):
            self._do()
        self.assertEqual((self.out / signer.OUT_MANIFEST).read_bytes(), old_manifest)
        self.assertEqual((self.out / signer.OUT_SIGNATURE).read_bytes(), old_signature)

    def test_bad_pin_halts_without_writing(self):
        with self.assertRaises(signer.Hold):
            self._do(pin="0" * 64)
        self.assertEqual(list(self.out.iterdir()), [])

    def test_bad_pin_format_halts_without_writing(self):
        with self.assertRaises(signer.Hold):
            self._do(pin="not-a-valid-pin")
        self.assertEqual(list(self.out.iterdir()), [])

    def test_unpaired_private_key_halts_without_writing(self):
        other_private = self.root / "other-private.pem"
        other_public = self.root / "other-public.pem"
        self._genkey(other_private, other_public)
        other_private.chmod(0o600)
        with self.assertRaises(signer.Hold):
            self._do(private=other_private)
        self.assertEqual(list(self.out.iterdir()), [])

    def test_world_readable_private_key_rejected(self):
        self.private.chmod(0o644)
        with self.assertRaises(signer.Hold):
            self._do()
        self.assertEqual(list(self.out.iterdir()), [])

    def test_world_readable_output_dir_rejected(self):
        self.out.chmod(0o755)
        with self.assertRaises(signer.Hold):
            self._do()
        self.assertEqual(list(self.out.iterdir()), [])

    def test_symlink_private_key_rejected(self):
        alias = self.root / "alias.key"
        alias.symlink_to(self.private)
        with self.assertRaises(signer.Hold):
            self._do(private=alias)
        self.assertEqual(list(self.out.iterdir()), [])

    def test_symlink_output_directory_rejected(self):
        link = self.root / "shortcut"
        link.symlink_to(self.out, target_is_directory=True)
        with self.assertRaises(signer.Hold):
            self._do(output=link)
        self.assertEqual(list(self.out.iterdir()), [])

    def test_mismatched_source_revision_halts_without_files(self):
        self.api.write_bytes(helper.archive("api", label="b" * 40)[0])
        with self.assertRaises(signer.Hold):
            self._do()
        self.assertEqual(list(self.out.iterdir()), [])

    def test_garbage_oci_archive_halts(self):
        self.web.write_bytes(b"not-OCI")
        with self.assertRaises(signer.Hold):
            self._do()
        self.assertEqual(list(self.out.iterdir()), [])

    def test_secret_in_historic_build_history_halts(self):
        self.api.write_bytes(helper.archive("api", include_secret_metadata=True)[0])
        with self.assertRaises(signer.Hold):
            self._do()
        self.assertEqual(list(self.out.iterdir()), [])

    def test_signature_validation_detects_tampering(self):
        self._do()
        manifest = self.out / signer.OUT_MANIFEST
        tampered = manifest.read_bytes().replace(b'"sourceSha"', b'"someFake!"')
        with self.assertRaises(readback.Hold):
            readback.verify_detached_signature(
                tampered, self.out / signer.OUT_SIGNATURE, self.public, self.pin
            )

    def test_main_requires_all_private_environment_inputs(self):
        with patch.dict(os.environ, {
                "V5_CUSTODY_API_OCI_ARCHIVE_PATH": "",
                "V5_CUSTODY_WEB_OCI_ARCHIVE_PATH": "",
                "V5_CUSTODY_PRIVATE_SIGNING_KEY_PATH": "",
                "V5_CUSTODY_PUBKEY_PATH": "",
                "V5_CUSTODY_PUBKEY_SHA256": "",
                "V5_CUSTODY_SIGNED_OUTPUT_DIR": "",
        }):
            self.assertEqual(signer.main(), 2)
        self.assertEqual(list(self.out.iterdir()), [])

    def test_main_succeeds_on_synthetic_private_environment_only(self):
        with patch.dict(os.environ, {
                "V5_CUSTODY_API_OCI_ARCHIVE_PATH": str(self.api),
                "V5_CUSTODY_WEB_OCI_ARCHIVE_PATH": str(self.web),
                "V5_CUSTODY_PRIVATE_SIGNING_KEY_PATH": str(self.private),
                "V5_CUSTODY_PUBKEY_PATH": str(self.public),
                "V5_CUSTODY_PUBKEY_SHA256": self.pin,
                "V5_CUSTODY_SIGNED_OUTPUT_DIR": str(self.out),
        }):
            self.assertEqual(signer.main(), 0)
        self.assertTrue((self.out / signer.OUT_SIGNATURE).is_file())


if __name__ == "__main__":
    unittest.main()
