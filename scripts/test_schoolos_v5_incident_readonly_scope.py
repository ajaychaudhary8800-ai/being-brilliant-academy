"""Synthetic-only #281/#293 values-free incident scoping unit tests."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
from unittest import TestCase, main
from unittest.mock import patch
import types

SCRIPT = Path(__file__).with_name("schoolos-v5-incident-readonly-scope.py")
SPEC = importlib.util.spec_from_file_location("v5_incident_scope", SCRIPT)
SCOPE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SCOPE)


class StagingIncidentScopeTests(TestCase):
    def test_api_only_in_non_api_service_is_detected_by_name(self):
        env = [
            "JWT_ACCESS_SECRET=synthetic-secret-value",
            "COMMERCIAL_DOCUMENT_ENCRYPTION_KEY=synthetic-vault-value",
            "NODE_ENV=production",
        ]
        self.assertEqual(
            SCOPE.runtime_excess(env, "web"),
            ["JWT_ACCESS_SECRET", "COMMERCIAL_DOCUMENT_ENCRYPTION_KEY"]
        )
        self.assertEqual(SCOPE.runtime_excess(env, "api"), [])

    def test_postgres_redis_expected_runtime_variables_not_reported(self):
        env = [
            "POSTGRES_PASSWORD=synthetic-db",
            "DATABASE_URL=postgresql://synthetic-user:synthetic-db@host:5432/db",
            "REDIS_PASSWORD=synthetic-redis",
        ]
        self.assertEqual(SCOPE.runtime_excess(env, "postgres"), [])
        self.assertEqual(SCOPE.runtime_excess(env, "backup"), [])

    def test_image_history_injected_build_args_veto(self):
        config = {"Config": {"Env": ["NODE_ENV=production"], "Labels": {}}}
        history = [
            "RUN |57 DATABASE_URL=postgres://synthetic:synthetic@host/v5 "
            "POSTGRES_PASSWORD=synthetic-db REDIS_PASSWORD=synthetic-cache "
            "COMMERCIAL_DOCUMENT_ENCRYPTION_KEY=synthetic-vault pnpm build"
        ]
        found = SCOPE.image_excess(config, history)
        self.assertEqual(found, [
            "DATABASE_URL", "POSTGRES_PASSWORD", "REDIS_PASSWORD",
            "COMMERCIAL_DOCUMENT_ENCRYPTION_KEY",
        ])
        self.assertNotIn("synthetic-db", repr(found))
        self.assertNotIn("synthetic-vault", repr(found))

    def test_invalid_images_fail_closed(self):
        with self.assertRaises(SCOPE.ScopeFailure):
            SCOPE.image_excess({}, ["a"])
        with self.assertRaises(SCOPE.ScopeFailure):
            SCOPE.image_excess({"Config": {"Env": [], "Labels": {}}}, [])
        with self.assertRaises(SCOPE.ScopeFailure):
            SCOPE.assignment_names([None], SCOPE.IMAGE_SENSITIVE)

    def test_synthetic_project_inventory_no_metadata_values_printed(self):
        project = SCOPE.PROJECT
        container_id = "c" * 64
        image_id = "sha256:" + "b" * 64
        containers = []
        for service in SCOPE.SERVICES:
            containers.append({
                "Config": {
                    "Env": (
                        ["JWT_ACCESS_SECRET=synthetic-credential"]
                        if service == "web" else ["NODE_ENV=production"]
                    ),
                    "Labels": {
                        "com.docker.compose.project": project,
                        "com.docker.compose.service": service,
                    }
                },
                "Image": image_id,
            })
        image_config = [{
            "Config": {"Env": ["NODE_ENV=production"], "Labels": {}}
        }]
        requests = []
        def fake_docker(args):
            requests.append(args)
            if args[:2] == ["ps", "-aq"]:
                return "\n".join([
                    format(i + 1, "012x") for i in range(7)
                ])
            if args[:2] == ["inspect", "--type"]:
                return json.dumps(containers)
            if args[:2] == ["image", "inspect"]:
                return json.dumps(image_config)
            if args[:2] == ["history", "--no-trunc"]:
                return json.dumps("RUN /bin/sh -c harmless build") + "\n"
            raise AssertionError("unexpected docker args")
        with patch.object(SCOPE, "docker", side_effect=fake_docker):
            rows = SCOPE.inspect_project()
        self.assertEqual(len(rows), 7)
        self.assertEqual(
            [x["unexpected_runtime_names"] for x in rows if x["service"] == "web"],
            [["JWT_ACCESS_SECRET"]],
        )
        self.assertEqual(sum(1 for a in requests if a[:2] == ["image", "inspect"]), 1)

    def test_no_ack_no_operations_or_secret_output(self):
        with patch("sys.argv", ["v5-incident"]), \
             patch.object(SCOPE, "inspect_project") as inspect, \
             contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(SCOPE.main(), 2)
            inspect.assert_not_called()
        self.assertIn("STAGING_INCIDENT_SCOPE=CHECK_REQUIRED", output.getvalue())
        self.assertNotIn("synthetic-credential", output.getvalue())


if __name__ == "__main__":
    main()
