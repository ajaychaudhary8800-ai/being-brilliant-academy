#!/usr/bin/env python3
"""Owner-only isolated private prior-source OCI builder; DISABLED by default.

No GitHub Actions, R2, Cloudflare, credential rotation, shared staging, or
production. Builds real OCI archives from immutable prior V5 Git source in
a separate trusted Linux builder, verifies bounded image content, and saves
*unsigned* candidates to an owner-only directory. Never run on the shared VPS.
The source-to-binary provenance and full image cleanliness are NOT attested.
"""
from __future__ import annotations

import hashlib
import io
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile

PRIOR = "b54dca5ae36a948f83012faa4a37354198fba083"
API_DOCKER_SHA1 = "58c374752a88aa6e0aeae068ec6cbcdd1e147f98"
WEB_DOCKER_SHA1 = "b945ffcb733a3cc76b35d8dddabe0f1c1bdb0b85"
PRUNE_SHA1 = "ba3041ce4bf89c548f154db15af71d87bbb195a6"
PRUNE = "scripts/schoolos-v5-prune-approved-dependency-docs.mjs"
AUDIT = "scripts/schoolos-v5-ci-layer-payload-audit.py"
CANDIDATE = "scripts/schoolos-v5-prior-oci-candidate-manifest.py"
CONTROLS = (PRUNE, AUDIT, CANDIDATE,
            "scripts/schoolos-v5-private-oci-offline-verify.py",
            "scripts/schoolos-v5-private-r2-signed-readback.py")
ACK = "I_APPROVE_PRIVATE_PRIOR_OCI_BUILD_NOT_PUBLICATION"
SHA = re.compile(r"[a-f0-9]{40}\Z")
OCI = re.compile(r"sha256:[a-f0-9]{64}\Z")
MAX_SOURCE_TAR = 512 * 1024 ** 2
MAX_SOURCE_FILE = 64 * 1024 ** 2
MAX_SOURCE_MEMBERS = 20000
MAX_CONTROL_BLOB = 4 * 1024 ** 2
MAX_RESULT_LOG = 64 * 1024
MAX_SINGLE_ARCHIVE = 5 * 1024 ** 3
API_ANCHOR = ("RUN --mount=type=cache,id=pnpm-api,target=/pnpm/store "
              "pnpm install --frozen-lockfile --prod=false --filter @bba/api...\n")
PRUNE_COMMAND = (
    "RUN --mount=type=bind,from=controls,"
    "source=scripts/schoolos-v5-prune-approved-dependency-docs.mjs,"
    "target=/tmp/verified-docs-only.mjs,ro node /tmp/verified-docs-only.mjs\n"
)


