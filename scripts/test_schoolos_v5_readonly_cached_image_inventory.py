"""Strictly synthetic Docker CLI regression for read-only V5 image candidate inventory."""
from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest

SCRIPT = Path(__file__).with_name("schoolos-v5-readonly-cached-image-inventory.py")
spec = importlib.util.spec_from_file_location("v5_cached_inventory", SCRIPT)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

A, W, OA, OW = ["sha256:" + s * 64 for s in "abcd"]
CA, CW = ["1" * 64, "2" * 64]
CURRENT, OLDER = "0" * 40, "1" * 40


class MockDocker:
    def __init__(self):
        self.containers = {
            CA: [A, "api", "true"],
            CW: [W, "web", "true"],
        }
        self.images = {
            A: [CURRENT, mod.ROLES["api"]],
            W: [CURRENT, mod.ROLES["web"]],
            OA: [OLDER, mod.ROLES["api"]],
            OW: [OLDER, mod.ROLES["web"]],
        }
        self.commands = []

    def __call__(self, argv):
        self.commands.append(list(argv))
        assert argv[0] == "docker"
        assert not any(flag in argv for flag in (
            "run", "pull", "push", "save", "load", "build", "history",
            "rmi", "rm", "stop", "start", "restart", "exec", "prune"
        ))
        if argv[:3] == ["docker", "container", "ls"]:
            assert f"label=com.docker.compose.project={mod.PROJECT}" in argv
            return "\n".join(self.containers) + "\n"
        if argv[:3] == ["docker", "container", "inspect"]:
            assert argv[4] == mod.CONTAINER_META
            return "|".join(self.containers[argv[-1]]) + "\n"
        if argv[:3] == ["docker", "image", "ls"]:
            return "\n".join(self.images) + "\n"
        if argv[:3] == ["docker", "image", "inspect"]:
            assert argv[4] == mod.IMAGE_META
            key = argv[-1]
            return "|".join([key] + self.images[key]) + "\n"
        raise AssertionError("unreviewed Docker operation")


class OfflineInventoryTests(unittest.TestCase):
    def setUp(self):
        self.docker = MockDocker()

    def test_scoped_running_container_and_distinct_revision_pair(self):
        result = mod.inspect(self.docker)
        self.assertEqual(result["V5_STAGING_ACTIVE_API_WEB"], "PASS_RUNNING_SCOPED")
        self.assertEqual(result["V5_POSSIBLE_DISTINCT_REVISION_PAIRS"], "1")
        self.assertEqual(result["V5_POSSIBLE_SOURCE_REVISIONS"], OLDER)
        self.assertEqual(result["V5_OLD_IMAGES_CLEAN_AND_SIGNED"], "NOT_VERIFIED")
        self.assertEqual(result["DEPLOYMENT_AUTHORIZATION"], "HOLD")

    def test_only_one_previous_role_is_not_a_pair(self):
        del self.docker.images[OW]
        result = mod.inspect(self.docker)
        self.assertEqual(result["V5_POSSIBLE_DISTINCT_REVISION_PAIRS"], "0")
        self.assertEqual(result["V5_CANDIDATE_PREVIOUS_IMAGE_PAIR"], "NOT_EVIDENCED")

    def test_different_previous_revisions_are_not_a_pair(self):
        self.docker.images[OW][0] = "2" * 40
        self.assertEqual(mod.inspect(self.docker)["V5_POSSIBLE_DISTINCT_REVISION_PAIRS"], "0")

    def test_unlabelled_possible_web_is_not_a_valid_pair(self):
        self.docker.images[OW][0] = ""
        result = mod.inspect(self.docker)
        self.assertEqual(result["V5_UNLABELLED_WEB_IMAGE_CANDIDATES"], "1")
        self.assertEqual(result["V5_POSSIBLE_DISTINCT_REVISION_PAIRS"], "0")

    def test_untrusted_build_label_cannot_enter_stdout(self):
        self.docker.images[OW][0] = "DATABASE_PASSWORD=NEVER_ECHO"
        result = mod.inspect(self.docker)
        self.assertNotIn("NEVER_ECHO", str(result))
        self.assertEqual(result["V5_UNLABELLED_WEB_IMAGE_CANDIDATES"], "1")

    def test_same_source_as_running_pair_does_not_qualify(self):
        self.docker.images[OA][0] = CURRENT
        self.docker.images[OW][0] = CURRENT
        self.assertEqual(mod.inspect(self.docker)["V5_POSSIBLE_DISTINCT_REVISION_PAIRS"], "0")

    def test_missing_running_service_fails_closed(self):
        self.docker.containers.pop(CW)
        with self.assertRaises(mod.Hold):
            mod.inspect(self.docker)

    def test_stopped_service_does_not_count_as_live(self):
        self.docker.containers[CW][2] = "false"
        with self.assertRaises(mod.Hold):
            mod.inspect(self.docker)

    def test_duplicate_running_api_services_fails_closed(self):
        self.docker.containers["3" * 64] = [A, "api", "true"]
        with self.assertRaises(mod.Hold):
            mod.inspect(self.docker)

    def test_live_revision_drift_fails_closed(self):
        self.docker.images[W][0] = "8" * 40
        with self.assertRaises(mod.Hold):
            mod.inspect(self.docker)

    def test_live_workdir_drift_fails_closed(self):
        self.docker.images[W][1] = "/wrong"
        with self.assertRaises(mod.Hold):
            mod.inspect(self.docker)

    def test_invalid_image_id_fails_closed(self):
        self.docker.images["unexpected-image-identifier"] = [OLDER, mod.ROLES["web"]]
        with self.assertRaises(mod.Hold):
            mod.inspect(self.docker)

    def test_extra_fields_do_not_appear_in_result(self):
        self.docker.images[OA][1] += "|secret"
        with self.assertRaises(mod.Hold):
            mod.inspect(self.docker)

    def test_invalid_container_id_fails_closed(self):
        self.docker.containers["malformed"] = [A, "api", "true"]
        with self.assertRaises(mod.Hold):
            mod.inspect(self.docker)

    def test_bounded_image_count_fails_closed(self):
        for i in range(mod.MAX_IMAGES + 1):
            self.docker.images["sha256:" + format(i, "064x")] = [OLDER, "/none"]
        with self.assertRaises(mod.Hold):
            mod.inspect(self.docker)

    def test_non_schoolos_container_service_ignored(self):
        self.docker.containers["4" * 64] = [A, "backup", "true"]
        self.assertEqual(mod.inspect(self.docker)["V5_POSSIBLE_DISTINCT_REVISION_PAIRS"], "1")

    def test_duplicate_image_id_in_ls_is_inspected_once(self):
        original = self.docker

        def duplicated(argv):
            raw = original(argv)
            if argv[:3] == ["docker", "image", "ls"]:
                return raw + OA + "\n"
            return raw

        self.assertEqual(mod.inspect(duplicated)["V5_IMAGE_METADATA_INSPECTED"], "4")

    def test_all_docker_actions_are_read_only_and_scope_checked(self):
        mod.inspect(self.docker)
        self.assertTrue(self.docker.commands)
        for command in self.docker.commands:
            self.assertIn(command[1], ("container", "image"))
            self.assertIn(command[2], ("ls", "inspect"))
            self.assertNotIn("Config.Env", " ".join(command))
            self.assertNotIn("History", " ".join(command))

    def test_empty_docker_inventory_fails_closed(self):
        self.docker.images = {}
        with self.assertRaises(mod.Hold):
            mod.inspect(self.docker)


if __name__ == "__main__":
    unittest.main()
