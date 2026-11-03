#!/usr/bin/env python3
"""SchoolOS V5 Phase 2: read-only BBA LiveKit/AI entitlement and fixture discovery.

Run ONLY after Phase 1 confirms staging isn't being changed. No media starts,
recordings, AI grading, financial requests, provider calls, or mutable UAT
operations. Login creates an ordinary auth session; logout revokes it.
Only safe counts/boolean feature state are printed (no PII or secrets).
"""
from __future__ import annotations

import getpass
import json
import subprocess
import sys
import urllib.error
import urllib.request

ORIGIN = "https://v5-staging.beingbrilliantedu.com"
PROJECT = "96ffcu0jinuwlnaqxpltln4p"
EXPECTED_SHA = "b54dca5ae36a948f83012faa4a37354198fba083"
ORG_ID = "org_default"
SLUG = "being-brilliant-academy"
EMAIL = "admin@beingbrilliant.in"
MAX_RESPONSE = 512_000


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("REDIRECT_UNEXPECTED")


opener = urllib.request.build_opener(NoRedirect())


def request(path: str, *, method: str = "GET", token: str | None = None, body=None):
    if path.startswith("/") or "://" in path or ".." in path:
        raise RuntimeError("NON_CANONICAL_PATH")
    headers = {"Accept": "application/json"}
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(ORIGIN + "/api/v1/" + path, method=method, headers=headers, data=data)
    try:
        with opener.open(req, timeout=20) as resp:
            if resp.status not in (200, 201, 204):
                raise RuntimeError("UNEXPECTED_STATUS")
            if resp.status == 204:
                return 204, {}
            return resp.status, json.loads(resp.read(MAX_RESPONSE))
    except urllib.error.HTTPError as exc:
        # Do not print backend errors that could contain private configuration.
        exc.close()
        return exc.code, {}


def verify_deployed_revisions():
    for service in ("api", "web"):
        proc = subprocess.run(
            ["docker", "ps", "-q", "--filter", "label=com.docker.compose.project=" + PROJECT,
             "--filter", "label=com.docker.compose.service=" + service],
            capture_output=True, text=True, timeout=12, check=True)
        ids = proc.stdout.split()
        if len(ids) != 1:
            raise RuntimeError("STAGING_CONTAINER_UNEXPECTED_" + service.upper())
        inspect = subprocess.run(["docker", "inspect", ids[0]], capture_output=True,
                                 text=True, timeout=12, check=True)
        item = json.loads(inspect.stdout)[0]
        if item["Config"].get("Labels", {}).get("org.opencontainers.image.revision") != EXPECTED_SHA:
            raise RuntimeError("STAGING_REVISION_CHANGED_COORDINATE_WITH_PHASE1")
        if item["State"].get("Health", {}).get("Status") != "healthy":
            raise RuntimeError("STAGING_UNHEALTHY_" + service.upper())
        print("STAGING_" + service.upper() + "_REVISION=PASS")


def main():
    verify_deployed_revisions()
    secret = getpass.getpass("Existing BBA staging SUPER_ADMIN password (hidden): ")
    if not secret:
        raise RuntimeError("ADMIN_PASSWORD_MISSING")
    status, result = request("auth/login", method="POST", body={
        "email": EMAIL, "password": secret, "organization": SLUG,
        "portal": "admin", "rememberMe": False,
    })
    secret = None
    if status != 200:
        raise RuntimeError("AUTH_HTTP_" + str(status))
    session = result.get("data", {})
    token, refresh = session.get("accessToken"), session.get("refreshToken")
    try:
        actor = session.get("user", {})
        organization = session.get("organization", {})
        if not token or not refresh or actor.get("role") != "SUPER_ADMIN" or actor.get("organizationId") != ORG_ID or organization.get("slug") != SLUG:
            raise RuntimeError("NOT_AUTHORIZED_BBA_SUPER_ADMIN")
        print("REAL_BBA_TENANT_AUTH=PASS")

        status, branches = request("admin/branches?page=1&limit=100", token=token)
        if status != 200 or not isinstance(branches.get("data"), list):
            raise RuntimeError("BBA_BRANCH_INVENTORY_UNAVAILABLE")
        known = {"BBA-UAT-NDG", "BBA-UAT-RNE", "BBA-UAT-SHN"}
        observed = {b.get("branchCode") for b in branches["data"]}
        if not known.issubset(observed):
            raise RuntimeError("THREE_BBA_SYNTHETIC_BRANCHES_MISSING")
        print("BBA_SYNTHETIC_BRANCHES=3_PASS")

        status, meeting = request("meetings/options", token=token)
        if status == 200:
            data = meeting.get("data", {})
            ids = {b.get("branchCode") for b in data.get("branches", [])}
            print("BBA_MEETING_FEATURE=AVAILABLE")
            print("MEETING_OPTIONS_BBA_BRANCHES=" + str(len(known & ids)))
            print("MEETING_OPTIONS_USERS_PRESENT=" + ("YES" if len(data.get("users", [])) else "NO"))
        else:
            print("BBA_MEETING_FEATURE=HTTP_" + str(status))
            print("MEETING_REASON=ENTITLEMENT_OR_AUTH_CHECK_REQUIRED")

        status, examiner = request("ai-examiner/capabilities", token=token)
        if status == 200:
            data = examiner.get("data", {})
            print("BBA_AI_EXAMINER_FEATURE=AVAILABLE")
            print("AI_PROVIDER_CONFIGURED=" + ("YES" if data.get("providerConfigured") is True else "NO"))
            print("AI_EXECUTION_AVAILABLE=" + ("YES" if data.get("evaluationExecutionAvailable") is True else "NO"))
            print("AI_QUESTION_TYPE_COUNT=" + str(len(data.get("questionTypes", []))))
        else:
            print("BBA_AI_EXAMINER_FEATURE=HTTP_" + str(status))
            print("AI_REASON=ENTITLEMENT_OR_AUTH_CHECK_REQUIRED")

        print("BUSINESS_DATA_WRITES=NO")
        print("PROVIDER_OR_VIDEO_ACTIONS=NO")
        print("PHASE2_LIVEKIT_AI_PREFLIGHT=OBSERVED_REQUIRES_HUMAN_REVIEW")
        print("PAID_COMMERCIAL_GO=HOLD")
    finally:
        if refresh:
            status, _ = request("auth/logout", method="POST", body={"refreshToken": refresh})
            if status not in (200, 204):
                print("AUTH_LOGOUT=CHECK_REQUIRED")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("PHASE2_LIVEKIT_AI_PREFLIGHT=CHECK_REQUIRED")
        print("FAILURE=" + str(exc) if isinstance(exc, RuntimeError) else "FAILURE_TYPE=" + type(exc).__name__)
        sys.exit(1)
