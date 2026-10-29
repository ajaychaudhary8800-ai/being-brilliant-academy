#!/usr/bin/env python3
"""Restore the already verified V5 offsite backup into disposable tmpfs only.
No download/checksum repetition. No connection to live PostgreSQL. Aggregate output only.
"""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tarfile
import tempfile
import time
import uuid

BACKUP = Path('/var/tmp/schoolos-v5-offsite-restore-pplmfhbw')
PROJECT = '96ffcu0jinuwlnaqxpltln4p'
TOKEN = uuid.uuid4().hex
NAME = 'schoolos-v5-recovery-' + TOKEN[:12]
LABEL = 'schoolos.recovery.token=' + TOKEN

def run(args, *, stdin=None, check=True, timeout=300):
    p = subprocess.run(args, stdin=stdin, stdout=subprocess.PIPE,
                       stderr=subprocess.PIPE, timeout=timeout)
    if check and p.returncode:
        raise RuntimeError('Operation failed: ' + args[0] + ' (exit ' + str(p.returncode) + ')')
    return p

def members(archive):
    entries = archive.getmembers()
    seen = set()
    total = 0
    for m in entries:
        p = PurePosixPath(m.name)
        if not m.name or p.is_absolute() or '..' in p.parts or not (m.isfile() or m.isdir()):
            raise RuntimeError('Unsafe archive entry')
        if str(p) in seen:
            raise RuntimeError('Duplicate archive entry')
        seen.add(str(p))
        total += m.size if m.isfile() else 0
        if total > 2 * 1024**3 or len(entries) > 100000:
            raise RuntimeError('Archive exceeds rehearsal resource budget')
    return entries, total

def digest(stream):
    h = hashlib.sha256()
    for block in iter(lambda: stream.read(1024 * 1024), b''):
        h.update(block)
    return h.digest()

