"""Synthetic-only V5 rollback cached-image candidate introspection tests."""
import contextlib
import importlib.util
import io
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "v5_rollback_cache",
    Path(__file__).with_name("schoolos-v5-rollback-cache-candidates.py"),
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

def image(role, rev=None, idx=1):
    working = "/workspace/apps/api" if role == "api" else "/app"
    cmd = ["node", "scripts/start-production.mjs"] if role == "api" else [
        "node", "apps/web/server.js",
    ]
    return {
        "Id": "sha256:" + format(idx, "064x"),
        "Config": {
            "WorkingDir": working, "Cmd": cmd, "Entrypoint": ["tini"],
            "Env": ["DATABASE_URL=never-output-test-value"],
            "Labels": {"org.opencontainers.image.revision": rev}
                if rev is not None else {},
        },
    }

class CachedRollbackCandidates(unittest.TestCase):
    def setUp(self):
        self.current_api = image("api", "a" * 40, 11)
        self.current_web = image("web", "a" * 40, 12)
        self.active = {
            "api": self.current_api["Id"], "web": self.current_web["Id"]
        }

    def test_valid_same_revision_pair_is_only_possible_candidate(self):
        data = [
            self.current_api, self.current_web,
            image("api", "b" * 40, 13),
            image("web", "b" * 40, 14),
            image("api", "c" * 40, 15),
            image("web", None, 16),
        ]
        r = MODULE.evaluate(data, self.active)
        self.assertEqual(r["paired_revisions"], 1)
        self.assertEqual(r["older_labelled"]["api"], 2)
        self.assertEqual(r["older_labelled"]["web"], 1)
        self.assertEqual(r["unlabelled"]["web"], 1)
        self.assertNotIn("never-output-test-value", repr(r))
        self.assertNotIn("b" * 40, repr(r))

    def test_unmatched_old_revision_not_treated_as_pair(self):
        data = [
            self.current_api, self.current_web,
            image("api", "b" * 40, 13),
            image("web", "c" * 40, 14),
        ]
        self.assertEqual(MODULE.evaluate(data, self.active)["paired_revisions"], 0)

    def test_unlabelled_and_nonapp_images_do_not_attest_rollback(self):
        other = image("web", "f" * 40, 13)
        other["Config"]["WorkingDir"] = "/other"
        data = [
            self.current_api, self.current_web,
            image("api", None, 14), image("web", None, 15), other,
        ]
        r = MODULE.evaluate(data, self.active)
        self.assertEqual(r["paired_revisions"], 0)
        self.assertEqual(r["unlabelled"], {"api": 1, "web": 1})

    def test_malformed_and_duplicate_images_fail_closed(self):
        with self.assertRaises(MODULE.InventoryRefused):
            MODULE.evaluate([self.current_api, self.current_api,
                             self.current_web], self.active)
        with self.assertRaises(MODULE.InventoryRefused):
            MODULE.evaluate([self.current_api], self.active)
        with self.assertRaises(MODULE.InventoryRefused):
            MODULE.evaluate([self.current_api, self.current_web,
                             {"Id": "unsafe"}], self.active)

    def test_no_ack_never_issues_docker_call(self):
        with patch.object(MODULE, "inventory") as inv, \
             contextlib.redirect_stdout(io.StringIO()) as buf:
            self.assertEqual(MODULE.main([]), 2)
            inv.assert_not_called()
        self.assertIn("ROLLBACK_CACHE_INVENTORY=CHECK_REQUIRED", buf.getvalue())
        self.assertNotIn("never-output-test-value", buf.getvalue())

    def test_stdout_only_counts_even_if_private_metadata_present(self):
        summary = MODULE.evaluate([
            self.current_api, self.current_web,
            image("api", "b" * 40, 13),
            image("web", "b" * 40, 14),
        ], self.active)
        with patch.object(MODULE, "inventory", return_value=summary), \
             patch.object(MODULE.os, "name", "posix"), \
             patch.object(MODULE.os, "geteuid", return_value=0), \
             contextlib.redirect_stdout(io.StringIO()) as buf:
            self.assertEqual(
                MODULE.main(["--read-only-v5-rollback-cache"]), 0)
        output = buf.getvalue()
        self.assertIn("API_WEB_COMMON_OLDER_REVISION_CANDIDATES=1", output)
        self.assertIn("RETRIEVABLE_SIGNED_ROLLBACK=NOT_ATTESTED", output)
        self.assertIn("DEPLOYMENT_AUTHORIZATION=HOLD", output)
        self.assertNotIn("never-output-test-value", output)
        self.assertNotIn("b" * 40, output)

if __name__ == "__main__":
    unittest.main()