class Hold(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def _git_object_sha1(raw):
    return hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()


def _run(args, *, stdout=subprocess.PIPE, env=None, timeout=30, stdin=None):
    try:
        completed = subprocess.run(
            args, stdin=stdin, stdout=stdout, stderr=subprocess.DEVNULL,
            env=env, check=False, timeout=timeout,
        )
        if completed.returncode != 0:
            raise Hold("REVIEWED_COMMAND_FAILED")
        if stdout == subprocess.PIPE:
            if len(completed.stdout) > MAX_RESULT_LOG:
                raise Hold("COMMAND_OUTPUT_TOO_LARGE")
            return completed.stdout
        return b""
    except (OSError, ValueError, subprocess.TimeoutExpired):
        raise Hold("REVIEWED_COMMAND_UNAVAILABLE") from None


def check_approvals(environ, *, uid=None):
    if environ.get("CI") or environ.get("GITHUB_ACTIONS"):
        raise Hold("CI_OR_GITHUB_ACTIONS_PROHIBITED")
    if uid is None:
        if not hasattr(os, "geteuid"):
            raise Hold("TRUSTED_LINUX_REQUIRED")
        uid = os.geteuid()
    if uid == 0:
        raise Hold("ROOT_BUILDER_NOT_ALLOWED")
    if environ.get("V5_OWNER_PRIVATE_BUILDER_ACK") != ACK:
        raise Hold("OWNER_LOCAL_BUILD_APPROVAL_REQUIRED")
    controls_sha = environ.get("V5_OWNER_CONTROLS_SHA")
    base = environ.get("V5_OWNER_APPROVED_NODE22_ALPINE_DIGEST")
    root = environ.get("V5_OWNER_PRIVATE_BUILD_DIR")
    if not isinstance(controls_sha, str) or not SHA.fullmatch(controls_sha):
        raise Hold("CONTROLS_COMMIT_NOT_PINNED")
    if not isinstance(base, str) or not OCI.fullmatch(base):
        raise Hold("NODE_BASE_DIGEST_NOT_INDEPENDENTLY_PINNED")
    if not isinstance(root, str) or not root:
        raise Hold("PRIVATE_OUTPUT_DIRECTORY_MISSING")
    try:
        p = Path(root)
        m = p.lstat()
        if (not stat.S_ISDIR(m.st_mode) or m.st_uid != uid or
                m.st_mode & 0o077):
            raise Hold("PRIVATE_OUTPUT_DIRECTORY_NOT_0700_OWNER")
        for filename in ("api.oci.tar", "web.oci.tar", "candidate-receipt.json"):
            if (p / filename).exists() or (p / filename).is_symlink():
                raise Hold("PRIVATE_OUTPUT_ALREADY_EXISTS")
    except (OSError, ValueError, TypeError):
        raise Hold("PRIVATE_OUTPUT_DIRECTORY_UNAVAILABLE") from None
    return controls_sha, base, p


def _git_blob(repo, revision, path, *, maximum=MAX_CONTROL_BLOB):
    raw = _run(["git", "-C", str(repo), "show", f"{revision}:{path}"])
    if not raw or len(raw) > maximum:
        raise Hold("REVIEWED_GIT_BLOB_MISSING")
    return raw


def check_git_pins(repo, controls):
    for commit in (PRIOR, controls):
        output = _run(["git", "-C", str(repo), "rev-parse", "--verify",
                       f"{commit}^{{commit}}"])
        if output.decode("ascii", "strict").strip() != commit:
            raise Hold("REVIEWED_GIT_REVISION_MISMATCH")
    if _git_object_sha1(_git_blob(repo, PRIOR, "apps/api/Dockerfile")) != API_DOCKER_SHA1:
        raise Hold("OLD_API_DOCKERFILE_HASH_MISMATCH")
    if _git_object_sha1(_git_blob(repo, PRIOR, "apps/web/Dockerfile")) != WEB_DOCKER_SHA1:
        raise Hold("OLD_WEB_DOCKERFILE_HASH_MISMATCH")
    if _git_object_sha1(_git_blob(repo, controls, PRUNE)) != PRUNE_SHA1:
        raise Hold("PUBLIC_DOC_PRUNE_HELPER_HASH_MISMATCH")


def _safe_extract_git_tar(path, destination):
    """Extract reviewed Git archive only: no links, devices, traversal or modes."""
    try:
        if path.stat().st_size > MAX_SOURCE_TAR:
            raise Hold("PRIOR_SOURCE_TAR_TOO_LARGE")
        with tarfile.open(path, "r:") as archive:
            members = archive.getmembers()
            if len(members) > MAX_SOURCE_MEMBERS:
                raise Hold("PRIOR_SOURCE_ENTRY_LIMIT_EXCEEDED")
            seen = set()
            for member in members:
                name = member.name.rstrip("/")
                if (not name or "\\" in name or "\x00" in name or
                        any(ord(c) < 32 for c in name)):
                    raise Hold("PRIOR_SOURCE_MEMBER_UNSAFE")
                rel = PurePosixPath(name)
                if rel.is_absolute() or ".." in rel.parts or "." in rel.parts:
                    raise Hold("PRIOR_SOURCE_MEMBER_UNSAFE")
                if str(rel) in seen or not (member.isdir() or member.isfile()):
                    raise Hold("PRIOR_SOURCE_MEMBER_UNSAFE")
                seen.add(str(rel))
                dest = destination.joinpath(*rel.parts)
                if member.isdir():
                    dest.mkdir(mode=0o700, parents=True, exist_ok=True)
                    dest.chmod(0o700)
                    continue
                if member.size > MAX_SOURCE_FILE:
                    raise Hold("PRIOR_SOURCE_FILE_LIMIT_EXCEEDED")
                dest.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                if dest.exists() or dest.is_symlink():
                    raise Hold("PRIOR_SOURCE_MEMBER_UNSAFE")
                reader = archive.extractfile(member)
                if reader is None:
                    raise Hold("PRIOR_SOURCE_MEMBER_UNSAFE")
                fd = os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_EXCL |
                             getattr(os, "O_NOFOLLOW", 0), 0o600)
                with os.fdopen(fd, "wb") as writer:
                    written = shutil.copyfileobj(reader, writer, length=1024 * 1024)
                if dest.stat().st_size != member.size:
                    raise Hold("PRIOR_SOURCE_MEMBER_UNSAFE")
                dest.chmod(0o700 if member.mode & 0o111 else 0o600)
    except Hold:
        raise
    except (OSError, ValueError, tarfile.TarError):
        raise Hold("REVIEWED_GIT_TAR_EXTRACTION_FAILED") from None


