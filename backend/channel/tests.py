"""F6 — per-channel sync depth.

Covers the acceptance contract: download_channel_task caps the YouTube fetch at the
channel's sync_depth (0 = all history), and the new endpoints persist/trigger it with
owner-scoping and an allow-list on the accepted values.

Run: python manage.py test channel --settings=config.settings_test
"""
from unittest import mock

from django.test import TestCase
from rest_framework.test import APIClient

from user.models import Account
from channel.models import Channel


def _make_channel(owner, channel_id, name='Test Channel', **extra):
    return Channel.objects.create(owner=owner, channel_id=channel_id, channel_name=name, **extra)


class _CapturingYDL:
    """Stand-in for yt_dlp.YoutubeDL that records the opts it was constructed with."""
    captured_opts = None

    def __init__(self, opts):
        _CapturingYDL.captured_opts = opts

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False

    def extract_info(self, url, download=False):
        return {'entries': []}


class ChannelSyncDepthTaskTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = Account.objects.create_user('depthuser', 'depth@test.local', 'Depthpw_2026!')

    def _fetch_opts_for_depth(self, sync_depth):
        channel = _make_channel(self.user, f'UC_depth_{sync_depth}', sync_depth=sync_depth)
        _CapturingYDL.captured_opts = None
        from task.tasks import download_channel_task
        with mock.patch('task.tasks.yt_dlp.YoutubeDL', _CapturingYDL), \
                mock.patch('task.tasks.get_yt_dlp_cookies_opts', return_value={}):
            download_channel_task(channel.id)
        return _CapturingYDL.captured_opts

    def test_sync_depth_sets_playlistend(self):
        self.assertEqual(self._fetch_opts_for_depth(200).get('playlistend'), 200)

    def test_default_depth_sets_playlistend_50(self):
        self.assertEqual(self._fetch_opts_for_depth(50).get('playlistend'), 50)

    def test_zero_depth_fetches_all_history(self):
        self.assertNotIn('playlistend', self._fetch_opts_for_depth(0))


class ChannelSyncDepthApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.alice = Account.objects.create_user('alice_ch', 'alice_ch@test.local', 'Alicepw_2026!')
        cls.bob = Account.objects.create_user('bob_ch', 'bob_ch@test.local', 'Bobpw_2026!')

    def setUp(self):
        self.alice_channel = _make_channel(self.alice, 'UC_alice_ch')
        self.client = APIClient()
        self.client.force_authenticate(user=self.alice)

    def _detail_url(self, channel_id='UC_alice_ch'):
        return f'/api/channel/{channel_id}/'

    def _sync_url(self, channel_id='UC_alice_ch'):
        return f'/api/channel/{channel_id}/sync/'

    def test_patch_updates_sync_depth(self):
        resp = self.client.patch(self._detail_url(), {'sync_depth': 100}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.alice_channel.refresh_from_db()
        self.assertEqual(self.alice_channel.sync_depth, 100)

    def test_patch_rejects_disallowed_depth(self):
        resp = self.client.patch(self._detail_url(), {'sync_depth': 999}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.alice_channel.refresh_from_db()
        self.assertEqual(self.alice_channel.sync_depth, 50)

    def test_patch_cross_owner_is_404(self):
        self.client.force_authenticate(user=self.bob)
        resp = self.client.patch(self._detail_url(), {'sync_depth': 100}, format='json')
        self.assertEqual(resp.status_code, 404)
        self.alice_channel.refresh_from_db()
        self.assertEqual(self.alice_channel.sync_depth, 50)

    def test_sync_endpoint_triggers_task(self):
        with mock.patch('task.tasks.download_channel_task.delay') as fake_delay:
            fake_delay.return_value = mock.Mock(id='task-123')
            resp = self.client.post(self._sync_url())
        self.assertEqual(resp.status_code, 202)
        fake_delay.assert_called_once_with(self.alice_channel.id)

    def test_sync_endpoint_conflicts_when_already_syncing(self):
        Channel.objects.filter(id=self.alice_channel.id).update(sync_status='syncing')
        with mock.patch('task.tasks.download_channel_task.delay') as fake_delay:
            resp = self.client.post(self._sync_url())
        self.assertEqual(resp.status_code, 409)
        fake_delay.assert_not_called()

    def test_sync_endpoint_cross_owner_is_404(self):
        self.client.force_authenticate(user=self.bob)
        with mock.patch('task.tasks.download_channel_task.delay') as fake_delay:
            resp = self.client.post(self._sync_url())
        self.assertEqual(resp.status_code, 404)
        fake_delay.assert_not_called()
