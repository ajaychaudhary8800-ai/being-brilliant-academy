"""Synthetic-only R2 conditional create-once publisher security tests.

No Cloudflare credentials, real OCI images, R2 writes or real approvals.
"""
from __future__ import annotations

import hashlib
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

PATH = Path(__file__).with_name("schoolos-v5-private-r2-conditional-once-publish.py")
spec = importlib.util.spec_from_file_location("v5_publish_once", PATH)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class FakeReader:
    pass


class FakeWriter:
    def __init__(self, fail_on=None):
        self.writes = []
        self.fail_on = fail_on

    def put_object(self, **kwargs):
        if self.fail_on == kwargs["Metadata"]["v5-role"]:
            raise RuntimeError("LEAK_PRIVATE_BUCKET_ENDPOINT_NEVER_PRINT")
        raw = kwargs["Body"].read()
        self.writes.append((kwargs, raw))
        return {"ResponseMetadata": {"HTTPStatusCode": 200}}


class TestPublisher(unittest.TestCase):
    def setUp(self):
        td = tempfile.TemporaryDirectory(prefix="v5-conditional-publish-test-")
        self.addCleanup(td.cleanup)
        self.home = Path(td.name)
        self.api = self.home / "api.synthetic.oci.tar"
        self.web = self.home / "web.synthetic.oci.tar"
        self.api.write_bytes(b"synthetic-oci-api")
        self.web.write_bytes(b"synthetic-oci-web-different")
        self.api.chmod(0o600)
        self.web.chmod(0o600)
        self.manifest_bytes = b"synthetic-pinned-manifest-only"
        self.record = {
            role: {
                "key": f"v5-rollback/oldsource/{role}.oci.tar",
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "sizeBytes": path.stat().st_size,
            }
            for role, path in (("api", self.api), ("web", self.web))
        }
        self.env = {
            "V5_CUSTODY_MANIFEST_PATH": "/synthetic/never-real",
            "V5_CUSTODY_API_OCI_ARCHIVE_PATH": str(self.api),
            "V5_CUSTODY_WEB_OCI_ARCHIVE_PATH": str(self.web),
            "V5_CUSTODY_OWNER_IMMUTABLE_UPLOAD_ACK": m.ACK,
            "V5_CUSTODY_OWNER_APPROVED_MANIFEST_SHA256":
                hashlib.sha256(self.manifest_bytes).hexdigest(),
        }
        self.writer = FakeWriter()
        self.reader = FakeReader()
        self.events = []
        outer = self

        class Pre:
            class Hold(Exception):
                pass

            @staticmethod
            def inspect_local(env):
                outer.events.append("verify-local")
                if env.get("bad_signature"):
                    raise Pre.Hold("LEAK_BAD_SIGNATURE_INPUT")
                return outer.record

            @staticmethod
            def check_identities(env):
                outer.events.append("identity")
                if env.get("bad_identity"):
                    raise Pre.Hold("INVALID")

            @staticmethod
            def check_cloudflare(env, opener):
                outer.events.append("cloud")
                if env.get("bad_cloud"):
                    raise Pre.Hold("CLOUDFLARE_PRIVATE_TOKEN_LEAK")

            @staticmethod
            def _head_absence(reader, item):
                outer.events.append("head")
                if outer.env.get("existing"):
                    raise Pre.Hold("KEY_EXISTS")

            @staticmethod
            def _make_reader(env):
                outer.events.append("reader")
                return outer.reader

        class Signed:
            class Hold(Exception):
                pass
            MAX_MANIFEST_BYTES = 16000

            @staticmethod
            def _bounded_regular(path, size):
                outer.events.append("manifest")
                if not path:
                    raise Signed.Hold("BAD_INPUT")
                return outer.manifest_bytes

            @staticmethod
            def readback(client, payload):
                outer.events.append("readback")
                if outer.env.get("reader_failure"):
                    raise RuntimeError("SENSITIVE_REMOTE_FAILURE")
                if len(outer.writer.writes) != 2:
                    raise Signed.Hold("INCOMPLETE")
                for (kwargs, content), role in zip(outer.writer.writes,
                                                    ("api", "web")):
                    assert kwargs["IfNoneMatch"] == "*"
                    assert kwargs["ContentLength"] == len(content)
                    assert hashlib.sha256(content).hexdigest() == payload[role]["sha256"]
        self.pre = Pre
        self.signed = Signed
        self.load_patch = patch.object(m, "_load", side_effect=lambda name, path:
                                       self.pre if "preflight.py" in path
                                       else self.signed)
        self.load_patch.start()
        self.addCleanup(self.load_patch.stop)

    def _run(self):
        return m.publish(self.env, writer_client=self.writer,
                         reader_client=self.reader)

    def expect_hold(self, code):
        with self.assertRaises(m.Hold) as raised:
            self._run()
        self.assertEqual(raised.exception.code, code)
        self.assertNotIn("LEAK", str(raised.exception))

    def test_default_main_is_disabled_no_network_or_writes(self):
        self.assertEqual(m.main([]), 2)
        self.assertEqual(self.events, [])
        self.assertEqual(self.writer.writes, [])

    def test_happy_path_uses_two_conditional_puts_and_independent_reader(self):
        self.assertEqual(self._run(),
                         "PASS_TWO_CONDITIONAL_PUTS_AND_INDEPENDENT_READER_FULL_SHA256")
        self.assertEqual(self.events,
                         ["verify-local", "manifest", "identity", "cloud",
                          "head", "head", "readback"])
        self.assertEqual(len(self.writer.writes), 2)
        for args, raw in self.writer.writes:
            self.assertEqual(args["Bucket"], m.BUCKET)
            self.assertEqual(args["IfNoneMatch"], "*")
            self.assertEqual(args["Metadata"]["v5-source-archive-sha256"],
                             hashlib.sha256(raw).hexdigest())
            self.assertEqual(args["ContentLength"], len(raw))
            self.assertNotIn("SecretAccessKey", args)

    def test_missing_explicit_approval_no_remote_calls(self):
        self.env.pop("V5_CUSTODY_OWNER_IMMUTABLE_UPLOAD_ACK")
        self.expect_hold("OWNER_EXPLICIT_UPLOAD_ACK_MISSING")
        self.assertEqual(self.events, ["verify-local", "manifest"])
        self.assertEqual(self.writer.writes, [])

    def test_wrong_manifest_approval_digest_no_remote_calls(self):
        self.env["V5_CUSTODY_OWNER_APPROVED_MANIFEST_SHA256"] = "a" * 64
        self.expect_hold("OWNER_APPROVED_MANIFEST_HASH_MISMATCH")
        self.assertEqual(self.events, ["verify-local", "manifest"])
        self.assertEqual(self.writer.writes, [])

    def test_malformed_manifest_approval_digest_no_remote_calls(self):
        self.env["V5_CUSTODY_OWNER_APPROVED_MANIFEST_SHA256"] = "not-sha256"
        self.expect_hold("OWNER_APPROVED_MANIFEST_HASH_MISMATCH")
        self.assertEqual(self.writer.writes, [])

    def test_github_actions_never_can_publish(self):
        self.env["GITHUB_ACTIONS"] = "true"
        self.expect_hold("CI_ENVIRONMENT_NOT_ALLOWED")
        self.assertEqual(self.writer.writes, [])

    def test_ci_environment_never_can_publish(self):
        self.env["CI"] = "true"
        self.expect_hold("CI_ENVIRONMENT_NOT_ALLOWED")
        self.assertEqual(self.writer.writes, [])

    def test_invalid_local_signature_fails_before_network(self):
        self.env["bad_signature"] = True
        self.expect_hold("SIGNED_LOCAL_OCI_MANIFEST_NOT_VERIFIED")
        self.assertEqual(self.events, ["verify-local"])
        self.assertEqual(self.writer.writes, [])

    def test_rejected_id_fails_no_head_or_write(self):
        self.env["bad_identity"] = True
        self.expect_hold("PRIVATE_R2_PREPUBLICATION_NOT_VERIFIED")
        self.assertEqual(self.events, ["verify-local", "manifest", "identity"])
        self.assertEqual(self.writer.writes, [])

    def test_cloud_lock_not_verified_fails_no_head_or_write(self):
        self.env["bad_cloud"] = True
        self.expect_hold("PRIVATE_R2_PREPUBLICATION_NOT_VERIFIED")
        self.assertEqual(self.events,
                         ["verify-local", "manifest", "identity", "cloud"])
        self.assertEqual(self.writer.writes, [])

    def test_already_present_target_blocks_both_writes(self):
        self.env["existing"] = True
        self.expect_hold("PRIVATE_R2_PREPUBLICATION_NOT_VERIFIED")
        self.assertEqual(self.writer.writes, [])

    def test_second_put_failure_may_leave_first_locked_hold_no_delete(self):
        self.writer.fail_on = "web"
        self.expect_hold(m.READBACK_FAILED)
        self.assertEqual(len(self.writer.writes), 1)
        self.assertEqual(self.events[-1], "head")
        self.assertFalse(hasattr(self.writer, "delete_object"))

    def test_first_put_failure_holds_no_retry(self):
        self.writer.fail_on = "api"
        self.expect_hold(m.READBACK_FAILED)
        self.assertEqual(len(self.writer.writes), 0)

    def test_reader_full_byte_failure_holds_without_delete(self):
        self.env["reader_failure"] = True
        self.expect_hold(m.READBACK_FAILED)
        self.assertEqual(len(self.writer.writes), 2)

    def test_source_file_symlink_rejected_without_writes(self):
        link = self.home / "bad-link.tar"
        link.symlink_to(self.api)
        self.env["V5_CUSTODY_API_OCI_ARCHIVE_PATH"] = str(link)
        self.expect_hold(m.READBACK_FAILED)
        self.assertEqual(self.writer.writes, [])

    def test_changed_file_same_signed_size_rejected_before_first_write(self):
        self.api.write_bytes(b"synthetic-oci-bad")
        self.assertEqual(len(self.api.read_bytes()), self.record["api"]["sizeBytes"])
        self.expect_hold(m.READBACK_FAILED)
        self.assertEqual(self.writer.writes, [])

    def test_source_file_group_writable_rejected(self):
        self.api.chmod(0o620)
        self.expect_hold(m.READBACK_FAILED)
        self.assertEqual(self.writer.writes, [])

    def test_size_over_single_put_limit_holds_without_write(self):
        self.record["api"]["sizeBytes"] = m.MAX_SINGLE_PUT + 1
        self.expect_hold(m.READBACK_FAILED)
        self.assertEqual(self.writer.writes, [])

    def test_wrong_commit_response_not_treated_as_success(self):
        class BadResponse(FakeWriter):
            def put_object(self, **kwargs):
                super().put_object(**kwargs)
                return {"ResponseMetadata": {"HTTPStatusCode": 201}}
        self.writer = BadResponse()
        self.expect_hold(m.READBACK_FAILED)

    def test_ambiguous_exception_string_never_leaked(self):
        self.writer.fail_on = "api"
        with self.assertRaises(m.Hold) as e:
            self._run()
        self.assertEqual(str(e.exception), m.READBACK_FAILED)
        self.assertNotIn("LEAK", str(e.exception))

    def test_main_execute_flag_without_owner_ack_refuses_before_import(self):
        with patch.dict(os.environ, {"V5_CUSTODY_OWNER_IMMUTABLE_UPLOAD_ACK": "",
                                     "CI": "", "GITHUB_ACTIONS": ""}, clear=True):
            self.assertEqual(m.main(["--execute-owner-approved-write"]), 2)
        self.assertEqual(self.events, [])
        self.assertEqual(self.writer.writes, [])


if __name__ == "__main__":
    unittest.main()
