"""Synthetic-only fail-closed R2 signed OCI prepublication preflight tests."""
from __future__ import annotations
import importlib.util
from pathlib import Path
from unittest.mock import patch
import os
import unittest

FILE = Path(__file__).with_name("schoolos-v5-private-r2-publication-preflight.py")
spec = importlib.util.spec_from_file_location("v5_publication_preflight", FILE)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

OLDER = "b54dca5ae36a948f83012faa4a37354198fba083"
RECORD = {
    "schema": "schoolos-v5-private-rollback-readback-v1",
    "sourceSha": OLDER,
    "api": {"key": f"v5-rollback/{OLDER}/api.oci.tar"},
    "web": {"key": f"v5-rollback/{OLDER}/web.oci.tar"},
}
ENV = {
    "CLOUDFLARE_ACCOUNT_ID": "a" * 32,
    "CLOUDFLARE_API_TOKEN": "synthetic-admin-readonly-not-real",
    "R2_CUSTODY_WRITER_ACCESS_KEY_ID": "syntheticWriterKeyId001",
    "R2_CUSTODY_READER_ACCESS_KEY_ID": "syntheticReaderKeyId002",
    "R2_CUSTODY_READER_SECRET_ACCESS_KEY": "synthetic-reader-secret-not-real",
}


class SimulatedR2Error(Exception):
    def __init__(self, http_status, code):
        self.response = {
            "ResponseMetadata": {"HTTPStatusCode": http_status},
            "Error": {"Code": code},
        }


class MockReader:
    def __init__(self, *, outcome="absent"):
        self.outcome = outcome
        self.calls = []

    def head_object(self, *, Bucket, Key):
        self.calls.append((Bucket, Key))
        if self.outcome == "absent":
            raise SimulatedR2Error(404, "NoSuchKey")
        if self.outcome == "access_denied":
            raise SimulatedR2Error(403, "AccessDenied")
        if self.outcome == "fake404":
            raise SimulatedR2Error(403, "NoSuchKey")
        if self.outcome == "server_error":
            raise SimulatedR2Error(503, "InternalError")
        if self.outcome == "ambiguous":
            raise RuntimeError("LEAKS_PRIVATE_KEY_ID_TO_CLIENT_LOG")
        return {"ContentLength": 2}


