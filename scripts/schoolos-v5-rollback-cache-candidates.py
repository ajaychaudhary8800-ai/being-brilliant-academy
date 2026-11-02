#!/usr/bin/env python3
"""Read-only, values-free V5 staging Docker cache rollback *candidate* inventory.

Purpose: find whether older API/Web objects could warrant a restricted
compatibility rehearsal, without assuming the 2026-10-30 strict workdir/label
scan is exhaustive. Scans metadata in memory; NEVER prints image IDs, names,
tags, labels, source SHAs, raw metadata, history, credentials, paths or URLs.
No image pull/export/load, service restarts, DB writes or migrations.
A candidate is NOT a retrievable, trusted or rollback-safe OCI artifact.
"""
from __future__ import annotations
import argparse
import json
import os
import re
import subprocess
import sys

PROJECT = "96ffcu0jinuwlnaqxpltln4p"
ROLES = ("api", "web")
ALL_SERVICES = {"api", "web", "migrate", "nginx", "backup", "redis", "postgres"}
SHA = re.compile(r"^sha256:[a-f0-9]{64}$")
REVISION = re.compile(r"^[a-f0-9]{40}$")
MAX_IMAGES = 256
MAX_JSON_BYTES = 30 * 1024 * 1024


class InventoryRefused(Exception):
    pass


