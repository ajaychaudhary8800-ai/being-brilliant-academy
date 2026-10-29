#!/usr/bin/env python3
"""Read-only V5-only health probe. No credentials, response bodies or redirects.
Exit 0 healthy, 1 unhealthy. Scheduling/alert delivery are separate acceptance.
"""
import concurrent.futures
import json
import time
import urllib.request

ORIGIN = 'https://v5-staging.beingbrilliantedu.com'
PATHS = ('/', '/api/health/ready', '/api/health/operational')

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def acceptable(path, code, duration, body):
    if code != 200 or duration > 8:
        return False
    if path == '/':
        return True
    try:
        data = json.loads(body)
        if not isinstance(data, dict):
            return False
        if path == '/api/health/ready':
            checks = data.get('checks')
            return (data.get('status') == 'ready' and isinstance(checks, dict)
                    and checks.get('database') is True and checks.get('redis') is True)
        if path == '/api/health/operational':
            workers = data.get('workers')
            return (data.get('status') == 'operational' and isinstance(workers, dict)
                    and all(isinstance(workers.get(k), dict) and workers[k].get('healthy') is True
                            for k in ('notificationDelivery', 'saasLifecycle')))
    except (ValueError, TypeError):
        return False
    return False

def probe(path):
    if path not in PATHS:
        raise ValueError('Unsupported probe')
    start = time.monotonic()
    try:
        opener = urllib.request.build_opener(NoRedirect())
        request = urllib.request.Request(ORIGIN + path, headers={'User-Agent': 'SchoolOS-V5-ReadOnly-Monitor/1'})
        with opener.open(request, timeout=10) as response:
            body = response.read(65537) if path != '/' else b''
            code = response.status
        elapsed = time.monotonic() - start
        good = len(body) <= 65536 and acceptable(path, code, elapsed, body)
        return {'path': path, 'http': code, 'seconds': round(elapsed, 3), 'pass': good}
    except Exception as error:
        return {'path': path, 'pass': False, 'errorType': type(error).__name__}

def main():
    # Hard wall deadline also bounds slow trickle bodies; outputs contain no response body.
    import signal
    import os
    def timeout(signum, frame):
        print('V5_MONITOR=FAIL\nREASON=WALL_TIMEOUT', flush=True)
        os._exit(1)
    signal.signal(signal.SIGALRM, timeout)
    signal.alarm(25)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(probe, PATHS))
    signal.alarm(0)
    for result in results:
        print(json.dumps(result, sort_keys=True))
    success = all(r['pass'] for r in results)
    print('V5_MONITOR=' + ('PASS' if success else 'FAIL'))
    return 0 if success else 1

if __name__ == '__main__':
    raise SystemExit(main())
