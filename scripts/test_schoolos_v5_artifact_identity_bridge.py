"""Synthetic, isolated, no Docker/remote connection or real credentials."""
import hashlib
import io
import json
import os
import tarfile
import tempfile
import unittest
from pathlib import Path

import schoolos_v5_artifact_identity_bridge as p


def fixtures():
    images, proof, local = {}, {}, {}
    for n, role in enumerate(p.ROLES):
        rootfs = ['sha256:' + format(100 + i, '064x') for i in range(p.EXPECTED_ROOTFS_COUNTS[role])]
        workdir = '/workspace/apps/api' if role == 'API' else ('/app' if role == 'WEB' else '/')
        labels = {'org.opencontainers.image.revision': p.SOURCE} if role in ('API', 'WEB') else {}
        config = {'WorkingDir': workdir, 'Labels': labels, 'Env': ['NODE_ENV=production'],
                  'Entrypoint': ['/bin/sh'], 'Cmd': ['true'], 'User': 'app'}
        images[role] = {'tag': p.tag_for(role), 'config': config,
                        'config_digest': 'sha256:' + format(1000 + n, '064x'),
                        'rootfs': rootfs, 'os': 'linux', 'arch': 'amd64'}
        image_id = 'sha256:' + format(9000 + n, '064x')
        proof[role] = {'tag': p.tag_for(role), 'image_id': image_id,
                       'rootfs_layer_count': len(rootfs)}
        local[role] = {'Id': image_id, 'Config': config, 'RootFS': {'Layers': list(rootfs)},
                       'Os': 'linux', 'Architecture': 'amd64'}
    return images, proof, local


class IdentityBridgeTests(unittest.TestCase):
    def test_original_local_ids_may_differ_from_export_config_if_runtime_and_rootfs_match(self):
        images, proof, local = fixtures()
        report = p.assess(images, proof, local)
        self.assertEqual(report['local_builder_evidence_mapping'],
                         'PASS_METADATA_AND_ROOTFS_ONLY')
        self.assertTrue(all(not x['local_id_equals_exported_config']
                            for x in report['images'].values()))
        self.assertFalse(report['independently_signed_source_to_build_provenance'])
        self.assertFalse(report['rollback_compatibility_approved'])
        self.assertFalse(report['deployment_authorized'])
        self.assertNotIn('NODE_ENV', json.dumps(report))

    def test_rootfs_mutation_rejected(self):
        images, proof, local = fixtures()
        local['API']['RootFS']['Layers'][-1] = 'sha256:' + ('f' * 64)
        with self.assertRaisesRegex(p.Stop, 'ROOTFS_PARITY_FAILED_API'):
            p.assess(images, proof, local)

    def test_runtime_config_drift_fails_closed_without_value(self):
        images, proof, local = fixtures()
        local['WEB']['Config'] = dict(local['WEB']['Config'], Env=['SYNTHETIC=not-repeated'])
        with self.assertRaisesRegex(p.Stop, '^RUNTIME_IMAGE_CONFIG_DRIFT_WEB$'):
            p.assess(images, proof, local)

    def test_wrong_local_image_id_rejected(self):
        images, proof, local = fixtures()
        local['NGINX']['Id'] = 'sha256:' + ('f' * 64)
        with self.assertRaisesRegex(p.Stop, 'LOCAL_BUILDER_ID_MISMATCH_NGINX'):
            p.assess(images, proof, local)

    def test_wrong_revision_label_rejected(self):
        images, proof, local = fixtures()
        updated = dict(local['WEB']['Config'])
        updated['Labels'] = {'org.opencontainers.image.revision': '0' * 40}
        local['WEB']['Config'] = updated
        with self.assertRaisesRegex(p.Stop, 'IMAGE_REVISION_LABEL_MISMATCH_WEB'):
            p.assess(images, proof, local)

    def test_missing_external_role_rejected(self):
        images, proof, local = fixtures()
        del proof['API']
        with self.assertRaisesRegex(p.Stop, 'ROLE_INVENTORY_MISMATCH'):
            p.assess(images, proof, local)

    def test_not_remote_docker_context(self):
        self.assertTrue(p.local_only_endpoint('npipe:////./pipe/dockerDesktopLinuxEngine'))
        self.assertFalse(p.local_only_endpoint('ssh://root@200.141.12.225'))
        self.assertFalse(p.local_only_endpoint('tcp://200.141.12.225:2375'))
        self.assertFalse(p.local_only_endpoint('unix:///var/run/docker.sock'))

    def test_reject_archive_config_path_traversal(self):
        for bad in ('../file.json', '/etc/passwd', 'folder/../../config.json',
                    'C:\\file', 'missing.json', ''):
            with self.assertRaises(p.Stop):
                p.digest_from_path(bad)

    def test_synthetic_archive_manifest_parses_in_both_config_formats(self):
        images, proof, local = fixtures()
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'test.tar'
            records = []
            entries = []
            for i, role in enumerate(p.ROLES):
                cfg = {'config': images[role]['config'],
                       'rootfs': {'diff_ids': images[role]['rootfs']},
                       'architecture': 'amd64', 'os': 'linux'}
                raw = json.dumps(cfg, sort_keys=True).encode()
                digest = hashlib.sha256(raw).hexdigest()
                filename = (f'blobs/sha256/{digest}' if i % 2 else f'{digest}.json')
                layer_names = []
                for j in range(len(images[role]['rootfs'])):
                    lname = f'blobs/sha256/{format(100000 + i * 100 + j, "064x")}'
                    layer_names.append(lname)
                    entries.append((lname, b'x'))
                entries.append((filename, raw))
                records.append({'Config': filename, 'RepoTags': [p.tag_for(role)],
                                'Layers': layer_names})
            entries.append(('manifest.json', json.dumps(records).encode()))
            with tarfile.open(path, 'w') as tar:
                for name, raw in entries:
                    ti = tarfile.TarInfo(name)
                    ti.size = len(raw)
                    tar.addfile(ti, io.BytesIO(raw))
            found = p.read_archive(path)
            self.assertEqual(set(found), set(p.ROLES))
            self.assertEqual(found['API']['rootfs'], images['API']['rootfs'])
            self.assertEqual(found['BACKUP']['rootfs'], images['BACKUP']['rootfs'])

    def test_synthetic_archive_duplicate_member_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'duplicate.tar'
            with tarfile.open(path, 'w') as tar:
                for _ in range(2):
                    info = tarfile.TarInfo('manifest.json')
                    data = b'[]'
                    info.size = len(data)
                    tar.addfile(info, io.BytesIO(data))
            with self.assertRaisesRegex(p.Stop, 'ARCHIVE_MEMBER_UNSAFE_OR_DUPLICATE'):
                p.read_archive(path)


if __name__ == '__main__':
    unittest.main()
