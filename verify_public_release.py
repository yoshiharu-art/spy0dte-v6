"""Read-only proof that public Pages assets match a specified source checkout.

This verifies deployed source bytes, not authenticated PAPER account state,
browser rendering, persistence or market IN/OUT behavior. It never calls an API.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import time
from datetime import datetime, timezone
from urllib.parse import urlencode, urljoin, urlsplit
from urllib.request import Request, urlopen


ASSETS = ('index.html', 'signal.js', 'signal.css', 'paper.html', 'sw.js', 'manifest.webmanifest')
PUBLIC_BASE = 'https://yoshiharu-art.github.io/spy0dte-v6/'
MAX_ASSET_BYTES = 2 * 1024 * 1024


def public_fetch(url, timeout):
    request = Request(url, headers={
        'Cache-Control': 'no-cache', 'Pragma': 'no-cache',
        'Accept-Encoding': 'identity', 'User-Agent': 'SPY-PAPER-public-release-verifier/1',
    })
    with urlopen(request, timeout=timeout) as response:
        if response.status != 200:
            raise ValueError('HTTP ' + str(response.status))
        body = response.read(MAX_ASSET_BYTES + 1)
    if len(body) > MAX_ASSET_BYTES:
        raise ValueError('Public asset exceeds the verification size limit')
    return body


def verify_attempt(root, base_url, commit, attempt, deadline, fetch=public_fetch):
    rows = []
    for asset in ASSETS:
        expected = (root / asset).read_bytes()
        expected_hash = hashlib.sha256(expected).hexdigest()
        query = urlencode({'release_verification': commit, 'attempt': attempt,
                           'nonce': time.time_ns()})
        url = urljoin(base_url, asset) + '?' + query
        row = dict(asset=asset, url=url, expected_sha256=expected_hash,
                   expected_bytes=len(expected), public_sha256=None, public_bytes=None)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            row.update(status='UNVERIFIED', error='Verification deadline reached')
        else:
            try:
                public = fetch(url, timeout=min(5.0, remaining))
                public_hash = hashlib.sha256(public).hexdigest()
                row.update(public_sha256=public_hash, public_bytes=len(public),
                           status='MATCHED' if public_hash == expected_hash else 'MISMATCH')
            except Exception as error:
                row.update(status='UNVERIFIED', error=type(error).__name__ + ': ' + str(error))
        rows.append(row)
    return dict(attempt=attempt, assets=rows, matched=all(r['status'] == 'MATCHED' for r in rows))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--expected-commit', required=True)
    parser.add_argument('--base-url', default=PUBLIC_BASE)
    parser.add_argument('--max-wait-seconds', type=float, default=180)
    parser.add_argument('--retry-seconds', type=float, default=10)
    parser.add_argument('--report', default='public-release-verification.json')
    args = parser.parse_args(argv)
    if not re.fullmatch(r'[0-9a-f]{40}', args.expected_commit):
        parser.error('--expected-commit must be the full checkout SHA')
    url = urlsplit(args.base_url)
    if url.scheme != 'https' or not url.netloc or url.username or url.password or url.query or url.fragment:
        parser.error('--base-url must be a public HTTPS URL without credentials, query or fragment')
    if not 0 <= args.max_wait_seconds <= 180 or not 0 < args.retry_seconds <= 30:
        parser.error('Retry budget must be 0–180 seconds and interval must be 0–30 seconds')
    base = args.base_url.rstrip('/') + '/'
    root = Path(__file__).resolve().parent
    started = datetime.now(timezone.utc).isoformat()
    deadline = time.monotonic() + args.max_wait_seconds
    attempts = []
    while True:
        result = verify_attempt(root, base, args.expected_commit, len(attempts) + 1, deadline)
        attempts.append(result)
        unmatched = [row['asset'] + ':' + row['status'] for row in result['assets'] if row['status'] != 'MATCHED']
        print('Public release attempt ' + str(result['attempt']) + ': ' +
              ('all 6 asset hashes matched' if result['matched'] else ', '.join(unmatched)), flush=True)
        if result['matched'] or time.monotonic() >= deadline:
            break
        time.sleep(min(args.retry_seconds, max(0, deadline - time.monotonic())))
    report = dict(version='paper-public-release-verification-1', source_commit=args.expected_commit,
                  public_base_url=base, started_at=started,
                  completed_at=datetime.now(timezone.utc).isoformat(),
                  result='MATCHED' if attempts[-1]['matched'] else 'UNVERIFIED', attempts=attempts,
                  authenticated_account_state='UNVERIFIED', browser_rendering='UNVERIFIED',
                  continuous_scheduled_saves='UNVERIFIED', live_market_in_out='UNVERIFIED',
                  scope='EXACT_PUBLIC_ASSET_BYTES_ONLY; GET_ONLY; NO_AUTHENTICATION_OR_API_CALLS')
    Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return 0 if report['result'] == 'MATCHED' else 1


if __name__ == '__main__':
    raise SystemExit(main())