def main():
    os.umask(0o077)
    started = time.monotonic()
    cid = None
    output = None
    attempted = False
    passed = False
    cleanup = True
    try:
        if not BACKUP.is_dir() or BACKUP.is_symlink():
            raise RuntimeError('Existing backup directory unavailable')
        for name in ('database.dump', 'files.tar.gz', 'SHA256SUMS'):
            p = BACKUP / name
            if not p.is_file() or p.is_symlink():
                raise RuntimeError('Required backup object unavailable')
        if not hasattr(tarfile, 'data_filter'):
            raise RuntimeError('Python tar data filter required')
        # Validate archive before starting a resource-consuming database.
        with tarfile.open(BACKUP / 'files.tar.gz', 'r:gz') as archive:
            entries, total = members(archive)
        if shutil.disk_usage('/var/tmp').free < total + 1024**3:
            raise RuntimeError('Insufficient temporary disk headroom')
        mem = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())
        if int(mem['MemAvailable'].split()[0]) < 3 * 1024**2:
            raise RuntimeError('At least 3 GiB available RAM required')
        ids = run(['docker', 'ps', '--filter', 'label=com.docker.compose.project=' + PROJECT,
                   '--filter', 'label=com.docker.compose.service=postgres', '--format', '{{.ID}}']).stdout.decode().split()
        if len(ids) != 1:
            raise RuntimeError('Expected one V5 postgres image source')
        image = run(['docker', 'inspect', '--format', '{{.Image}}', ids[0]]).stdout.decode().strip()
        if not image.startswith('sha256:'):
            raise RuntimeError('Image digest unavailable')
        attempted = True
        cid = run(['docker', 'run', '-d', '--rm', '--name', NAME, '--label', LABEL,
                   '--network', 'none', '--read-only', '--user', 'postgres',
                   '--security-opt', 'no-new-privileges', '--cap-drop', 'ALL',
                   '--memory', '1g', '--memory-swap', '1g', '--cpus', '1', '--pids-limit', '128',
                   '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev,size=768m,mode=1777',
                   '--tmpfs', '/var/run/postgresql:rw,nosuid,nodev,size=16m,mode=1777',
                   '--tmpfs', '/tmp:rw,nosuid,nodev,size=64m,mode=1777',
                   '-e', 'PGDATA=/var/lib/postgresql/data/recovery',
                   '-e', 'POSTGRES_USER=recovery_user', '-e', 'POSTGRES_DB=v5_recovery',
                   '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', image, '-c', 'listen_addresses=']).stdout.decode().strip()
        info = json.loads(run(['docker', 'inspect', cid]).stdout)[0]
        if (info['HostConfig']['NetworkMode'] != 'none' or info['HostConfig']['PortBindings']
                or any(m['Type'] != 'tmpfs' for m in info['Mounts'])):
            raise RuntimeError('Disposable target isolation failed')
        base = ['docker', 'exec', '--user', 'postgres', cid]
        for _ in range(45):
            if run(base + ['pg_isready', '-U', 'recovery_user', '-d', 'v5_recovery'], check=False, timeout=10).returncode == 0:
                break
            time.sleep(2)
        else:
            raise RuntimeError('Disposable database startup timeout')
        # Stream from host: protected 0700 backup directories need no permission changes.
        with (BACKUP / 'database.dump').open('rb') as dump:
            run(['docker', 'exec', '-i', '--user', 'postgres', cid, 'pg_restore',
                 '--exit-on-error', '--no-owner', '--no-privileges', '-U', 'recovery_user',
                 '-d', 'v5_recovery'], stdin=dump, timeout=900)
        def sql(query):
            return run(base + ['psql', '-XAt', '-v', 'ON_ERROR_STOP=1', '-U', 'recovery_user',
                              '-d', 'v5_recovery', '-c', query]).stdout.decode().strip()
        counts = sql('SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL), count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) FROM public."_prisma_migrations";')
        if counts != '114|0':
            raise RuntimeError('Migration counts differ from 114/0')
        invalid = sql('SELECT count(*) FROM pg_index WHERE NOT indisvalid OR NOT indisready;')
        if invalid != '0':
            raise RuntimeError('Invalid or unready index found')
        tables = int(sql("SELECT count(*) FROM pg_tables WHERE schemaname='public';"))
        if tables < 2:
            raise RuntimeError('Restored application schema missing')
        # Reads all restored table data; no rows or object names are printed.
        run(base + ['pg_dump', '-U', 'recovery_user', '-d', 'v5_recovery', '-f', '/dev/null'], timeout=900)
        run(base + ['pg_amcheck', '-U', 'recovery_user', '-d', 'v5_recovery', '--install-missing'], timeout=900)
        output = Path(tempfile.mkdtemp(prefix='schoolos-v5-recovered-uploads-', dir='/var/tmp'))
        files = 0
        with tarfile.open(BACKUP / 'files.tar.gz', 'r:gz') as archive:
            entries, total = members(archive)
            archive.extractall(output, members=entries, filter='data')
            for m in entries:
                if m.isfile():
                    with archive.extractfile(m) as source, (output / m.name).open('rb') as restored:
                        if digest(source) != digest(restored):
                            raise RuntimeError('Restored upload byte comparison failed')
                    files += 1
        if sum(p.is_file() for p in output.rglob('*')) != files:
            raise RuntimeError('Restored upload count mismatch')
        print('OFFSITE_DATABASE_RESTORE=PASS\nRESTORED_MIGRATIONS=114\nRESTORED_UNRESOLVED_MIGRATIONS=0')
        print('DATABASE_READBACK=PASS\nDATABASE_AMCHECK=PASS\nINVALID_INDEXES=0')
        print('RESTORED_PUBLIC_TABLES=' + str(tables))
        print('OFFSITE_UPLOADS_RESTORE=PASS\nRESTORED_FILE_COUNT=' + str(files))
        print('RESTORED_FILE_BYTES=' + str(total))
        print('RECOVERY_DATA_SECONDS=' + str(round(time.monotonic() - started, 1)))
        passed = True
    except Exception as exc:
        # Do not emit command stderr, record contents, or archive member names.
        print('RECOVERY_ERROR_TYPE=' + type(exc).__name__)
        if isinstance(exc, RuntimeError):
            print('REASON=' + str(exc))
    finally:
        try:
            if attempted:
                found = run(['docker', 'ps', '-aq', '--filter', 'label=' + LABEL]).stdout.decode().split()
                for owned in found:
                    run(['docker', 'rm', '-f', owned])  # no -v and no live volume operations
                if run(['docker', 'ps', '-aq', '--filter', 'label=' + LABEL]).stdout.strip():
                    raise RuntimeError('Disposable container remains')
        except Exception:
            cleanup = False
        try:
            if output is not None:
                shutil.rmtree(output)
                if output.exists():
                    raise RuntimeError('Extracted files remain')
        except Exception:
            cleanup = False
        print('TEMPORARY_RESOURCES_CLEANED=' + ('YES' if cleanup else 'NO'))
        print('RESTORE_TOTAL_SECONDS=' + str(round(time.monotonic() - started, 1)))
        print('RESTORE_TEST=' + ('PASS' if passed and cleanup else 'FAIL'))
        print('LIVE_DATABASE_CONNECTIONS=NONE\nEXISTING_VOLUMES_CHANGED=NO\nCREDENTIAL_VALUES_PRINTED=NO')
    return 0 if passed and cleanup else 1

if __name__ == '__main__':
    raise SystemExit(main())
