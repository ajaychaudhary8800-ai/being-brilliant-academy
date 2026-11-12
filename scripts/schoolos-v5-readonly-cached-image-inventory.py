#!/usr/bin/env python3
"""V5 owner-operated, read-only Docker image-candidate inventory.

Only Docker CLI list/inspect with narrow Go templates is permitted. Never read
or print image history, Config.Env, mounts, labels beyond the single reviewed
revision label, image names/registry URLs, container env, customer data or keys.
Does not pull/build/save/load/run images or touch application services.
A matched revision pair is only a CANDIDATE, never trusted rollback custody.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys

PROJECT = "96ffcu0jinuwlnaqxpltln4p"
SHA = re.compile(r"[a-f0-9]{40}\Z")
IMAGE_ID = re.compile(r"sha256:[a-f0-9]{64}\Z")
CONTAINER_ID = re.compile(r"[a-f0-9]{64}\Z")
ROLES = {"api": "/workspace/apps/api", "web": "/app"}
MAX_IMAGES = 256
MAX_CONTAINERS = 32
MAX_OUTPUT = 128 * 1024
IMAGE_META = '{{.Id}}|{{if .Config.Labels}}{{index .Config.Labels "org.opencontainers.image.revision"}}{{end}}|{{.Config.WorkingDir}}'
CONTAINER_META = '{{.Image}}|{{if .Config.Labels}}{{index .Config.Labels "com.docker.compose.service"}}{{end}}|{{.State.Running}}'


class Hold(Exception):
    """Never include subprocess stderr or private metadata in this exception."""


def _call(argv):
    if not isinstance(argv, list) or not argv or argv[0] != "docker":
        raise Hold()
    try:
        completed = subprocess.run(
            argv, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            timeout=20, check=False,
        )
    except (OSError, ValueError, subprocess.TimeoutExpired):
        raise Hold() from None
    if completed.returncode != 0 or len(completed.stdout) > MAX_OUTPUT:
        raise Hold()
    try:
        return completed.stdout.decode("utf-8", errors="strict")
    except UnicodeError:
        raise Hold() from None


def _lines(raw, maximum):
    if not isinstance(raw, str) or len(raw) > MAX_OUTPUT:
        raise Hold()
    lines = raw.splitlines()
    if len(lines) > maximum or any(len(line) > 512 for line in lines):
        raise Hold()
    return [line for line in lines if line]


def _container_scope(run):
    argv = ["docker", "container", "ls", "--all", "--no-trunc",
            "--filter", f"label=com.docker.compose.project={PROJECT}",
            "--format", "{{.ID}}"]
    result = {}
    ids = _lines(run(argv), MAX_CONTAINERS)
    for cid in ids:
        if not CONTAINER_ID.fullmatch(cid):
            raise Hold()
        raw = run(["docker", "container", "inspect", "--format", CONTAINER_META, cid]).strip()
        fields = raw.split("|")
        if len(fields) != 3:
            raise Hold()
        image_id, role, running = fields
        if not IMAGE_ID.fullmatch(image_id) or running not in ("true", "false"):
            raise Hold()
        if role in ROLES and running == "true":
            if role in result:
                raise Hold()
            result[role] = image_id
    if set(result) != set(ROLES):
        raise Hold()
    return result


def _images(run):
    argv = ["docker", "image", "ls", "--no-trunc", "--format", "{{.ID}}"]
    ids = _lines(run(argv), MAX_IMAGES)
    if any(not IMAGE_ID.fullmatch(value) for value in ids):
        raise Hold()
    records = {}
    for image_id in dict.fromkeys(ids):
        raw = run(["docker", "image", "inspect", "--format", IMAGE_META, image_id]).strip()
        parts = raw.split("|")
        if len(parts) != 3 or parts[0] != image_id:
            raise Hold()
        _, sha, workdir = parts
        # Only valid Git revisions may be reported as candidate identities.
        if sha == "<no value>":
            sha = ""
        if sha and not SHA.fullmatch(sha):
            sha = ""
        role = next((name for name, expected in ROLES.items()
                     if workdir == expected), None)
        records[image_id] = (role, sha)
    return records


def inspect(run=_call):
    """Return strictly sanitized values; never infer clean source or signing."""
    live = _container_scope(run)
    images = _images(run)
    if not set(live.values()).issubset(images):
        raise Hold()
    active = {}
    for role in ROLES:
        observed_role, sha = images[live[role]]
        if observed_role != role or not sha:
            raise Hold()
        active[role] = sha
    if active["api"] != active["web"]:
        raise Hold()

    candidates = {}
    unlabelled = {name: 0 for name in ROLES}
    for image_id, (role, sha) in images.items():
        if role not in ROLES or image_id in live.values():
            continue
        if not sha:
            unlabelled[role] += 1
        elif sha != active["api"]:
            candidates.setdefault(sha, set()).add(role)
    paired = sorted(sha for sha, roles in candidates.items()
                    if roles == set(ROLES))
    return {
        "V5_STAGING_ACTIVE_API_WEB": "PASS_RUNNING_SCOPED",
        "V5_ACTIVE_REVISION_PARITY": "PASS_SOURCE_LABEL_ONLY",
        "V5_IMAGE_METADATA_INSPECTED": str(len(images)),
        "V5_POSSIBLE_DISTINCT_REVISION_PAIRS": str(len(paired)),
        "V5_POSSIBLE_SOURCE_REVISIONS": ",".join(paired) if paired else "NONE",
        "V5_UNLABELLED_API_IMAGE_CANDIDATES": str(unlabelled["api"]),
        "V5_UNLABELLED_WEB_IMAGE_CANDIDATES": str(unlabelled["web"]),
        "V5_CANDIDATE_PREVIOUS_IMAGE_PAIR": "REQUIRES_PRIVATE_SOURCE_REVIEW"
                    if paired else "NOT_EVIDENCED",
        "V5_OLD_IMAGES_CLEAN_AND_SIGNED": "NOT_VERIFIED",
        "V5_IMMUTABLE_RETRIEVAL_AND_REAL_RESTORE": "NOT_VERIFIED",
        "IMAGE_CONFIG_ENV_OR_HISTORY_READ": "NO",
        "DOCKER_IMAGE_OR_SERVICE_MUTATION": "NO",
        "DEPLOYMENT_AUTHORIZATION": "HOLD",
    }


def main():
    try:
        result = inspect()
    except Hold:
        result = {
            "V5_DOCKER_IMAGE_INVENTORY": "HOLD_UNVERIFIED",
            "IMAGE_CONFIG_ENV_OR_HISTORY_READ": "NO",
            "DOCKER_IMAGE_OR_SERVICE_MUTATION": "NO",
            "DEPLOYMENT_AUTHORIZATION": "HOLD",
        }
    for key, val in result.items():
        print(f"{key}={val}")
    return 0 if result.get("V5_STAGING_ACTIVE_API_WEB") == "PASS_RUNNING_SCOPED" else 2


if __name__ == "__main__":
    sys.exit(main())