def docker(args):
    if os.name != "posix":
        raise InventoryRefused("LINUX_DOCKER_ONLY")
    try:
        response = subprocess.run(
            ["docker", *args], stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, check=False, timeout=90,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise InventoryRefused("READ_ONLY_DOCKER_UNAVAILABLE")
    if response.returncode or len(response.stdout) > MAX_JSON_BYTES:
        raise InventoryRefused("READ_ONLY_DOCKER_INSPECTION_FAILED")
    try:
        return response.stdout.decode("utf-8", errors="strict")
    except UnicodeError:
        raise InventoryRefused("METADATA_ENCODING_INVALID")


def target_images():
    ids = docker([
        "ps", "-aq", "--filter",
        "label=com.docker.compose.project=" + PROJECT,
    ]).split()
    if not 1 <= len(ids) <= 12 or any(not re.fullmatch(r"[a-f0-9]{12,64}", x) for x in ids):
        raise InventoryRefused("PROJECT_CONTAINER_COUNT_INVALID")
    rows = json.loads(docker(["inspect", "--type", "container", *ids]))
    if not isinstance(rows, list) or len(rows) != len(ids):
        raise InventoryRefused("PROJECT_CONTAINER_INSPECTION_INVALID")
    services = {}
    for row in rows:
        config = row.get("Config", {})
        labels = config.get("Labels", {})
        if labels.get("com.docker.compose.project") != PROJECT:
            raise InventoryRefused("FOREIGN_PROJECT_REFUSED")
        service = labels.get("com.docker.compose.service")
        if service not in ALL_SERVICES or service in services:
            raise InventoryRefused("SERVICE_SCOPE_MISMATCH")
        image = row.get("Image")
        if not isinstance(image, str) or not SHA.fullmatch(image):
            raise InventoryRefused("IMAGE_ID_INVALID")
        services[service] = image
    if set(services) != ALL_SERVICES:
        raise InventoryRefused("SEVEN_SERVICE_INVENTORY_MISMATCH")
    return {role: services[role] for role in ROLES}


def image_role(row):
    if not isinstance(row, dict):
        raise InventoryRefused("INVALID_IMAGE_METADATA")
    conf = row.get("Config", {})
    if not isinstance(conf, dict):
        raise InventoryRefused("IMAGE_CONFIG_MISSING")
    working = conf.get("WorkingDir", "")
    cmd = conf.get("Cmd") or []
    entry = conf.get("Entrypoint") or []
    if not isinstance(working, str) or not isinstance(cmd, list) or not isinstance(entry, list):
        raise InventoryRefused("IMAGE_COMMAND_METADATA_MALFORMED")
    if any(not isinstance(x, str) for x in [*cmd, *entry]):
        raise InventoryRefused("IMAGE_COMMAND_METADATA_INVALID")
    cmdtext = " ".join([*cmd, *entry]).lower()
    if working == "/workspace/apps/api" and (
        "start-production.mjs" in cmdtext or "bba-api-entrypoint" in cmdtext
    ):
        return "api"
    if working == "/app" and "apps/web/server.js" in cmdtext:
        return "web"
    return None


def source_revision(row):
    labels = row.get("Config", {}).get("Labels") or {}
    if not isinstance(labels, dict):
        raise InventoryRefused("IMAGE_REVISION_LABELS_INVALID")
    rev = labels.get("org.opencontainers.image.revision")
    return rev if isinstance(rev, str) and REVISION.fullmatch(rev) else None


def evaluate(images, active):
    if not isinstance(images, list) or not 1 <= len(images) <= MAX_IMAGES:
        raise InventoryRefused("INVALID_IMAGE_LIST")
    if set(active) != set(ROLES) or any(not SHA.fullmatch(x) for x in active.values()):
        raise InventoryRefused("ACTIVE_IMAGE_SET_INVALID")
    seen = set()
    image_by_id = {}
    for row in images:
        image_id = row.get("Id") if isinstance(row, dict) else None
        if not isinstance(image_id, str) or not SHA.fullmatch(image_id):
            raise InventoryRefused("IMAGE_ID_INVALID")
        if image_id in seen:
            raise InventoryRefused("DUPLICATE_IMAGE_ID")
        seen.add(image_id)
        image_by_id[image_id] = row
    if not all(x in image_by_id for x in active.values()):
        raise InventoryRefused("CURRENT_IMAGE_NOT_IN_CACHE")
    current_rev = {
        role: source_revision(image_by_id[image_id])
        for role, image_id in active.items()
    }
    clean = {role: set() for role in ROLES}
    unlabelled = {role: 0 for role in ROLES}
    for image_id, row in image_by_id.items():
        role = image_role(row)
        if role not in ROLES or image_id == active[role]:
            continue
        rev = source_revision(row)
        if not rev:
            unlabelled[role] += 1
        elif rev not in current_rev.values():
            clean[role].add(rev)
    return {
        "images_scanned": len(images),
        "unlabelled": unlabelled,
        "older_labelled": {role: len(clean[role]) for role in ROLES},
        "paired_revisions": len(clean["api"] & clean["web"]),
    }


def inventory():
    active = target_images()
    ids = docker(["image", "ls", "-q", "--no-trunc"]).split()
    ids = sorted(set(ids))
    if not 1 <= len(ids) <= MAX_IMAGES or any(not SHA.fullmatch(x) for x in ids):
        raise InventoryRefused("CACHED_IMAGE_LIST_INVALID")
    images = []
    for offset in range(0, len(ids), 16):
        subset = json.loads(docker(["image", "inspect", *ids[offset:offset + 16]]))
        if not isinstance(subset, list) or len(subset) != len(ids[offset:offset + 16]):
            raise InventoryRefused("IMAGE_INSPECTION_PARTIAL")
        images.extend(subset)
    return evaluate(images, active)


def main(args=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--read-only-v5-rollback-cache", action="store_true")
    a = parser.parse_args(args)
    try:
        if not a.read_only_v5_rollback_cache:
            raise InventoryRefused("OWNER_SCOPE_REQUIRED")
        if os.name != "posix" or os.geteuid() != 0:
            raise InventoryRefused("STAGING_LINUX_ROOT_REQUIRED")
        result = inventory()
        print("CACHED_IMAGES_INSPECTED=" + str(result["images_scanned"]))
        for role in ROLES:
            print(role.upper() + "_OLDER_LABELLED_REVISIONS=" + str(
                result["older_labelled"][role]
            ))
            print(role.upper() + "_UNLABELLED_POSSIBLE_IMAGES=" + str(
                result["unlabelled"][role]
            ))
        print("API_WEB_COMMON_OLDER_REVISION_CANDIDATES=" + str(
            result["paired_revisions"]
        ))
        print("ROLLBACK_CACHE_INVENTORY=PASS_READ_ONLY_CANDIDATES_ONLY")
        print("IMAGE_SECRET_VALUES_PRINTED=NO")
        print("RETRIEVABLE_SIGNED_ROLLBACK=NOT_ATTESTED")
        print("DATABASE_BACKWARD_COMPATIBILITY=NOT_VERIFIED")
        print("STAGING_AND_PRODUCTION_CHANGED=NO")
        print("DEPLOYMENT_AUTHORIZATION=HOLD")
        return 0
    except (InventoryRefused, OSError, ValueError, TypeError, KeyError):
        print("ROLLBACK_CACHE_INVENTORY=CHECK_REQUIRED")
        print("IMAGE_SECRET_VALUES_PRINTED=NO")
        print("STAGING_AND_PRODUCTION_CHANGED=NO")
        print("DEPLOYMENT_AUTHORIZATION=HOLD")
        return 2


if __name__ == "__main__":
    sys.exit(main())
