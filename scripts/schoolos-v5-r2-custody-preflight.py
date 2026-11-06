#!/usr/bin/env python3
"""Read-only, fail-closed Cloudflare R2 rollback-custody configuration preflight.

This checks public-domain exposure and a narrow retention rule via the
Cloudflare CONTROL-PLANE API. It never creates buckets, uploads images, reads
objects, changes lock rules, rotates secrets, or authorizes a release.

Use a read-only, narrowly scoped Cloudflare API token from the environment;
never supply it on the command line or paste it into a GitHub issue/log.
"""
from __future__ import annotations

import json
import math
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

BUCKET = "schoolos-v5-rollback-custody"
LOCK_PREFIX = "v5-rollback/"
MIN_RETENTION_SECONDS = 90 * 24 * 60 * 60
MAX_RESPONSE_BYTES = 128 * 1024
ACCOUNT_ID_RE = re.compile(r"[0-9a-fA-F]{32}\Z")


class PreflightError(Exception):
    """Sensitive input and remote error detail must not reach stdout."""


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _read_control_plane(path: str, account_id: str, api_token: str, open_request):
    request = Request(
        f"https://api.cloudflare.com/client/v4/accounts/{account_id}/r2/buckets/{BUCKET}{path}",
        headers={"Authorization": f"Bearer {api_token}", "Accept": "application/json"},
        method="GET",
    )
    try:
        with open_request(request, timeout=10) as response:
            if response.status != 200:
                raise PreflightError("API_STATUS")
            raw = response.read(MAX_RESPONSE_BYTES + 1)
    except (HTTPError, URLError, OSError, TimeoutError, ValueError):
        # Never include URL, request, account ID, token or response body.
        raise PreflightError("API_UNAVAILABLE") from None
    if len(raw) > MAX_RESPONSE_BYTES:
        raise PreflightError("API_RESPONSE_TOO_LARGE")
    try:
        envelope = json.loads(raw)
    except (UnicodeError, ValueError):
        raise PreflightError("API_NOT_JSON") from None
    if not isinstance(envelope, dict) or envelope.get("success") is not True:
        raise PreflightError("API_RESULT_NOT_CONFIRMED")
    result = envelope.get("result")
    if not isinstance(result, dict):
        raise PreflightError("API_RESULT_INVALID")
    return result


def _locked_for_minimum_age(rules, now: datetime | None = None):
    """Accept only documented effective locks applying to every rollback object.

    Cloudflare permits a missing prefix for a bucket-wide rule and a Date
    condition (absolute UTC end of retention), in addition to Age/Indefinite.
    Unknown/malformed conditions never satisfy the release-preflight check.
    """
    if not isinstance(rules, list):
        return False
    current_time = datetime.now(timezone.utc) if now is None else now
    if current_time.tzinfo is None or current_time.utcoffset() is None:
        return False
    threshold = current_time.astimezone(timezone.utc) + timedelta(seconds=MIN_RETENTION_SECONDS)
    for rule in rules:
        if not isinstance(rule, dict) or rule.get("enabled") is not True:
            continue
        # Absent prefix covers the entire bucket per Cloudflare R2 API.
        # A present null/unknown prefix is malformed and must fail closed.
        if "prefix" in rule and rule["prefix"] not in ("", LOCK_PREFIX):
            continue
        condition = rule.get("condition")
        if not isinstance(condition, dict):
            continue
        if condition.get("type") == "Indefinite":
            return True
        if condition.get("type") == "Age":
            age = condition.get("maxAgeSeconds")
            if type(age) in (int, float) and math.isfinite(age) and age >= MIN_RETENTION_SECONDS:
                return True
        if condition.get("type") == "Date":
            date_value = condition.get("date")
            if not isinstance(date_value, str):
                continue
            try:
                expiry = datetime.fromisoformat(date_value.replace("Z", "+00:00"))
            except ValueError:
                continue
            if expiry.tzinfo is not None and expiry.utcoffset() is not None and expiry >= threshold:
                return True
    return False