def derived_recipes(api, web, base):
    """Only two FROM pins and single approved public-doc purge added to API."""
    if (not isinstance(api, str) or not isinstance(web, str) or
            not isinstance(base, str) or not OCI.fullmatch(base)):
        raise Hold("REVIEWED_DOCKER_RECIPE_INVALID")
    before = "FROM node:22-alpine AS "
    if api.count(before) != 2 or web.count(before) != 2:
        raise Hold("REVIEWED_DOCKER_BASE_RECIPE_CHANGED")
    if api.count(API_ANCHOR) != 1:
        raise Hold("REVIEWED_API_DEPENDENCY_RECIPE_CHANGED")
    after = f"FROM node:22-alpine@{base} AS "
    return (api.replace(before, after).replace(API_ANCHOR, API_ANCHOR + PRUNE_COMMAND),
            web.replace(before, after))


def _scan_archive(path, control_dir):
    script = control_dir / AUDIT
    with open(path, "rb") as stream:
        raw = _run([sys.executable, str(script), "--docker-save-stdin",
                    "--require-no-dependency-pem"],
                   stdin=stream, timeout=1200)
    if (b"V5_LAYER_AUDIT=PASS_BOUNDED_PATTERNS_ONLY" not in raw or
            b"V5_PRIVATE_FILES_IN_LAYERS=NO" not in raw):
        raise Hold("BOUNDED_LAYER_SCAN_NOT_PASSED")


def _receipt(api, web, stage):
    output = stage / "candidate-receipt.json"
    environment = os.environ.copy()
    environment["RUNNER_TEMP"] = str(stage)
    raw = _run([sys.executable, str(stage / "controls" / CANDIDATE),
                "--api", str(api), "--web", str(web), "--out", str(output)],
               env=environment, timeout=1800)
    if (b"V5_PREVIOUS_OCI_CANDIDATE_DRAFT=PASS_OCI_CONTENT_UNSIGNED_CANDIDATE_ONLY" not in raw or
            not output.is_file() or output.stat().st_size > 16 * 1024):
        raise Hold("OCI_CANDIDATE_CHECK_FAILED")
    return output


def _promote_private(root, files):
    """No overwrite; source and destination are on same protected filesystem."""
    written = []
    try:
        for staged, name in files:
            dst = root / name
            os.link(staged, dst)
            written.append(dst)
            dst.chmod(0o600)
    except (OSError, ValueError, TypeError):
        for dst in written:
            try:
                dst.unlink()
            except OSError:
                pass
        raise Hold("PRIVATE_ARCHIVE_PROMOTION_FAILED") from None


