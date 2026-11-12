"""Synthetic-only OCI rollback archive checks; no customer images or R2 access."""
from __future__ import annotations

import gzip
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

CODE = Path(__file__).with_name("schoolos-v5-private-oci-offline-verify.py")
spec = importlib.util.spec_from_file_location("v5_oci_verify", CODE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
SHA = "a" * 40


def serialized(x):
    return json.dumps(x, sort_keys=True, separators=(",", ":")).encode()


def content_descriptor(content, media):
    return {"mediaType": media, "digest": "sha256:" + hashlib.sha256(content).hexdigest(), "size": len(content)}


def oci_tar(role, *, mutate_config=False, bad_layer=False, missing_layer=False,
            evil_path=False, duplicates=False, include_extra=False, platform="amd64",
            gzip_layer=False, wrong_diff_id=False, gzip_extra=False,
            gzip_crc_corrupt=False, zstd_layer=False):
    # Expanded synthetic gzip layer crosses the 256 KiB output chunk boundary.
    raw_layer = (("synthetic-" + role).encode() if not gzip_layer else
                 b"synthetic-gzip-layer:" + (b"Z" * 800000))
    layer = gzip.compress(raw_layer, mtime=0) if gzip_layer else raw_layer
    if gzip_extra:
        layer += b"UNAUTHORIZED_COMPRESSED_TRAILER"
    if gzip_crc_corrupt:
        layer = layer[:-1] + bytes([layer[-1] ^ 0xFF])
    diff_id = ("sha256:" + ("f" * 64)) if wrong_diff_id else (
        "sha256:" + hashlib.sha256(raw_layer).hexdigest())
    c = {"architecture": platform, "os": "linux",
         "rootfs": {"type": "layers", "diff_ids": [diff_id]},
         "config": {"Labels": {"org.opencontainers.image.revision":
                               ("b" * 40 if mutate_config else SHA)}}}
    cb = serialized(c)
    cd = content_descriptor(cb, "application/vnd.oci.image.config.v1+json")
    media = ("application/vnd.oci.image.layer.v1.tar+zstd" if zstd_layer else
             "application/vnd.oci.image.layer.v1.tar+gzip" if gzip_layer else
             "application/vnd.oci.image.layer.v1.tar")
    ld = content_descriptor(layer, media)
    m = serialized({"schemaVersion": 2, "mediaType": "application/vnd.oci.image.manifest.v1+json",
                    "config": cd, "layers": [ld]})
    md = content_descriptor(m, "application/vnd.oci.image.manifest.v1+json")
    idx = serialized({"schemaVersion": 2, "manifests": [md]})
    parts = [("oci-layout", serialized({"imageLayoutVersion": "1.0.0"})),
             ("index.json", idx),
             ("blobs/sha256/" + md["digest"].split(":")[1], m),
             ("blobs/sha256/" + cd["digest"].split(":")[1], cb)]
    if not missing_layer:
        parts.append(("blobs/sha256/" + ld["digest"].split(":")[1], layer + (b"bad" if bad_layer else b"")))
    if evil_path:
        parts.append(("../evil", b"bad"))
    if duplicates:
        parts.append(("index.json", idx))
    if include_extra:
        parts.append(("unreviewed-blob.txt", b"bad"))
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w") as tar:
        for name, payload in parts:
            info = tarfile.TarInfo(name)
            info.size = len(payload)
            info.mode = 0o600
            tar.addfile(info, io.BytesIO(payload))
    return stream.getvalue(), md["digest"]


class OCIReadbackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix="v5-oci-only-synthetic-")
        cls.p = Path(cls.tmp.name)
        cls.key = cls.p / "private.pem"
        cls.public = cls.p / "public.pem"
        cls.sign = cls.p / "custody.sig"
        cls.manifest = cls.p / "custody.json"
        subprocess.run(["openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048",
                        "-out", str(cls.key)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        subprocess.run(["openssl", "pkey", "-in", str(cls.key), "-pubout", "-out", str(cls.public)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        cls.pin = hashlib.sha256(cls.public.read_bytes()).hexdigest()

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def setUp(self):
        self.files = {}
        self.payload = {"schema": mod.signed.SCHEMA, "sourceSha": SHA}
        for role in ("api", "web"):
            raw, manifest_digest = oci_tar(role)
            f = self.p / f"{role}.oci.tar"
            f.write_bytes(raw)
            self.files[role] = f
            self.payload[role] = {
                "key": f"v5-rollback/{SHA}/{role}.oci.tar",
                "sha256": hashlib.sha256(raw).hexdigest(), "sizeBytes": len(raw),
                "ociManifestDigest": manifest_digest,
            }
        self.resign()

    def resign(self):
        self.manifest.write_bytes(serialized(self.payload))
        subprocess.run(["openssl", "dgst", "-sha256", "-sign", str(self.key),
                        "-out", str(self.sign), str(self.manifest)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)

    def refresh(self, role, raw, digest):
        self.files[role].write_bytes(raw)
        self.payload[role]["sha256"] = hashlib.sha256(raw).hexdigest()
        self.payload[role]["sizeBytes"] = len(raw)
        self.payload[role]["ociManifestDigest"] = digest
        self.resign()

    def check(self):
        mod.inspect(self.manifest, self.sign, self.public, self.pin,
                    self.files["api"], self.files["web"])

    def test_valid_signed_two_role_content_check(self):
        self.check()

    def test_manifest_signature_tampering_holds(self):
        self.payload["api"]["ociManifestDigest"] = "sha256:" + "e" * 64
        self.manifest.write_bytes(serialized(self.payload))
        with self.assertRaises((mod.Hold, mod.signed.Hold)):
            self.check()

    def test_signed_wrong_oci_manifest_digest_holds(self):
        self.payload["api"]["ociManifestDigest"] = "sha256:" + "e" * 64
        self.resign()
        with self.assertRaises(mod.Hold):
            self.check()

    def test_modified_archive_without_new_signature_holds(self):
        raw = self.files["web"].read_bytes()
        self.files["web"].write_bytes(raw + b"X")
        with self.assertRaises(mod.Hold):
            self.check()

    def test_signed_archive_with_wrong_source_label_holds(self):
        raw, digest = oci_tar("api", mutate_config=True)
        self.refresh("api", raw, digest)
        with self.assertRaises(mod.Hold):
            self.check()

    def test_valid_signed_gzip_layer_matches_uncompressed_diff_id(self):
        raw, digest = oci_tar("api", gzip_layer=True)
        self.refresh("api", raw, digest)
        self.check()

    def test_signed_plain_layer_wrong_diff_id_holds(self):
        raw, digest = oci_tar("api", wrong_diff_id=True)
        self.refresh("api", raw, digest)
        with self.assertRaises(mod.Hold):
            self.check()

    def test_signed_gzip_layer_wrong_diff_id_holds(self):
        raw, digest = oci_tar("api", gzip_layer=True, wrong_diff_id=True)
        self.refresh("api", raw, digest)
        with self.assertRaises(mod.Hold):
            self.check()

    def test_signed_gzip_layer_trailing_compressed_bytes_holds(self):
        raw, digest = oci_tar("api", gzip_layer=True, gzip_extra=True)
        self.refresh("api", raw, digest)
        with self.assertRaises(mod.Hold):
            self.check()

    def test_signed_gzip_layer_bad_crc_holds(self):
        raw, digest = oci_tar("api", gzip_layer=True, gzip_crc_corrupt=True)
        self.refresh("api", raw, digest)
        with self.assertRaises(mod.Hold):
            self.check()

    def test_unsupported_zstd_layer_holds_without_verifying_diff_id(self):
        raw, digest = oci_tar("api", zstd_layer=True)
        self.refresh("api", raw, digest)
        with self.assertRaises(mod.Hold):
            self.check()

    def test_signed_archive_with_bad_layer_content_holds(self):
        raw, digest = oci_tar("api", bad_layer=True)
        self.refresh("api", raw, digest)
        with self.assertRaises(mod.Hold):
            self.check()

    def test_signed_archive_with_missing_layer_holds(self):
        raw, digest = oci_tar("api", missing_layer=True)
        self.refresh("api", raw, digest)
        with self.assertRaises(mod.Hold):
            self.check()

    def test_signed_archive_with_path_traversal_holds(self):
        raw, digest = oci_tar("api", evil_path=True)
        self.refresh("api", raw, digest)
        with self.assertRaises(mod.Hold):
            self.check()

    def test_signed_archive_with_duplicate_index_holds(self):
        raw, digest = oci_tar("api", duplicates=True)
        self.refresh("api", raw, digest)
        with self.assertRaises(mod.Hold):
            self.check()

    def test_unsigned_extra_files_holds(self):
        raw, digest = oci_tar("web", include_extra=True)
        self.refresh("web", raw, digest)
        with self.assertRaises(mod.Hold):
            self.check()

    def test_non_amd64_image_holds(self):
        raw, digest = oci_tar("api", platform="arm64")
        self.refresh("api", raw, digest)
        with self.assertRaises(mod.Hold):
            self.check()

    def test_docker_save_archive_is_not_oci(self):
        raw = b"opaque previous docker archive"
        self.refresh("web", raw, "sha256:" + "a" * 64)
        with self.assertRaises(mod.Hold):
            self.check()

    def test_local_symlink_holds(self):
        original = self.files["api"]
        link = self.p / "symlink.oci.tar"
        link.unlink(missing_ok=True)
        link.symlink_to(original)
        with self.assertRaises(mod.Hold):
            mod.inspect(self.manifest, self.sign, self.public, self.pin,
                        link, self.files["web"])
        link.unlink()

    def test_invalid_signing_pin_holds_before_archive_read(self):
        with self.assertRaises(mod.signed.Hold):
            mod.inspect(self.manifest, self.sign, self.public, "0" * 64,
                        self.files["api"], self.files["web"])


if __name__ == "__main__":
    unittest.main()
