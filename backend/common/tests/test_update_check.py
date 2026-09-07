"""Tests for the GitHub update check and the freshness guarantee of /api/version/.

The banner's whole job is to be *correct after an upgrade*, so the two properties worth
locking in are: current_version is always the running build (never cached), and a failed
GitHub lookup fails closed rather than inventing an update.

Run: python manage.py test common.tests --settings=config.settings_test
"""

from unittest import mock

from django.core.cache import cache
from django.test import TestCase, Client

from config.version import APP_VERSION
from common.update_check import _parse_semver, get_update_info
from user.models import Account

FUTURE_VERSION = '99.0.0'


class ParseSemverTests(TestCase):
    def test_strips_the_v_prefix(self):
        self.assertEqual(_parse_semver('v1.16.0'), (1, 16, 0))

    def test_pads_a_two_part_version(self):
        self.assertEqual(_parse_semver('1.2'), (1, 2, 0))

    def test_ignores_a_non_numeric_suffix(self):
        self.assertEqual(_parse_semver('1.16.0-rc1'), (1, 16, 0))

    def test_treats_missing_input_as_zero(self):
        self.assertEqual(_parse_semver(''), (0, 0, 0))
        self.assertEqual(_parse_semver(None), (0, 0, 0))

    def test_orders_versions_numerically_not_lexically(self):
        # '10' < '9' as strings; the tuple comparison is what the banner relies on.
        self.assertGreater(_parse_semver('1.10.0'), _parse_semver('1.9.0'))


class GetUpdateInfoTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)

    def test_reports_an_update_when_github_is_ahead(self):
        github_release = {
            'latest_version': FUTURE_VERSION,
            'release_url': 'https://example.invalid/releases/99',
            'release_notes': 'notes',
            'published_at': '2026-01-01T00:00:00Z',
            'checked': True,
        }
        with mock.patch('common.update_check._fetch_github', return_value=github_release):
            info = get_update_info()

        self.assertTrue(info['update_available'])
        self.assertEqual(info['latest_version'], FUTURE_VERSION)
        # Always the running build, never whatever a previous check cached.
        self.assertEqual(info['current_version'], APP_VERSION)
        self.assertTrue(info['checked'])

    def test_reports_no_update_when_github_matches(self):
        github_release = {
            'latest_version': APP_VERSION,
            'release_url': '',
            'release_notes': '',
            'published_at': None,
            'checked': True,
        }
        with mock.patch('common.update_check._fetch_github', return_value=github_release):
            info = get_update_info()

        self.assertFalse(info['update_available'])
        self.assertEqual(info['current_version'], APP_VERSION)

    def test_fails_closed_when_github_is_unreachable(self):
        with mock.patch('common.update_check._fetch_github', side_effect=RuntimeError('boom')):
            info = get_update_info()

        self.assertFalse(info['checked'])
        self.assertFalse(info['update_available'])
        # A failed lookup must not nag the user, and must not hide the running version.
        self.assertEqual(info['current_version'], APP_VERSION)
        self.assertEqual(info['latest_version'], APP_VERSION)

    def test_current_version_is_live_even_when_the_lookup_is_cached(self):
        github_release = {
            'latest_version': FUTURE_VERSION,
            'release_url': '',
            'release_notes': '',
            'published_at': None,
            'checked': True,
        }
        with mock.patch('common.update_check._fetch_github', return_value=github_release) as fetch:
            get_update_info()
            second = get_update_info()

        # Only the remote lookup is cached; the second call must not re-hit GitHub...
        self.assertEqual(fetch.call_count, 1)
        # ...yet still report the running build rather than a cached current_version.
        self.assertEqual(second['current_version'], APP_VERSION)


class AppVersionEndpointTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = Account.objects.create_user('ver_user', 'ver@test.local', 'Pw_2026!aA')

    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.client = Client()
        self.client.force_login(self.user)

    def test_response_is_never_cached(self):
        with mock.patch('common.update_check._fetch_github', side_effect=RuntimeError('offline')):
            response = self.client.get('/api/version/')

        self.assertEqual(response.status_code, 200)
        # Without no-store a stale banner survives an upgrade, which is the bug this guards.
        self.assertEqual(response['Cache-Control'], 'no-store')
        self.assertEqual(response.json()['current_version'], APP_VERSION)

    def test_requires_authentication(self):
        response = Client().get('/api/version/')
        self.assertIn(response.status_code, (401, 403))