def build_private(repo, environ, *, approved=None):
    # Only an owner-controlled, dedicated non-root Linux builder may run this.
    if approved is None:
        controls, base, root = check_approvals(environ)
    else:
        controls, base, root = approved
    check_git_pins(repo, controls)
    stage = Path(tempfile.mkdtemp(prefix=".v5-prior-build-", dir=root))
    stage.chmod(0o700)
    try:
        source = stage / "previous"
        source.mkdir(mode=0o700)
        ctrl = stage / "controls"
        (ctrl / "scripts").mkdir(mode=0o700, parents=True)
        # Build source from exact reviewed Git commit, not working-tree files
        # and never old cached Docker image archives.
        tar = stage / "previous-source.tar"
        _run(["git", "-C", str(repo), "archive", "--format=tar",
              f"--output={tar}", PRIOR], stdout=subprocess.DEVNULL, timeout=60)
        _safe_extract_git_tar(tar, source)
        tar.unlink()
        for rel in CONTROLS:
            target = ctrl / rel
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            target.write_bytes(_git_blob(repo, controls, rel))
            target.chmod(0o600)
        api_text, web_text = derived_recipes(
            (source / "apps/api/Dockerfile").read_text("utf-8"),
            (source / "apps/web/Dockerfile").read_text("utf-8"), base)
        (source / "recovery-pinned-api.Dockerfile").write_text(api_text, encoding="utf-8")
        (source / "recovery-pinned-web.Dockerfile").write_text(web_text, encoding="utf-8")
        artifacts = []
        for role, extra in (("api", ["--build-context", f"controls={ctrl}"]),
                            ("web", [])):
            dest = stage / f"{role}.oci.tar"
            name = source / f"recovery-pinned-{role}.Dockerfile"
            args = (["docker", "buildx", "build", "--platform", "linux/amd64",
                     "--pull", "--no-cache", "--provenance=false",
                     "--sbom=false"] + extra + [
                     "--file", str(name), "--build-arg", f"SCHOOLOS_BUILD_REVISION={PRIOR}"])
            if role == "web":
                args.extend(["--build-arg", "NEXT_PUBLIC_API_URL=/api/v1"])
            args.extend(["--output", f"type=oci,dest={dest}", str(source)])
            _run(args, stdout=subprocess.DEVNULL, timeout=3600)
            if (not dest.is_file() or dest.is_symlink() or
                    not 0 < dest.stat().st_size <= MAX_SINGLE_ARCHIVE):
                raise Hold("PRIVATE_OCI_ARCHIVE_NOT_CREATED")
            dest.chmod(0o600)
            _scan_archive(dest, ctrl)
            artifacts.append((dest, f"{role}.oci.tar"))
        receipt = _receipt(stage / "api.oci.tar", stage / "web.oci.tar", stage)
        _promote_private(root, artifacts + [(receipt, "candidate-receipt.json")])
    finally:
        # Never remove previously retained root artifacts on ambiguous
        # promotion errors. All *temporary* source/build context deleted.
        shutil.rmtree(stage, ignore_errors=True)


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if argv != ["--execute-owner-private-build"]:
        print("V5_PRIVATE_PRIOR_OCI_BUILDER=DISABLED_DEFAULT")
        print("V5_IMAGES_EXPORTED_OR_UPLOADED=NO")
        print("DEPLOYMENT_AUTHORIZATION=HOLD")
        return 2
    status, blocker, rc = "HOLD", None, 2
    try:
        build_private(Path.cwd(), os.environ)
        status, rc = "PASS_PRIVATE_UNSIGNED_CANDIDATES_ONLY", 0
    except Hold as error:
        blocker = error.code
    except Exception:
        blocker = "PRIVATE_BUILD_UNVERIFIED"
    print("V5_PRIVATE_PRIOR_OCI_BUILDER=" + status)
    if blocker:
        print("V5_PRIOR_OCI_BUILDER_BLOCKER=" + blocker)
    print("V5_LOCAL_OCI_IMAGE_CONTENT_IN_PRIVATE_OWNER_CUSTODY=" +
          ("YES_UNSIGNED" if rc == 0 else "NOT_VERIFIED"))
    print("V5_SOURCE_TO_BUILD_PROVENANCE=NOT_INDEPENDENTLY_ATTESTED")
    print("V5_FULL_SEMANTIC_SECRET_CLEARANCE=NOT_ATTESTED")
    print("V5_PRIVATE_R2_OBJECTS_WRITTEN=NO")
    print("V5_PRIVATE_SIGNED_MANIFEST=NOT_CREATED_BY_THIS_TOOL")
    print("V5_REAL_CHECKPOINT_APP_RESTORE=NOT_PERFORMED")
    print("V5_STAGING_PRODUCTION_CHANGED=NO")
    print("DEPLOYMENT_AUTHORIZATION=HOLD")
    return rc


if __name__ == "__main__":
    sys.exit(main())
