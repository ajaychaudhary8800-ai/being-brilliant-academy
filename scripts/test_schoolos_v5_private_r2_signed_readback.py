"""Offline only. Synthetic, randomly generated signing key and fake R2 client."""
import hashlib
import importlib.util
import io
import json
import pathlib
import shutil
import subprocess
import tempfile
import unittest

SOURCE = pathlib.Path(__file__).with_name("schoolos-v5-private-r2-signed-readback.py")
spec = importlib.util.spec_from_file_location("v5_r2_signed_readback", SOURCE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

SHA = "a" * 40
API_BYTES = b"synthetic-private-clean-api-oci-archive"
WEB_BYTES = b"synthetic-private-clean-web-oci-archive"

class FakeReader:
    def __init__(self, objects, override_length=None, truncate=False):
        self.objects = objects
        self.override_length = override_length
        self.truncate = truncate
        self.operations = []
    def head_object(self, Bucket, Key):
        self.operations.append(("head", Bucket, Key))
        return {"ContentLength": len(self.objects[Key]) if self.override_length is None else self.override_length}
    def get_object(self, Bucket, Key):
        self.operations.append(("get", Bucket, Key))
        data = self.objects[Key]
        return {"ContentLength": len(data), "Body": io.BytesIO(data[:-2] if self.truncate else data)}

def make_manifest():
    result = {"schema": mod.SCHEMA, "sourceSha": SHA}
    for role, contents in (("api", API_BYTES), ("web", WEB_BYTES)):
        result[role] = {
            "key": f"v5-rollback/{SHA}/{role}.oci.tar",
            "sha256": hashlib.sha256(contents).hexdigest(),
            "sizeBytes": len(contents),
            "ociManifestDigest": "sha256:" + ("b" * 64 if role == "api" else "c" * 64),
        }
    return result

def objects():
    return {
        f"v5-rollback/{SHA}/api.oci.tar": API_BYTES,
        f"v5-rollback/{SHA}/web.oci.tar": WEB_BYTES,
    }

@unittest.skipUnless(shutil.which("openssl"), "openssl unavailable")
class SignedReadbackTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="v5-signed-readback-synthetic-")
        self.addCleanup(self.tmp.cleanup)
        self.folder = pathlib.Path(self.tmp.name)
        self.manifest = self.folder / "manifest.json"
        self.private = self.folder / "synthetic-private-key.pem"
        self.public = self.folder / "synthetic-public-key.pem"
        self.signature = self.folder / "manifest.sig"
        for args in (
            ["openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048",
             "-out", str(self.private)],
            ["openssl", "pkey", "-in", str(self.private), "-pubout", "-out", str(self.public)],
        ):
            subprocess.run(args, check=True, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=20)
        self.pin = hashlib.sha256(self.public.read_bytes()).hexdigest()
        self.data = make_manifest()
        self.sign()

    def sign(self):
        self.manifest.write_text(json.dumps(self.data, sort_keys=True),
                                 encoding="utf-8")
        subprocess.run(
            ["openssl", "dgst", "-sha256", "-sign", str(self.private),
             "-out", str(self.signature), str(self.manifest)],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            timeout=20,
        )

    def check(self, reader=None):
        r = reader if reader is not None else FakeReader(objects())
        mod.run(self.manifest, self.signature, self.public, self.pin, r)
        return r

    def test_valid_pinned_signature_and_both_full_reads(self):
        reader = self.check()
        self.assertEqual(
            [action[0] for action in reader.operations],
            ["head", "get", "head", "get"],
        )
        self.assertTrue(all(a[1] == mod.BUCKET for a in reader.operations))

    def test_signature_authenticates_exact_already_parsed_bytes_not_later_path(self):
        signed_bytes = self.manifest.read_bytes()
        # A local attacker replacing the manifest path between read and
        # verification cannot make the verifier approve different bytes.
        self.manifest.write_bytes(b'{"schema":"attacker-swapped"}')
        mod.verify_detached_signature(
            signed_bytes, self.signature, self.public, self.pin)
        with self.assertRaises(mod.Hold):
            mod.run(self.manifest, self.signature, self.public, self.pin,
                    FakeReader(objects()))

    def test_manifest_signature_modification_is_rejected_before_any_read(self):
        reader = FakeReader(objects())
        self.data["api"]["sizeBytes"] += 1
        self.manifest.write_text(json.dumps(self.data), encoding="utf-8")
        with self.assertRaises(mod.Hold):
            mod.run(self.manifest, self.signature, self.public, self.pin, reader)
        self.assertEqual(reader.operations, [])

    def test_unpinned_key_is_rejected_before_any_read(self):
        reader = FakeReader(objects())
        with self.assertRaises(mod.Hold):
            mod.run(self.manifest, self.signature, self.public, "0" * 64, reader)
        self.assertEqual(reader.operations, [])

    def test_corrupted_api_archive_is_rejected(self):
        f = objects()
        f[f"v5-rollback/{SHA}/api.oci.tar"] = b"evil" + API_BYTES[4:]
        with self.assertRaises(mod.Hold):
            self.check(FakeReader(f))

    def test_corrupted_web_archive_is_rejected(self):
        f = objects()
        f[f"v5-rollback/{SHA}/web.oci.tar"] = b"evil" + WEB_BYTES[4:]
        with self.assertRaises(mod.Hold):
            self.check(FakeReader(f))

    def test_truncated_stream_rejects(self):
        with self.assertRaises(mod.Hold):
            self.check(FakeReader(objects(), truncate=True))

    def test_wrong_head_content_length_rejects(self):
        with self.assertRaises(mod.Hold):
            self.check(FakeReader(objects(), override_length=12345))

    def test_network_exception_does_not_leak(self):
        class Fails:
            def head_object(self, **_):
                raise RuntimeError("fake secret=untrusted-token")
        with self.assertRaises(mod.Hold) as x:
            self.check(Fails())
        self.assertNotIn("untrusted-token", str(x.exception))

    def test_disallows_unexpected_object_path_even_when_signed(self):
        self.data["web"]["key"] = f"v5-rollback/{SHA}/../../secret"
        self.sign()
        with self.assertRaises(mod.Hold):
            self.check()

    def test_disallows_identical_api_and_web_digests_even_when_signed(self):
        self.data["web"]["sha256"] = self.data["api"]["sha256"]
        self.sign()
        with self.assertRaises(mod.Hold):
            self.check()

    def test_boolean_size_is_not_a_valid_object_length(self):
        self.data["api"]["sizeBytes"] = True
        self.sign()
        with self.assertRaises(mod.Hold):
            self.check()

    def test_duplicate_json_keys_are_rejected_even_if_signature_valid(self):
        raw = self.manifest.read_text()
        self.manifest.write_text(raw.replace('"schema":', '"schema":"duplicate", "schema":', 1))
        subprocess.run(["openssl", "dgst", "-sha256", "-sign", str(self.private),
                        "-out", str(self.signature), str(self.manifest)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        with self.assertRaises(mod.Hold):
            self.check()

    def test_manifest_symlink_rejected(self):
        shortcut = self.folder / "linked-manifest.json"
        shortcut.symlink_to(self.manifest)
        with self.assertRaises(mod.Hold):
            mod.run(shortcut, self.signature, self.public, self.pin,
                    FakeReader(objects()))

    def test_silent_main_hold_without_network_credentials(self):
        # Explicit input validation is pure and performed before any S3 request.
        with self.assertRaises(mod.Hold):
            mod._client("not-an-account", "not-access", "not-secret")

if __name__ == "__main__":
    unittest.main()
