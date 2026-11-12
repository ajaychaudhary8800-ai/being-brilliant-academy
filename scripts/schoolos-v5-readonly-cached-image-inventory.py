#!/usr/bin/env python3
"""V5 owner-operated, read-only Docker image-candidate inventory.

Only Docker CLI list/inspect with narrow Go templates is permitted. Never read
or print image history, Config.Env, mounts, labels beyond the single reviewed
revision label, image names/registry URLs, container env, customer data or keys.
Does not pull/build/save/load/run images or touch application services.
A matched revision pair is only a CANDIDATE, never trusted rollback custody.
"""
from __future__ import annotations

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
# Some real Docker images reject the concatenated template although each
# individual metadata query succeeds. Use three isolated narrow templates.
IMAGE_ID_META = "{{.Id}}"
IMAGE_WORKDIR_META = "{{.Config.WorkingDir}}"
IMAGE_REVISION_META = '{{if .Config.Labels}}{{index .Config.Labels "org.opencontainers.image.revision"}}{{end}}'
CONTAINER_META = '{{.Image}}|{{if .Config.Labels}}{{index .Config.Labels "com.docker.compose.service"}}{{end}}|{{.State.Running}}'


class Hold(Exception):
    """Only fixed, non-sensitive diagnostic codes may be emitted."""

    def __init__(self, code="UNCLASSIFIED"):
        self.code = code
        super().__init__(code)


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
    try:
        ids = _lines(run(argv), MAX_CONTAINERS)
    except Hold:
        raise Hold("SCOPED_CONTAINER_LIST_UNAVAILABLE") from None
    if not ids:
        raise Hold("SCOPED_CONTAINERS_NOT_FOUND")
    for cid in ids:
        if not CONTAINER_ID.fullmatch(cid):
            raise Hold("CONTAINER_ID_INVALID")
        try:
            raw = run(["docker", "container", "inspect", "--format", CONTAINER_META, cid]).strip()
        except Hold:
            raise Hold("CONTAINER_METADATA_INSPECT_UNAVAILABLE") from None
        fields = raw.split("|")
        if len(fields) != 3:
            raise Hold("CONTAINER_METADATA_FORMAT_INVALID")
        image_id, role, running = fields
        if not IMAGE_ID.fullmatch(image_id) or running not in ("true", "false"):
            raise Hold("CONTAINER_IMAGE_ID_OR_STATE_INVALID")
        if role in ROLES and running == "true":
            if role in result:
                raise Hold("DUPLICATE_RUNNING_API_OR_WEB")
            result[role] = image_id
    if set(result) != set(ROLES):
        raise Hold("RUNNING_API_WEB_NOT_FOUND")
    return result


def _images(run):
    argv = ["docker", "image", "ls", "--no-trunc", "--format", "{{.ID}}"]
    try:
        ids = _lines(run(argv), MAX_IMAGES)
    except Hold:
        raise Hold("IMAGE_LIST_UNAVAILABLE") from None
    if any(not IMAGE_ID.fullmatch(value) for value in ids):
        raise Hold("IMAGE_LIST_ID_INVALID")
    records = {}
    for image_id in dict.fromkeys(ids):
        fields = []
        for field_format in (IMAGE_ID_META, IMAGE_WORKDIR_META, IMAGE_REVISION_META):
            try:
                raw = run([
                    "docker", "image", "inspect", "--format", field_format, image_id
                ]).strip()
            except Hold:
                raise Hold("IMAGE_METADATA_INSPECT_UNAVAILABLE") from None
            # A single metadata field must not contain delimiters or embedded
            # newlines. Never print invalid/malformed values.
            if "|" in raw or "\n" in raw or "\r" in raw or len(raw) > 512:
                raise Hold("IMAGE_METADATA_FORMAT_INVALID")
            fields.append(raw)
        observed_id, workdir, sha = fields
        if observed_id != image_id:
            raise Hold("IMAGE_METADATA_FORMAT_INVALID")
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
        raise Hold("ACTIVE_IMAGE_NOT_IN_LOCAL_IMAGE_LIST")
    active = {}
    for role in ROLES:
        observed_role, sha = images[live[role]]
        if observed_role != role:
            raise Hold("ACTIVE_IMAGE_WORKDIR_MISMATCH")
        if not sha:
            raise Hold("ACTIVE_IMAGE_REVISION_LABEL_MISSING")
        active[role] = sha
    if active["api"] != active["web"]:
        raise Hold("ACTIVE_API_WEB_REVISION_MISMATCH")

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
    except Hold as error:
        result = {
            "V5_DOCKER_IMAGE_INVENTORY": "HOLD_UNVERIFIED",
            "V5_INVENTORY_BLOCKER": error.code,
            "IMAGE_CONFIG_ENV_OR_HISTORY_READ": "NO",
            "DOCKER_IMAGE_OR_SERVICE_MUTATION": "NO",
            "DEPLOYMENT_AUTHORIZATION": "HOLD",
        }
    for key, val in result.items():
        print(f"{key}={val}")
    return 0 if result.get("V5_STAGING_ACTIVE_API_WEB") == "PASS_RUNNING_SCOPED" else 2


if __name__ == "__main__":
    sys.exit(main())
