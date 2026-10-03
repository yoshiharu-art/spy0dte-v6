"""No-network checks: a matched HTML alone must not hide stale JS or errors."""
from pathlib import Path
from tempfile import TemporaryDirectory
import time
import unittest
from urllib.parse import parse_qs, urlsplit

from verify_public_release import ASSETS, PUBLIC_BASE, verify_attempt


class PublicReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        for asset in ASSETS:
            (self.root / asset).write_bytes((asset + ':expected source\n').encode())

    def fetch(self, url, timeout):
        parsed = urlsplit(url)
        query = parse_qs(parsed.query)
        self.assertEqual(query['release_verification'], ['a' * 40])
        self.assertEqual(query['attempt'], ['1'])
        self.assertIn('nonce', query)
        self.assertLessEqual(timeout, 5)
        return (self.root / Path(parsed.path).name).read_bytes()

    def test_all_exact_assets_match(self):
        result = verify_attempt(self.root, PUBLIC_BASE, 'a' * 40, 1, time.monotonic() + 60, self.fetch)
        self.assertTrue(result['matched'])
        self.assertEqual([row['asset'] for row in result['assets']], list(ASSETS))
        self.assertTrue(all(row['status'] == 'MATCHED' for row in result['assets']))

    def test_stale_js_fails_even_when_html_matches(self):
        def stale(url, timeout):
            return b'old release' if urlsplit(url).path.endswith('/organize-ui.js') else self.fetch(url, timeout)
        result = verify_attempt(self.root, PUBLIC_BASE, 'a' * 40, 1, time.monotonic() + 60, stale)
        self.assertFalse(result['matched'])
        failed = [row for row in result['assets'] if row['status'] != 'MATCHED']
        self.assertEqual([row['asset'] for row in failed], ['organize-ui.js'])
        self.assertEqual(failed[0]['status'], 'MISMATCH')
        self.assertNotEqual(failed[0]['expected_sha256'], failed[0]['public_sha256'])

    def test_http_error_is_unverified_instead_of_match(self):
        def error(url, timeout):
            if urlsplit(url).path.endswith('/paper.html'):
                raise ValueError('HTTP 404')
            return self.fetch(url, timeout)
        result = verify_attempt(self.root, PUBLIC_BASE, 'a' * 40, 1, time.monotonic() + 60, error)
        self.assertFalse(result['matched'])
        self.assertEqual(result['assets'][0]['status'], 'UNVERIFIED')
        self.assertEqual(result['assets'][0]['public_sha256'], None)


if __name__ == '__main__':
    unittest.main()
