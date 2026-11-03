#!/usr/bin/env python3
"""V5 Phase 1 #281/#293 — read-only live Docker incident scope (NO VALUES).

This program examines ONLY the already-present isolated staging Compose project.
It never prints any Config.Env entry, Docker history, build argument value, path,
image ID, digest, volume, container name, or credential-derived fingerprint.

Requires explicit --read-only-staging-scope. Does NOT rotate passwords, write
files, change containers, clean images, mutate infrastructure or unlock Phase 2.
Old archived Docker image copies are deliberately out of scope.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys

PROJECT = "96ffcu0jinuwlnaqxpltln4p"
SERVICES = ("nginx", "web", "migrate", "backup", "postgres", "redis", "api")
API_ONLY = (
    "JWT_ACCESS_SECRET",
    "JWT_REFRESH_SECRET",
    "SMTP_PASSWORD",
    "COMMERCIAL_DOCUMENT_ENCRYPTION_KEY",
    "PAYMENT_CREDENTIAL_ENCRYPTION_KEY",
    "RAZORPAY_KEY_SECRET",
    "RAZORPAY_WEBHOOK_SECRET",
    "LIVEKIT_API_SECRET",
    "LIVEKIT_RECORDING_S3_SECRET_ACCESS_KEY",
    "WHATSAPP_ACCESS_TOKEN",
    "AI_API_KEY",
    "TWILIO_AUTH_TOKEN",
)
IMAGE_SENSITIVE = (
    "DATABASE_URL",
    "POSTGRES_PASSWORD",
    "REDIS_PASSWORD",
    *API_ONLY,
    "AWS_SECRET_ACCESS_KEY",
    "BACKUP_AWS_SECRET_ACCESS_KEY",
)
CID = re.compile(r"^[0-9a-f]{12,64}$")
IMAGE_SHA = re.compile(r"^sha256:[0-9a-f]{64}$")
MAX_OUTPUT = 8 * 1024 * 1024


class ScopeFailure(Exception):
    pass


def docker(args: list[str]) -> str:
    # No shell=True, no log forwarding, no command metadata printing.
    try:
        result = subprocess.run(
            ["docker", *args], stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, check=False, timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise ScopeFailure("DOCKER_UNAVAILABLE")
    if result.returncode != 0 or len(result.stdout) > MAX_OUTPUT:
        raise ScopeFailure("DOCKER_INSPECTION_FAILED")
    try:
        return result.stdout.decode("utf-8", errors="strict")
    except UnicodeError:
        raise ScopeFailure("NON_UTF8_DOCKER_METADATA")


def assignment_names(values: list[str], allowed: tuple[str, ...]) -> list[str]:
    if not isinstance(values, list) or any(not isinstance(v, str) for v in values):
        raise ScopeFailure("METADATA_FORMAT_INVALID")
    found = []
    for name in allowed:
        pat = re.compile(r"(^|[^A-Za-z0-9_])" + name + r"\s*(=|:)", re.I)
        if any(pat.search(value) for value in values):
            found.append(name)
    return found


def nonempty_exact_env_names(env: list[str], allowed: tuple[str, ...]) -> list[str]:
    """Inspect only exact Docker Config.Env assignments, not names in values.

    A NAME= entry with an empty value is deliberately NOT a populated secret.
    Values never leave this function. No hashes, lengths or derived fingerprints.
    """
    if not isinstance(env, list) or any(not isinstance(x, str) for x in env):
        raise ScopeFailure("METADATA_FORMAT_INVALID")
    populated: set[str] = set()
    for item in env:
        name, delimiter, value = item.partition("=")
        if delimiter != "=" or not name:
            raise ScopeFailure("ENV_ASSIGNMENT_INVALID")
        if name in allowed and value != "":
            populated.add(name)
    return [name for name in allowed if name in populated]


def runtime_excess(env: list[str], service: str) -> list[str]:
    if service == "api":
        return []
    # Only exact, nonempty Config.Env keys are treated as populated. Values
    # cannot be printed and keys embedded in other values are ignored.
    return nonempty_exact_env_names(env, API_ONLY)


def image_excess(config: dict, lines: list[str]) -> list[str]:
    if not isinstance(config, dict) or not lines:
        raise ScopeFailure("IMAGE_CONFIG_MISSING")
    runtime = config.get("Config")
    if not isinstance(runtime, dict):
        raise ScopeFailure("IMAGE_CONFIG_INVALID")
    env = runtime.get("Env")
    labels = runtime.get("Labels") or {}
    if not isinstance(env, list) or not isinstance(labels, dict):
        raise ScopeFailure("IMAGE_METADATA_INVALID")
    label_text = [str(key) + "=" + str(val) for key, val in labels.items()]
    return assignment_names(env + label_text + lines, IMAGE_SENSITIVE)


def image_evidence(config: dict, lines: list[str]) -> dict[str, list[str]]:
    """Separate actual nonempty image Env from history/label NAME references.

    History and labels may reference shell variables or contain placeholders.
    Their key-name presence is NOT proof that a credential value is embedded.
    Never print raw Docker metadata, even on malformed inputs.
    """
    if not isinstance(config, dict) or not isinstance(lines, list) or not lines:
        raise ScopeFailure("IMAGE_CONFIG_MISSING")
    runtime = config.get("Config")
    if not isinstance(runtime, dict):
        raise ScopeFailure("IMAGE_CONFIG_INVALID")
    env = runtime.get("Env")
    labels = runtime.get("Labels") or {}
    if not isinstance(env, list) or not isinstance(labels, dict):
        raise ScopeFailure("IMAGE_METADATA_INVALID")
    if any(not isinstance(k, str) or not isinstance(v, str)
           for k, v in labels.items()):
        raise ScopeFailure("IMAGE_LABEL_FORMAT_INVALID")
    return {
        "config_env_nonempty": nonempty_exact_env_names(env, IMAGE_SENSITIVE),
        "history_key_references": assignment_names(lines, IMAGE_SENSITIVE),
        "label_key_references": assignment_names(
            [str(k) + "=" + str(v) for k, v in labels.items()], IMAGE_SENSITIVE
        ),
    }


def list_project_containers() -> dict[str, dict]:
    raw = docker([
        "ps", "-aq", "--filter",
        "label=com.docker.compose.project=" + PROJECT,
    ]).split()
    if not 1 <= len(raw) <= 12 or any(not CID.fullmatch(x) for x in raw):
        raise ScopeFailure("STAGING_INVENTORY_UNEXPECTED")
    parsed = json.loads(docker(["inspect", "--type", "container", *raw]))
    if not isinstance(parsed, list) or len(parsed) != len(raw):
        raise ScopeFailure("CONTAINER_INSPECTION_INCOMPLETE")
    found: dict[str, dict] = {}
    for item in parsed:
        if not isinstance(item, dict):
            raise ScopeFailure("INVALID_CONTAINER_CONFIG")
        labels = ((item.get("Config") or {}).get("Labels") or {})
        if labels.get("com.docker.compose.project") != PROJECT:
            raise ScopeFailure("FOREIGN_PROJECT_CONTAINER")
        service = labels.get("com.docker.compose.service")
        if service not in SERVICES or service in found:
            raise ScopeFailure("UNEXPECTED_OR_DUPLICATE_SERVICE")
        found[service] = item
    if set(found) != set(SERVICES):
        raise ScopeFailure("EXPECTED_SEVEN_SERVICES_MISSING")
    return found


def inspect_project() -> list[dict]:
    services = list_project_containers()
    results = []
    cache: dict[str, dict[str, list[str]]] = {}
    for service in SERVICES:
        item = services[service]
        env = (item.get("Config") or {}).get("Env")
        if not isinstance(env, list):
            raise ScopeFailure("CONTAINER_ENV_MISSING")
        image_id = item.get("Image")
        if not isinstance(image_id, str) or not IMAGE_SHA.fullmatch(image_id):
            raise ScopeFailure("INVALID_IMAGE_IDENTIFIER")
        if image_id not in cache:
            image_configs = json.loads(docker(["image", "inspect", image_id]))
            if not isinstance(image_configs, list) or len(image_configs) != 1:
                raise ScopeFailure("IMAGE_METADATA_MISSING")
            # No raw Docker history content is ever returned or printed.
            raw_lines = docker([
                "history", "--no-trunc", "--format",
                "{{json .CreatedBy}}", image_id,
            ]).strip().splitlines()
            if len(raw_lines) < 1 or len(raw_lines) > 2048:
                raise ScopeFailure("IMAGE_HISTORY_MISSING")
            try:
                history = [json.loads(x) for x in raw_lines]
            except ValueError:
                raise ScopeFailure("IMAGE_HISTORY_UNREADABLE")
            cache[image_id] = image_evidence(image_configs[0], history)
        results.append({
            "service": service,
            "unexpected_runtime_names": runtime_excess(env, service),
            "image_config_env_nonempty": cache[image_id]["config_env_nonempty"],
            "image_history_key_references": cache[image_id]["history_key_references"],
            "image_label_key_references": cache[image_id]["label_key_references"],
        })
    return results


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--read-only-staging-scope", action="store_true")
    args = p.parse_args()
    try:
        if not args.read_only_staging_scope:
            raise ScopeFailure("OPERATOR_SCOPE_ACK_REQUIRED")
        if os.name != "posix" or os.geteuid() != 0:
            raise ScopeFailure("AUTHORIZED_VPS_ROOT_REQUIRED")
        rows = inspect_project()
        for row in rows:
            print("SERVICE=" + row["service"])
            names = row["unexpected_runtime_names"]
            config = row["image_config_env_nonempty"]
            history = row["image_history_key_references"]
            labels = row["image_label_key_references"]
            print("API_ONLY_RUNTIME_NONEMPTY_NAMES=" + (
                ",".join(names) if names else "NONE"
            ))
            print("IMAGE_CONFIG_NONEMPTY_NAMES=" + (
                ",".join(config) if config else "NONE"
            ))
            print("IMAGE_HISTORY_KEYNAME_REFERENCES=" + (
                ",".join(history) if history else "NONE"
            ))
            print("IMAGE_LABEL_KEYNAME_REFERENCES=" + (
                ",".join(labels) if labels else "NONE"
            ))
            print("IMAGE_HISTORY_SECRET_VALUE_PRESENCE=NOT_ATTESTED")
        print("STAGING_INCIDENT_SCOPE=PASS_READ_ONLY_COMPLETE")
        print("IMAGE_LAYER_PAYLOAD_SCAN=NOT_EXECUTED")
        print("OLD_IMAGE_ARCHIVES_SCANNED=NO")
        print("POSTGRES_REDIS_ROTATED=NO")
        print("CREDENTIAL_VALUES_PRINTED=NO")
        print("DEPLOYMENT_OR_RESTART=NO")
        print("COMMERCIAL_GO=HOLD")
        return 0
    except (ScopeFailure, ValueError, TypeError, KeyError):
        print("STAGING_INCIDENT_SCOPE=CHECK_REQUIRED")
        print("CREDENTIAL_VALUES_PRINTED=NO")
        print("DEPLOYMENT_OR_RESTART=NO")
        print("COMMERCIAL_GO=HOLD")
        return 2


if __name__ == "__main__":
    sys.exit(main())
