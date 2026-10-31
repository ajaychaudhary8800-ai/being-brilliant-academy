#!/usr/bin/env python3
"""V5 owner-local artifact identity bridge. Read-only, no staging access.

Purpose: compare a pinned original-builder Docker save with local Docker Desktop
image INSPECT metadata without printing history, environment or secret values.
It is *not* a signature, SLSA statement, safe rollback, or deployment approval.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tarfile
from pathlib import Path

SOURCE = 'b54dca5ae36a948f83012faa4a37354198fba083'
PROJECT = '96ffcu0jinuwlnaqxpltln4p'
NONCE = 'ac8e968f71af'
EXPECTED_ARCHIVE_SHA256 = 'bf956547d243d02bca7ea9a152147a4d6920e74b2c7cc90ab44f0fe61d6ea5ca'
ROLES = ('API', 'WEB', 'NGINX', 'BACKUP')
IMAGE = re.compile(r'^sha256:[0-9a-f]{64}$')
CONFIG_LEGACY = re.compile(r'^([0-9a-f]{64})\.json$')
CONFIG_BLOB = re.compile(r'^blobs/sha256/([0-9a-f]{64})$')
# Only compare potentially operational config fields. Every value is compared
# in memory and NEVER printed, hashed individually, or persisted to evidence.
CONFIG_KEYS = ('Env', 'User', 'WorkingDir', 'Entrypoint', 'Cmd', 'ExposedPorts',
               'Volumes', 'Labels', 'Healthcheck', 'StopSignal', 'Shell')
MAX_CONFIG = 8 * 1024 * 1024
MAX_MEMBERS = 30000
MAX_EXTERNAL = 1 * 1024 * 1024
EXPECTED_ROOTFS_COUNTS = {'API': 17, 'WEB': 10, 'NGINX': 9, 'BACKUP': 14}

class Stop(Exception):
    pass


def require(ok, reason):
    if not ok:
        raise Stop(reason)


def obj(raw: bytes, limit: int = MAX_CONFIG):
    require(isinstance(raw, bytes) and len(raw) <= limit, 'METADATA_SIZE_INVALID')
    try:
        return json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        raise Stop('METADATA_JSON_INVALID') from None


def sha256_file(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda: f.read(1024 * 1024), b''):
            h.update(b)
    return h.hexdigest()


def safe_member(name):
    return (isinstance(name, str) and name and len(name) <= 300
            and '\\' not in name and not name.startswith('/')
            and all(part not in ('', '.', '..') for part in name.split('/')))


def digest_from_path(path):
    require(safe_member(path), 'CONFIG_PATH_UNSAFE')
    m = CONFIG_LEGACY.fullmatch(path) or CONFIG_BLOB.fullmatch(path)
    require(m is not None, 'CONFIG_PATH_UNSUPPORTED')
    return m.group(1)


def tag_for(role):
    return 'schoolos-v5-clean-' + NONCE + '-' + role.lower() + ':source'


def read_archive(archive):
    """Read ONLY Docker save manifest + four configs; never extract layers."""
    with tarfile.open(archive, mode='r:') as t:
        members = {}
        for member in t:
            if member.isdir():
                continue
            name = member.name[2:] if member.name.startswith('./') else member.name
            require(safe_member(name) and member.isfile() and name not in members,
                    'ARCHIVE_MEMBER_UNSAFE_OR_DUPLICATE')
            require(len(members) < MAX_MEMBERS, 'ARCHIVE_MEMBER_LIMIT')
            members[name] = member

        def take(name):
            require(name in members and 0 <= members[name].size <= MAX_CONFIG,
                    'ARCHIVE_CONFIG_MISSING_OR_TOO_LARGE')
            f = t.extractfile(members[name])
            require(f is not None, 'ARCHIVE_CONFIG_UNREADABLE')
            with f:
                raw = f.read(MAX_CONFIG + 1)
            require(len(raw) == members[name].size, 'ARCHIVE_CONFIG_TRUNCATED')
            return raw

        records = obj(take('manifest.json'))
        require(isinstance(records, list) and len(records) == 4,
                'ARCHIVE_NOT_FOUR_IMAGES')
        found = {}
        for record in records:
            require(isinstance(record, dict), 'ARCHIVE_RECORD_INVALID')
            tags = record.get('RepoTags')
            require(isinstance(tags, list) and len(tags) == 1 and
                    isinstance(tags[0], str), 'IMAGE_TAG_AMBIGUOUS')
            roles = [r for r in ROLES if tags[0] == tag_for(r)]
            require(len(roles) == 1 and roles[0] not in found, 'ARCHIVE_ROLE_INVALID')
            role = roles[0]
            name = record.get('Config')
            digest = digest_from_path(name)
            raw = take(name)
            require(hashlib.sha256(raw).hexdigest() == digest, 'CONFIG_DIGEST_MISMATCH')
            conf = obj(raw)
            require(isinstance(conf, dict) and isinstance(conf.get('config'), dict),
                    'ARCHIVE_IMAGE_CONFIG_INVALID')
            rootfs = (conf.get('rootfs') or {}).get('diff_ids')
            require(isinstance(rootfs, list) and len(rootfs) == EXPECTED_ROOTFS_COUNTS[role]
                    and all(isinstance(x, str) and IMAGE.fullmatch(x) for x in rootfs),
                    'ARCHIVE_ROOTFS_INVALID')
            layers = record.get('Layers')
            require(isinstance(layers, list) and len(layers) == len(rootfs)
                    and all(isinstance(p, str) and safe_member(p)
                            and (p[2:] if p.startswith('./') else p) in members
                            for p in layers), 'ARCHIVE_LAYER_INVENTORY_INVALID')
            found[role] = {'tag': tags[0], 'config_digest': 'sha256:' + digest,
                           'config': conf['config'], 'rootfs': rootfs,
                           'os': conf.get('os'), 'arch': conf.get('architecture')}
        require(set(found) == set(ROLES), 'ARCHIVE_ROLE_SET_INCOMPLETE')
        return found


def external_proof(path, archive_size):
    require(path.is_file() and path.stat().st_size <= MAX_EXTERNAL,
            'EXTERNAL_MANIFEST_MISSING_OR_TOO_LARGE')
    evidence = obj(path.read_bytes(), MAX_EXTERNAL)
    require(isinstance(evidence, dict) and
            evidence.get('source_sha') == SOURCE and
            evidence.get('archive_sha256') == EXPECTED_ARCHIVE_SHA256 and
            type(evidence.get('archive_size_bytes')) is int and
            evidence['archive_size_bytes'] == archive_size, 'EXTERNAL_SOURCE_ARCHIVE_MISMATCH')
    require(('images' in evidence) != ('image_evidence' in evidence),
            'EXTERNAL_SCHEMA_AMBIGUOUS')
    proof = evidence.get('images', evidence.get('image_evidence'))
    require(isinstance(proof, dict) and set(proof) == set(ROLES),
            'EXTERNAL_ROLES_INVALID')
    return proof


def local_only_endpoint(endpoint):
    # On Windows, Docker Desktop local Linux engine is reached via named pipe.
    # Never permit SSH, TCP, remote sockets, WSL or the VPS daemon.
    return (isinstance(endpoint, str) and bool(re.fullmatch(
        r'npipe:////\./pipe/(?:dockerDesktopLinuxEngine|docker_engine)',
        endpoint, flags=re.I)))


def docker(args):
    try:
        result = subprocess.run(['docker', '--context', 'desktop-linux', *args],
                                capture_output=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        raise Stop('LOCAL_DOCKER_QUERY_FAILED') from None
    require(result.returncode == 0 and len(result.stdout) < 4 * 1024 * 1024,
            'LOCAL_DOCKER_QUERY_FAILED')
    return result.stdout


def docker_images():
    require(os.name == 'nt', 'WINDOWS_DESKTOP_ONLY')
    endpoint = obj(docker(['context', 'inspect', 'desktop-linux', '--format',
                           '{{json .Endpoints.docker.Host}}']))
    require(local_only_endpoint(endpoint), 'NONLOCAL_DOCKER_CONTEXT_REFUSED')
    require(docker(['version', '--format', '{{.Server.Os}}']).strip() == b'linux',
            'NONLINUX_DOCKER_CONTEXT_REFUSED')
    result = {}
    for role in ROLES:
        info = obj(docker(['image', 'inspect', tag_for(role)]))
        require(isinstance(info, list) and len(info) == 1 and
                isinstance(info[0], dict), 'LOCAL_IMAGE_INVALID_' + role)
        result[role] = info[0]
    return result


def normalized(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True)


def assess(images, proof, local):
    """Pure decision function: evidence mapping not signed build provenance."""
    require(set(images) == set(ROLES) and set(proof) == set(ROLES)
            and set(local) == set(ROLES), 'ROLE_INVENTORY_MISMATCH')
    status = {}
    for role in ROLES:
        a = images[role]
        p = proof[role]
        l = local[role]
        require(isinstance(p, dict) and p.get('tag') == a['tag'] and
                IMAGE.fullmatch(p.get('image_id', '') or ''),
                'EXTERNAL_IMAGE_EVIDENCE_INVALID_' + role)
        require(isinstance(l, dict) and IMAGE.fullmatch(l.get('Id', '') or ''),
                'LOCAL_IMAGE_ID_INVALID_' + role)
        require(l['Id'] == p['image_id'], 'LOCAL_BUILDER_ID_MISMATCH_' + role)
        local_config = l.get('Config')
        require(isinstance(local_config, dict), 'LOCAL_CONFIG_INVALID_' + role)
        rootfs = (l.get('RootFS') or {}).get('Layers')
        require(isinstance(rootfs, list) and rootfs == a['rootfs'],
                'ROOTFS_PARITY_FAILED_' + role)
        require(type(p.get('rootfs_layer_count')) is int and
                p['rootfs_layer_count'] == len(rootfs),
                'EXTERNAL_ROOTFS_COUNT_INVALID_' + role)
        drift = [k for k in CONFIG_KEYS
                 if normalized(a['config'].get(k)) != normalized(local_config.get(k))]
        # Specific identity/role guard for API and Web, even when configs
        # drift. Nginx/Backup do not have source revision label in the image.
        if role in ('API', 'WEB'):
            wd = '/workspace/apps/api' if role == 'API' else '/app'
            require(a['config'].get('WorkingDir') == wd and
                    local_config.get('WorkingDir') == wd,
                    'IMAGE_SERVICE_ROLE_MISMATCH_' + role)
            key = 'org.opencontainers.image.revision'
            require((a['config'].get('Labels') or {}).get(key) == SOURCE and
                    (local_config.get('Labels') or {}).get(key) == SOURCE,
                    'IMAGE_REVISION_LABEL_MISMATCH_' + role)
        require(not drift, 'RUNTIME_IMAGE_CONFIG_DRIFT_' + role)
        require(a['os'] == l.get('Os') and a['arch'] == l.get('Architecture'),
                'PLATFORM_MISMATCH_' + role)
        status[role] = {
            'local_image_id': l['Id'],
            'exported_config_id': a['config_digest'],
            'local_id_equals_exported_config': l['Id'] == a['config_digest'],
            'rootfs_layer_count': len(rootfs),
            'ordered_rootfs_parity': True,
            'runtime_config_parity': True,
            'platform_parity': True,
            'revision_label_matches_selected_source': True if role in ('API', 'WEB') else None,
        }
    return {
        'schema': 'schoolos-v5-artifact-identity-bridge-v1',
        'source_revision_label': SOURCE,
        'compose_project': PROJECT,
        'archive_sha256': EXPECTED_ARCHIVE_SHA256,
        'images': status,
        'local_builder_evidence_mapping': 'PASS_METADATA_AND_ROOTFS_ONLY',
        'independently_signed_source_to_build_provenance': False,
        'immutable_registry_subject_digest_attested': False,
        'actual_artifact_import_restore_verified': False,
        'database_and_files_recovery_verified_for_this_checkpoint': False,
        'rollback_compatibility_approved': False,
        'deployment_authorized': False,
        'staging_changed': False,
        'production_changed': False,
        'credential_values_or_paths_in_report': False,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--external-manifest', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    require(args.archive.is_file() and not args.archive.is_symlink(), 'ARCHIVE_NOT_REGULAR_FILE')
    require(args.external_manifest.is_file() and not args.external_manifest.is_symlink(),
            'EXTERNAL_MANIFEST_NOT_REGULAR_FILE')
    require(args.archive.resolve() != args.output.resolve() and
            args.external_manifest.resolve() != args.output.resolve(),
            'OUTPUT_OVERWRITE_REFUSED')
    require(not args.output.exists(), 'OUTPUT_ALREADY_EXISTS')
    require(1024 * 1024 < args.archive.stat().st_size < 20 * 1024 ** 3,
            'ARCHIVE_SIZE_INVALID')
    require(sha256_file(args.archive) == EXPECTED_ARCHIVE_SHA256,
            'ARCHIVE_SHA256_MISMATCH')
    proof = external_proof(args.external_manifest, args.archive.stat().st_size)
    images = read_archive(args.archive)
    local = docker_images()
    report = assess(images, proof, local)
    # No raw Config.Env, history, Docker errors, tar member contents or secrets.
    payload = (json.dumps(report, sort_keys=True, indent=2) + '\n').encode('utf-8')
    try:
        fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as f:
            f.write(payload)
    except OSError:
        raise Stop('REPORT_WRITE_FAILED') from None
    print('ARTIFACT_METADATA_AND_ROOTFS_MAPPING=PASS')
    print('EXPORT_CONFIG_ID_EQUALS_LOCAL_IMAGE_ID=' +
          ('YES' if all(v['local_id_equals_exported_config']
                        for v in report['images'].values()) else 'NO'))
    print('SIGNED_BUILD_PROVENANCE=NOT_ATTESTED')
    print('APP_RECOVERY_REHEARSAL=NOT_PERFORMED')
    print('REPORT_SAVED=YES_SANITIZED_ONLY')
    print('DEPLOYMENT_AUTHORIZATION=HOLD')
    print('CHANGES_TO_DOCKER_OR_STAGING=NO')


if __name__ == '__main__':
    try:
        main()
    except Stop as e:
        # Error literals are constant and never include untrusted path/value.
        print('ARTIFACT_BRIDGE=CHECK_REQUIRED_' + str(e))
        print('DEPLOYMENT_AUTHORIZATION=HOLD')
        print('CREDENTIAL_VALUES_PRINTED=NO')
        sys.exit(2)
    except Exception:
        print('ARTIFACT_BRIDGE=CHECK_REQUIRED_UNEXPECTED_ERROR')
        print('DEPLOYMENT_AUTHORIZATION=HOLD')
        print('CREDENTIAL_VALUES_PRINTED=NO')
        sys.exit(3)