class PreflightTests(unittest.TestCase):
    def assert_holds(self, action, code):
        with self.assertRaises(m.Hold) as ctx:
            action()
        self.assertEqual(ctx.exception.code, code)
        self.assertNotIn("LEAKS", str(ctx.exception))

    def test_identity_separation_matching_ids_rejected(self):
        env = dict(ENV, R2_CUSTODY_READER_ACCESS_KEY_ID=ENV["R2_CUSTODY_WRITER_ACCESS_KEY_ID"])
        self.assert_holds(lambda: m.check_identities(env),
                          "R2_WRITER_READER_IDENTITY_NOT_SEPARATE")

    def test_identity_missing_fails(self):
        self.assert_holds(lambda: m.check_identities({}),
                          "R2_IDENTITY_INPUT_MISSING")

    def test_identity_malformed_key_fails(self):
        self.assert_holds(lambda: m.check_identities(dict(ENV, R2_CUSTODY_READER_ACCESS_KEY_ID="BAD KEY")),
                          "R2_IDENTITY_INPUT_MISSING")

    def test_identity_distinct_pass_is_ids_only(self):
        self.assertTrue(m.check_identities(ENV))

    def test_exact_object_absent_404_pass(self):
        client = MockReader()
        m._head_absence(client, RECORD["api"])
        self.assertEqual(client.calls, [(m.BUCKET, RECORD["api"]["key"])])

    def test_existing_object_fails_closed(self):
        self.assert_holds(lambda: m._head_absence(MockReader(outcome="exists"), RECORD["api"]),
                          "R2_TARGET_KEY_ALREADY_EXISTS")

    def test_access_denied_not_treated_as_missing(self):
        self.assert_holds(lambda: m._head_absence(MockReader(outcome="access_denied"), RECORD["api"]),
                          "R2_KEY_STATE_UNVERIFIED")

    def test_403_forged_nosuchkey_rejected(self):
        self.assert_holds(lambda: m._head_absence(MockReader(outcome="fake404"), RECORD["api"]),
                          "R2_KEY_STATE_UNVERIFIED")

    def test_server_error_rejected(self):
        self.assert_holds(lambda: m._head_absence(MockReader(outcome="server_error"), RECORD["api"]),
                          "R2_KEY_STATE_UNVERIFIED")

    def test_ambiguous_error_does_not_leak(self):
        self.assert_holds(lambda: m._head_absence(MockReader(outcome="ambiguous"), RECORD["api"]),
                          "R2_KEY_STATE_UNVERIFIED")

    def test_order_local_signed_first_then_id_then_cloud_then_head(self):
        steps = []
        def local(env):
            steps.append("local")
            return RECORD
        def ids(env):
            steps.append("identities")
        def cloud(env, open_request=None):
            steps.append("cloud")
        client = MockReader()
        with patch.object(m, "inspect_local", local), patch.object(m, "check_identities", ids), patch.object(m, "check_cloudflare", cloud):
            result = m.inspect(ENV, reader_client=client)
        self.assertEqual(steps, ["local", "identities", "cloud"])
        self.assertEqual(len(client.calls), 2)
        self.assertEqual(result["V5_R2_PUBLICATION_REVIEW_PREFLIGHT"],
                         "PASS_READ_ONLY_REVIEW_ONLY")

    def test_offline_verifiers_distinct_signed_hold_class_is_sanitized(self):
        class SignatureFailure(Exception):
            pass

        class DummySigned:
            Hold = type("SignedHold", (Exception,), {})

        class DummyOffline:
            Hold = type("OfflineHold", (Exception,), {})
            signed = type("Dependency", (), {"Hold": SignatureFailure})

            @staticmethod
            def inspect(*args):
                raise SignatureFailure("SECRET_NEVER_ECHO")

        modules = {
            "schoolos-v5-private-r2-signed-readback.py": DummySigned,
            "schoolos-v5-private-oci-offline-verify.py": DummyOffline,
        }
        env = {
            "V5_CUSTODY_MANIFEST_PATH": "synthetic",
            "V5_CUSTODY_SIGNATURE_PATH": "synthetic",
            "V5_CUSTODY_PUBKEY_PATH": "synthetic",
            "V5_CUSTODY_PUBKEY_SHA256": "a" * 64,
            "V5_CUSTODY_API_OCI_ARCHIVE_PATH": "synthetic",
            "V5_CUSTODY_WEB_OCI_ARCHIVE_PATH": "synthetic",
        }
        with patch.object(m, "_load", side_effect=lambda n, path: modules[path]):
            self.assert_holds(lambda: m.inspect_local(env),
                              "SIGNED_OCI_BYTES_NOT_VERIFIED")

    def test_invalid_signed_local_inputs_block_network(self):
        client = MockReader()
        with patch.object(m, "inspect_local", side_effect=m.Hold("SIGNED_OCI_BYTES_NOT_VERIFIED")):
            self.assert_holds(lambda: m.inspect(ENV, reader_client=client),
                              "SIGNED_OCI_BYTES_NOT_VERIFIED")
        self.assertEqual(client.calls, [])

    def test_nonprivate_control_plane_blocks_head(self):
        client = MockReader()
        with patch.object(m, "inspect_local", return_value=RECORD), patch.object(
            m, "check_cloudflare", side_effect=m.Hold("PRIVATE_R2_CONFIG_UNCONFIRMED")
        ):
            self.assert_holds(lambda: m.inspect(ENV, reader_client=client),
                              "PRIVATE_R2_CONFIG_UNCONFIRMED")
        self.assertEqual(client.calls, [])

    def test_second_key_exists_aborts_even_if_first_absent(self):
        class SecondExists(MockReader):
            def head_object(self, *, Bucket, Key):
                if Key.endswith("/web.oci.tar"):
                    self.calls.append((Bucket, Key))
                    return {"ContentLength": 3}
                return super().head_object(Bucket=Bucket, Key=Key)
        client = SecondExists()
        with patch.object(m, "inspect_local", return_value=RECORD), patch.object(
            m, "check_cloudflare", return_value={"R2_PRIVATE_CONFIG_PREFLIGHT": "PASS_CONFIGURATION_ONLY"}
        ):
            self.assert_holds(lambda: m.inspect(ENV, reader_client=client),
                              "R2_TARGET_KEY_ALREADY_EXISTS")
        self.assertEqual(len(client.calls), 2)

    def test_control_plane_verification_error_rejected(self):
        with patch.object(m, "_load") as loader:
            fake = type("Cloud", (), {"inspect": lambda *args, **kw: {
                "R2_PRIVATE_CONFIG_PREFLIGHT": "HOLD"
            }})
            loader.return_value = fake
            self.assert_holds(lambda: m.check_cloudflare(ENV), "PRIVATE_R2_CONFIG_UNCONFIRMED")

    def test_preflight_does_not_call_any_mutating_client_method(self):
        class NoMutating(MockReader):
            def __getattr__(self, value):
                raise AssertionError(f"Forbidden operation: {value}")
        reader = NoMutating()
        with patch.object(m, "inspect_local", return_value=RECORD), patch.object(
            m, "check_cloudflare", return_value={"R2_PRIVATE_CONFIG_PREFLIGHT": "PASS_CONFIGURATION_ONLY"}
        ):
            self.assertEqual(m.inspect(ENV, reader_client=reader)["V5_R2_READER_WRITER_ID_DISTINCT"],
                             "PASS_IDS_ONLY")
        self.assertEqual(len(reader.calls), 2)

    def test_main_without_env_holds_and_never_writes(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(m.main(), 2)


if __name__ == "__main__":
    unittest.main()