def inspect(account_id: str | None, api_token: str | None, open_request=None) -> dict[str, str]:
    """Return only sanitized statuses. Every missing/uncertain field fails closed."""
    result = {
        "R2_BUCKET_EXISTS": "CHECK_REQUIRED",
        "R2_MANAGED_PUBLIC_DOMAIN": "CHECK_REQUIRED",
        "R2_CUSTOM_PUBLIC_DOMAINS": "CHECK_REQUIRED",
        "R2_ROLLBACK_PREFIX_LOCK": "CHECK_REQUIRED",
        "R2_PRIVATE_CONFIG_PREFLIGHT": "HOLD",
    }
    if not isinstance(account_id, str) or not ACCOUNT_ID_RE.fullmatch(account_id):
        result["R2_PREFLIGHT_BLOCKER"] = "CLOUDFLARE_ACCOUNT_ID_UNAVAILABLE"
        return result
    if not isinstance(api_token, str) or not api_token.strip():
        result["R2_PREFLIGHT_BLOCKER"] = "CLOUDFLARE_API_TOKEN_UNAVAILABLE"
        return result
    opener = open_request or build_opener(_NoRedirect()).open
    try:
        bucket = _read_control_plane("", account_id, api_token, opener)
        if bucket.get("name") != BUCKET:
            raise PreflightError("BUCKET_MISMATCH")
        result["R2_BUCKET_EXISTS"] = "PASS"

        managed = _read_control_plane("/domains/managed", account_id, api_token, opener)
        if managed.get("enabled") is not False:
            raise PreflightError("MANAGED_DOMAIN_NOT_DISABLED")
        result["R2_MANAGED_PUBLIC_DOMAIN"] = "DISABLED"

        custom = _read_control_plane("/domains/custom", account_id, api_token, opener)
        # Strictly require zero custom domains, including currently disabled ones.
        # A stale configuration must be explicitly reviewed, not silently accepted.
        if custom.get("domains") != []:
            raise PreflightError("CUSTOM_DOMAINS_REQUIRE_REVIEW")
        result["R2_CUSTOM_PUBLIC_DOMAINS"] = "NONE"

        locks = _read_control_plane("/lock", account_id, api_token, opener)
        if not _locked_for_minimum_age(locks.get("rules")):
            raise PreflightError("PREFIX_LOCK_NOT_CONFIRMED")
        result["R2_ROLLBACK_PREFIX_LOCK"] = "PASS_90_DAYS_MINIMUM"
        result["R2_PRIVATE_CONFIG_PREFLIGHT"] = "PASS_CONFIGURATION_ONLY"
    except PreflightError as error:
        result["R2_PREFLIGHT_BLOCKER"] = str(error)
    return result


def main():
    findings = inspect(os.environ.get("CLOUDFLARE_ACCOUNT_ID"),
                       os.environ.get("CLOUDFLARE_API_TOKEN"))
    for key, value in findings.items():
        print(f"{key}={value}")
    # These attestations require independent proof; do not infer from bucket settings.
    print("R2_PUBLISHER_RETRIEVER_IDENTITY_SEPARATION=NOT_VERIFIED")
    print("R2_SIGNED_OCI_MANIFESTS=NOT_VERIFIED")
    print("R2_INDEPENDENT_DIGEST_RETRIEVAL=NOT_VERIFIED")
    print("R2_REAL_CHECKPOINT_APP_COMPATIBILITY=NOT_VERIFIED")
    print("R2_OBJECTS_WRITTEN=NO")
    print("STAGING_OR_PRODUCTION_CHANGED=NO")
    print("CREDENTIAL_ROTATION=NOT_EXECUTED")
    print("DEPLOYMENT_AUTHORIZATION=HOLD")
    return 0 if findings["R2_PRIVATE_CONFIG_PREFLIGHT"] == "PASS_CONFIGURATION_ONLY" else 2


if __name__ == "__main__":
    sys.exit(main())
