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


    def test_blank_optional_api_only_keys_are_not_false_positive_exposure(self):
        env = [
            "JWT_ACCESS_SECRET=", "JWT_REFRESH_SECRET=", "SMTP_PASSWORD=",
            "RAZORPAY_WEBHOOK_SECRET=", "COMMERCIAL_DOCUMENT_ENCRYPTION_KEY=",
            "DATABASE_URL=synthetic_nonsecret",
        ]
        for service in SCOPE.SERVICES:
            with self.subTest(service=service):
                self.assertEqual(SCOPE.runtime_excess(env, service), [])

    def test_exact_nonempty_key_only_and_no_substring_match(self):
        synthetic = "do-not-print-this-synthetic-placeholder"
        env = [
            "OTHER_JWT_ACCESS_SECRET=" + synthetic,
            "NOT_CREDENTIAL=JWT_ACCESS_SECRET=" + synthetic,
            "jwt_access_secret=" + synthetic,
            "JWT_ACCESS_SECRET=",
            "LIVEKIT_API_SECRET=" + synthetic,
        ]
        self.assertEqual(SCOPE.runtime_excess(env, "migrate"), ["LIVEKIT_API_SECRET"])
        self.assertNotIn(synthetic, repr(SCOPE.runtime_excess(env, "migrate")))

    def test_duplicate_assignments_consider_nonempty_value(self):
        self.assertEqual(SCOPE.runtime_excess(
            ["RAZORPAY_KEY_SECRET=", "RAZORPAY_KEY_SECRET=synthetic"],
            "backup"
        ), ["RAZORPAY_KEY_SECRET"])

    def test_extra_api_private_keys_cannot_be_in_other_service(self):
        synthetic = "opaque-only-restricted-value"
        env = [
            "WEB_PUSH_PRIVATE_KEY=" + synthetic,
            "AWS_SECRET_ACCESS_KEY=" + synthetic,
            "METRICS_TOKEN=" + synthetic,
        ]
        self.assertEqual(SCOPE.runtime_excess(env, "nginx"), [
            "WEB_PUSH_PRIVATE_KEY", "AWS_SECRET_ACCESS_KEY", "METRICS_TOKEN",
        ])
        self.assertNotIn(synthetic, repr(SCOPE.runtime_excess(env, "nginx")))

    def test_malformed_container_environment_fails_closed(self):
        for entries in (None, "not-an-array", ["JWT_ACCESS_SECRET"], [None], [False]):
            with self.subTest(variant=repr(entries)):
                with self.assertRaises(SCOPE.ScopeFailure):
                    SCOPE.runtime_excess(entries, "web")

    def test_stopped_migrate_is_included_in_nonempty_secret_detection(self):
        containers = {}
        secret = "synthetic-sensitive-migrate-value"
        image_id = "sha256:" + "a" * 64
        for service in SCOPE.SERVICES:
            entries = ["JWT_ACCESS_SECRET=", "RAZORPAY_WEBHOOK_SECRET="]
            if service == "migrate":
                entries.append("JWT_ACCESS_SECRET=" + secret)
            containers[service] = {"Config": {"Env": entries}, "Image": image_id}
        def fake_docker(args):
            if args[:2] == ["image", "inspect"]:
                return json.dumps([{"Config": {"Env": ["NODE_ENV=production"],
                                               "Labels": {}}}])
            if args[:2] == ["history", "--no-trunc"]:
                return json.dumps("RUN synthetic-safe") + "\n"
            raise AssertionError("Unexpected Docker invocation")
        with patch.object(SCOPE, "list_project_containers", return_value=containers), \
             patch.object(SCOPE, "docker", side_effect=fake_docker):
            rows = SCOPE.inspect_project()
        by_service = {row["service"]: row for row in rows}
        self.assertEqual(by_service["migrate"]["unexpected_runtime_names"],
                         ["JWT_ACCESS_SECRET"])
        for service in set(SCOPE.SERVICES) - {"migrate"}:
            self.assertEqual(by_service[service]["unexpected_runtime_names"], [])
        self.assertNotIn(secret, repr(rows))


if __name__ == "__main__":
    main()
