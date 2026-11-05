"""Offline-only R2 control-plane preflight regressions; no Cloudflare account used."""
import importlib.util
import io
import json
import pathlib
import unittest

MODULE_FILE = pathlib.Path(__file__).with_name("schoolos-v5-r2-custody-preflight.py")
spec = importlib.util.spec_from_file_location("custody_preflight", MODULE_FILE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

ACCOUNT = "0" * 32
TOKEN = "SENTINEL_TOKEN_NEVER_LOG"
BASE = {
    "": {"name": mod.BUCKET},
    "/domains/managed": {"enabled": False, "domain": "not-exposed.r2.dev"},
    "/domains/custom": {"domains": []},
    "/lock": {"rules": [{"id": "synthetic-lock", "enabled": True,
                           "prefix": mod.LOCK_PREFIX,
                           "condition": {"type": "Age", "maxAgeSeconds": 7776000}}]},
}


class FakeResponse:
    status = 200

    def __init__(self, data):
        self.stream = io.BytesIO(data)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, n):
        return self.stream.read(n)


def provider(payloads=BASE):
    def request(req, timeout):
        assert req.get_method() == "GET"
        assert timeout == 10
        assert req.get_header("Authorization") == f"Bearer {TOKEN}"
        route = req.full_url.split(f"/{mod.BUCKET}", 1)[1]
        return FakeResponse(json.dumps({"success": True, "result": payloads[route]}).encode())
    return request


class PreflightTests(unittest.TestCase):
    def check(self, payloads):
        return mod.inspect(ACCOUNT, TOKEN, provider(payloads))

    def test_private_bucket_with_90_day_lock_passes_configuration_only(self):
        result = self.check(BASE)
        self.assertEqual(result["R2_PRIVATE_CONFIG_PREFLIGHT"], "PASS_CONFIGURATION_ONLY")
        self.assertEqual(result["R2_MANAGED_PUBLIC_DOMAIN"], "DISABLED")
        self.assertEqual(result["R2_CUSTOM_PUBLIC_DOMAINS"], "NONE")
        self.assertEqual(result["R2_ROLLBACK_PREFIX_LOCK"], "PASS_90_DAYS_MINIMUM")

    def test_missing_account_or_token_fails_without_network(self):
        def forbidden(*a, **k):
            raise AssertionError("must not make network request")
        self.assertEqual(mod.inspect(None, TOKEN, forbidden)["R2_PRIVATE_CONFIG_PREFLIGHT"], "HOLD")
        self.assertEqual(mod.inspect(ACCOUNT, None, forbidden)["R2_PRIVATE_CONFIG_PREFLIGHT"], "HOLD")
        self.assertEqual(mod.inspect("bad-account", TOKEN, forbidden)["R2_PRIVATE_CONFIG_PREFLIGHT"], "HOLD")

    def test_missing_bucket_fails(self):
        data = {**BASE, "": {"name": "other-bucket"}}
        self.assertEqual(self.check(data)["R2_PREFLIGHT_BLOCKER"], "BUCKET_MISMATCH")

    def test_managed_domain_enabled_fails(self):
        data = {**BASE, "/domains/managed": {"enabled": True}}
        self.assertEqual(self.check(data)["R2_PREFLIGHT_BLOCKER"], "MANAGED_DOMAIN_NOT_DISABLED")

    def test_missing_managed_domain_flag_fails(self):
        data = {**BASE, "/domains/managed": {}}
        self.assertEqual(self.check(data)["R2_PRIVATE_CONFIG_PREFLIGHT"], "HOLD")

    def test_any_custom_domain_requires_review_even_when_disabled(self):
        data = {**BASE, "/domains/custom": {"domains": [{"domain": "example.invalid", "enabled": False}]}}
        self.assertEqual(self.check(data)["R2_PREFLIGHT_BLOCKER"], "CUSTOM_DOMAINS_REQUIRE_REVIEW")

    def test_missing_custom_domains_fails(self):
        data = {**BASE, "/domains/custom": {}}
        self.assertEqual(self.check(data)["R2_PRIVATE_CONFIG_PREFLIGHT"], "HOLD")

    def test_short_lock_fails(self):
        data = {**BASE, "/lock": {"rules": [{"enabled": True, "prefix": mod.LOCK_PREFIX,
                                               "condition": {"type": "Age", "maxAgeSeconds": 89 * 86400}}]}}
        self.assertEqual(self.check(data)["R2_PREFLIGHT_BLOCKER"], "PREFIX_LOCK_NOT_CONFIRMED")

    def test_other_prefix_lock_fails(self):
        data = {**BASE, "/lock": {"rules": [{"enabled": True, "prefix": "other/",
                                               "condition": {"type": "Indefinite"}}]}}
        self.assertEqual(self.check(data)["R2_PRIVATE_CONFIG_PREFLIGHT"], "HOLD")

    def test_disabled_lock_fails(self):
        data = {**BASE, "/lock": {"rules": [{"enabled": False, "prefix": mod.LOCK_PREFIX,
                                               "condition": {"type": "Indefinite"}}]}}
        self.assertEqual(self.check(data)["R2_PRIVATE_CONFIG_PREFLIGHT"], "HOLD")

    def test_indefinite_lock_passes(self):
        data = {**BASE, "/lock": {"rules": [{"enabled": True, "prefix": mod.LOCK_PREFIX,
                                               "condition": {"type": "Indefinite"}}]}}
        self.assertEqual(self.check(data)["R2_PRIVATE_CONFIG_PREFLIGHT"], "PASS_CONFIGURATION_ONLY")

    def test_boolean_age_is_not_accepted(self):
        data = {**BASE, "/lock": {"rules": [{"enabled": True, "prefix": mod.LOCK_PREFIX,
                                               "condition": {"type": "Age", "maxAgeSeconds": True}}]}}
        self.assertEqual(self.check(data)["R2_PRIVATE_CONFIG_PREFLIGHT"], "HOLD")

    def test_failed_control_plane_call_never_prints_token_or_account(self):
        def fail(req, timeout):
            raise OSError(f"sensitive {TOKEN} {ACCOUNT}")
        result = mod.inspect(ACCOUNT, TOKEN, fail)
        flattened = json.dumps(result)
        self.assertNotIn(TOKEN, flattened)
        self.assertNotIn(ACCOUNT, flattened)
        self.assertEqual(result["R2_PRIVATE_CONFIG_PREFLIGHT"], "HOLD")

    def test_cloudflare_success_false_and_non_json_fail(self):
        def failure(req, timeout):
            return FakeResponse(b'{"success": false, "errors": [{"message": "sensitive"}]}')
        self.assertEqual(mod.inspect(ACCOUNT, TOKEN, failure)["R2_PREFLIGHT_BLOCKER"], "API_RESULT_NOT_CONFIRMED")
        def broken(req, timeout):
            return FakeResponse(b'<html>no')
        self.assertEqual(mod.inspect(ACCOUNT, TOKEN, broken)["R2_PREFLIGHT_BLOCKER"], "API_NOT_JSON")

    def test_oversize_response_fails_closed(self):
        def oversized(req, timeout):
            return FakeResponse(b"x" * (mod.MAX_RESPONSE_BYTES + 1))
        self.assertEqual(mod.inspect(ACCOUNT, TOKEN, oversized)["R2_PREFLIGHT_BLOCKER"], "API_RESPONSE_TOO_LARGE")


if __name__ == "__main__":
    unittest.main()
