"""Synthetic private V5 owner-builder unit tests; NO Docker/Git/R2 calls."""
from __future__ import annotations

import hashlib
import importlib.util
import io
import os
from pathlib import Path
import stat
import tarfile
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).with_name("schoolos-v5-private-prior-oci-local-builder.py")
spec = importlib.util.spec_from_file_location("v5_local_prior_builder", SCRIPT)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

DIGEST = "sha256:" + "a" * 64
VALID_API = ("FROM node:22-alpine AS build\n" + m.API_ANCHOR +
             "FROM node:22-alpine AS runtime\n")
VALID_WEB = "FROM node:22-alpine AS build\nFROM node:22-alpine AS runtime\n"


def make_archive(path, entries):
    with tarfile.open(path, "w") as f:
        for name, typ, payload in entries:
            member = tarfile.TarInfo(name)
            if typ == "dir":
                member.type = tarfile.DIRTYPE
                member.mode = 0o755
                f.addfile(member)
            elif typ == "file":
                member.size = len(payload)
                member.mode = 0o644
                f.addfile(member, io.BytesIO(payload))
            elif typ == "symlink":
                member.type = tarfile.SYMTYPE
                member.linkname = "/etc/passwd"
                f.addfile(member)


class LocalPrivateBuildTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="v5-owner-builder-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.private = self.root / "private"
        self.private.mkdir(mode=0o700)
        self.private.chmod(0o700)
        self.env = {
            "V5_OWNER_PRIVATE_BUILDER_ACK": m.ACK,
            "V5_OWNER_CONTROLS_SHA": "1" * 40,
            "V5_OWNER_APPROVED_NODE22_ALPINE_DIGEST": DIGEST,
            "V5_OWNER_PRIVATE_BUILD_DIR": str(self.private),
        }

    def test_default_cli_refuses_without_importing_any_external_tool(self):
        self.assertEqual(m.main([]), 2)
        self.assertEqual(list(self.private.iterdir()), [])

    def test_valid_owner_only_private_approval_returns_input_tuples(self):
        controls, base, root = m.check_approvals(self.env, uid=os.getuid())
        self.assertEqual(controls, "1" * 40)
        self.assertEqual(base, DIGEST)
        self.assertEqual(root, self.private)

    def test_ci_refused_regardless_of_string_value(self):
        self.env["CI"] = "1"
        with self.assertRaises(m.Hold) as x:
            m.check_approvals(self.env, uid=os.getuid())
        self.assertEqual(x.exception.code, "CI_OR_GITHUB_ACTIONS_PROHIBITED")

    def test_github_actions_refused(self):
        self.env["GITHUB_ACTIONS"] = "false"
        with self.assertRaises(m.Hold):
            m.check_approvals(self.env, uid=os.getuid())

    def test_root_builder_refused(self):
        with self.assertRaises(m.Hold) as x:
            m.check_approvals(self.env, uid=0)
        self.assertEqual(x.exception.code, "ROOT_BUILDER_NOT_ALLOWED")

    def test_missing_owner_ack_refused(self):
        del self.env["V5_OWNER_PRIVATE_BUILDER_ACK"]
        with self.assertRaises(m.Hold):
            m.check_approvals(self.env, uid=os.getuid())

    def test_unpinned_node_base_refused(self):
        self.env["V5_OWNER_APPROVED_NODE22_ALPINE_DIGEST"] = "node:22-alpine"
        with self.assertRaises(m.Hold):
            m.check_approvals(self.env, uid=os.getuid())

    def test_output_directory_world_exposed_refused(self):
        self.private.chmod(0o755)
        with self.assertRaises(m.Hold):
            m.check_approvals(self.env, uid=os.getuid())

    def test_existing_output_file_cannot_be_overwritten(self):
        (self.private / "api.oci.tar").write_bytes(b"DO-NOT-REPLACE")
        with self.assertRaises(m.Hold):
            m.check_approvals(self.env, uid=os.getuid())

    def test_derived_old_api_recipe_pins_base_and_purges_docs(self):
        api, web = m.derived_recipes(VALID_API, VALID_WEB, DIGEST)
        self.assertEqual(api.count("@sha256:"), 2)
        self.assertEqual(web.count("@sha256:"), 2)
        self.assertIn(m.PRUNE_COMMAND, api)
        self.assertNotIn("controls=", web)

    def test_old_api_anchor_change_refused(self):
        with self.assertRaises(m.Hold):
            m.derived_recipes(VALID_API.replace(m.API_ANCHOR, "RUN npm install\n"),
                              VALID_WEB, DIGEST)

    def test_unexpected_base_count_refused(self):
        with self.assertRaises(m.Hold):
            m.derived_recipes(VALID_API, VALID_WEB + "FROM node:22-alpine AS rogue\n", DIGEST)

    def test_git_sha1_matches_known_legacy_blob_hash_implementation(self):
        data = b"tested"
        self.assertEqual(
            m._git_object_sha1(data),
            hashlib.sha1(b"blob 6\0tested").hexdigest(),
        )

    def test_safe_git_archive_extracts_plain_content_in_private_dir(self):
        raw = self.root / "git.tar"
        make_archive(raw, [("apps", "dir", b""),
                           ("apps/api/test.txt", "file", b"known-source-file")])
        destination = self.root / "source"
        destination.mkdir(mode=0o700)
        m._safe_extract_git_tar(raw, destination)
        self.assertEqual((destination / "apps/api/test.txt").read_bytes(),
                         b"known-source-file")
        self.assertEqual((destination / "apps/api/test.txt").stat().st_mode & 0o777, 0o600)

    def test_symlink_in_git_archive_rejected(self):
        raw = self.root / "git.tar"
        make_archive(raw, [("link", "symlink", b"")])
        with self.assertRaises(m.Hold):
            m._safe_extract_git_tar(raw, self.private)

    def test_parent_path_traversal_rejected(self):
        raw = self.root / "git.tar"
        make_archive(raw, [("../escaped", "file", b"PRIVATE-DO-NOT-MOVE")])
        with self.assertRaises(m.Hold):
            m._safe_extract_git_tar(raw, self.private)
        self.assertFalse((self.root / "escaped").exists())

    def test_duplicate_tar_member_rejected(self):
        raw = self.root / "git.tar"
        make_archive(raw, [("same.txt", "file", b"one"), ("same.txt", "file", b"two")])
        with self.assertRaises(m.Hold):
            m._safe_extract_git_tar(raw, self.private)

    def test_promote_local_files_without_overwrite(self):
        one, two, three = (self.root / name for name in ("a", "b", "c"))
        for f in (one, two, three):
            f.write_bytes(b"synthetic")
        m._promote_private(self.private, [
            (one, "api.oci.tar"), (two, "web.oci.tar"),
            (three, "candidate-receipt.json"),
        ])
        self.assertEqual((self.private / "web.oci.tar").read_bytes(), b"synthetic")
        self.assertEqual((self.private / "web.oci.tar").stat().st_mode & 0o777, 0o600)

    def test_second_file_collision_rolls_back_only_new_first_file(self):
        (self.private / "web.oci.tar").write_bytes(b"PROTECT")
        a, b = self.root / "a", self.root / "b"
        a.write_bytes(b"new")
        b.write_bytes(b"new")
        with self.assertRaises(m.Hold):
            m._promote_private(self.private, [(a, "api.oci.tar"), (b, "web.oci.tar")])
        self.assertFalse((self.private / "api.oci.tar").exists())
        self.assertEqual((self.private / "web.oci.tar").read_bytes(), b"PROTECT")

    def test_full_builder_is_never_called_without_explicit_cli_switch(self):
        with patch.object(m, "build_private", side_effect=AssertionError("NO BUILD")):
            self.assertEqual(m.main(["--dry-run"]), 2)

    def test_git_pins_check_fails_with_inconsistent_revision(self):
        def bad_git(argv, **kw):
            if argv[3] == "rev-parse":
                return b"wrong-commit\n"
            raise AssertionError("NO FURTHER ACTION")
        with patch.object(m, "_run", side_effect=bad_git):
            with self.assertRaises(m.Hold) as x:
                m.check_git_pins(self.root, "1" * 40)
        self.assertEqual(x.exception.code, "REVIEWED_GIT_REVISION_MISMATCH")

    def test_mocked_private_builder_promotes_unsigned_artifacts_no_cloud_actions(self):
        # The only source inputs are synthetic mocks, NOT real OCI images.
        commands = []
        source_bytes = {
            "apps/api/Dockerfile": VALID_API.encode(),
            "apps/web/Dockerfile": VALID_WEB.encode(),
        }
        for path in m.CONTROLS:
            source_bytes[path] = b"synthetic-reviewed-control-script"
        previous_git = m._run

        def fake_command(argv, **kwargs):
            commands.append(argv)
            if argv[:1] == ["git"] and "archive" in argv:
                out = Path(next(arg for arg in argv if arg.startswith("--output=")).split("=", 1)[1])
                make_archive(out, [("apps", "dir", b""),
                                   ("apps/api", "dir", b""),
                                   ("apps/web", "dir", b""),
                                   ("apps/api/Dockerfile", "file", VALID_API.encode()),
                                   ("apps/web/Dockerfile", "file", VALID_WEB.encode())])
                return b""
            if argv[:2] == ["docker", "buildx"]:
                out = next(arg for arg in argv if arg.startswith("type=oci,dest="))
                Path(out.split("=", 2)[2]).write_bytes(b"fake-OCI-not-real")
                return b""
            if argv[:1] == ["git"] and "show" in argv:
                target = argv[-1].split(":", 1)[1]
                return source_bytes[target]
            raise AssertionError("UNEXPECTED BUILDER_COMMAND")

        def fake_receipt(api, web, stage):
            receipt = stage / "candidate-receipt.json"
            receipt.write_text('{"synthetic":"no-real-oci"}')
            return receipt

        with patch.object(m, "check_git_pins", return_value=None), \
                patch.object(m, "_run", side_effect=fake_command), \
                patch.object(m, "_scan_archive", return_value=None), \
                patch.object(m, "_receipt", side_effect=fake_receipt):
            m.build_private(self.root, self.env, approved=("1" * 40, DIGEST, self.private))
        self.assertTrue((self.private / "api.oci.tar").exists())
        self.assertTrue((self.private / "web.oci.tar").exists())
        self.assertTrue((self.private / "candidate-receipt.json").exists())
        # A reviewed Git control *filename* may legitimately contain "r2"
        # (the local offline signed-readback verifier). Forbid actual
        # publishing/SSH/network CLI commands rather than safe file names.
        self.assertTrue(all(c[0] in ("git", "docker") for c in commands))
        docker = [c for c in commands if c[0] == "docker"]
        self.assertEqual(len(docker), 2)
        self.assertTrue(all(c[:3] == ["docker", "buildx", "build"] for c in docker))
        self.assertTrue(all("--output" in c for c in docker))
        self.assertTrue(all(not any(token in c for token in
                                    ("push", "login", "upload", "put-object",
                                     "rm", "rmi", "save", "load"))
                            for c in docker))
        self.assertEqual(len(list(self.private.glob(".v5-prior-build-*"))), 0)


if __name__ == "__main__":
    unittest.main()
