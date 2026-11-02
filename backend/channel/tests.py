"""F6 — per-channel sync depth.

Covers the acceptance contract: download_channel_task caps the YouTube fetch at the
channel's sync_depth (0 = all history), and the new endpoints persist/trigger it with
owner-scoping and an allow-list on the accepted values.

Run: python manage.py test channel --settings=config.settings_test
"""
import tempfile
from importlib import import_module
from pathlib import Path
from unittest import mock

from django.apps import apps
from django.conf import settings
from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from audio.models import Audio

from user.models import Account
from channel.models import Channel
from channel.serializers import ChannelSerializer
from download.models import DownloadQueue


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
        with mock.patch('task.tasks.yt_dlp.YoutubeDL', _CapturingYDL):
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


class ChannelUnsubscribeKeepsMediaTests(TestCase):
    """SW-002: unsubscribing ends the subscription, not the archive."""

    def setUp(self):
        self.alice = Account.objects.create_user('alice_unsub', 'alice_unsub@test.local', 'Alicepw_2026!')
        self.channel = _make_channel(self.alice, 'UC_unsub')
        self.audio = Audio.objects.create(
            owner=self.alice,
            youtube_id='UNSUB_YT_001',
            title='Archived Track',
            channel_id='UC_unsub',
            channel_name='Channel',
            duration=60,
            file_path='Channel/archived.m4a',
            file_size=1,
            published_date=timezone.now(),
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.alice)

    def test_unsubscribe_stops_sync_and_preserves_audio(self):
        with mock.patch('pathlib.Path.unlink') as unlink, self.captureOnCommitCallbacks(execute=True):
            response = self.client.delete('/api/channel/UC_unsub/')
        self.assertEqual(response.status_code, 200)
        unlink.assert_not_called()
        self.assertTrue(Audio.objects.filter(pk=self.audio.pk, file_path='Channel/archived.m4a').exists())
        self.assertEqual(self.client.get('/api/channel/').json()['data'], [])
        self.assertEqual(self.client.post('/api/channel/UC_unsub/sync/').status_code, 404)

    def test_other_owner_cannot_unsubscribe(self):
        bob = Account.objects.create_user('bob_unsub', 'bob_unsub@test.local', 'Bobpw_2026!')
        client = APIClient()
        client.force_authenticate(user=bob)
        self.assertEqual(client.delete('/api/channel/UC_unsub/').status_code, 404)
        self.assertTrue(Channel.objects.filter(pk=self.channel.pk).exists())


class ChannelPaginationTests(TestCase):
    """SW-010: at 50 subscriptions the old endpoint ignored `page` and the client looped forever."""

    def setUp(self):
        self.alice = Account.objects.create_user('alice_page', 'alice_page@test.local', 'Alicepw_2026!')
        self.bob = Account.objects.create_user('bob_page', 'bob_page@test.local', 'Bobpw_2026!')
        self.client = APIClient()
        self.client.force_authenticate(user=self.alice)
        _make_channel(self.bob, 'UC_bob_only', name='A Channel')

    def _subscribe(self, total):
        # The same name throughout: the order must still be total.
        for index in range(total):
            _make_channel(self.alice, f'UC_{index}', name='Same Name')

    def _traverse(self):
        """Walk `next` the way a client does, with a bound so a broken server fails, not hangs."""
        seen = []
        page = 1
        requests = 0
        while page is not None:
            requests += 1
            self.assertLess(requests, 10, 'pagination did not terminate')
            body = self.client.get('/api/channel/', {'page': page}).json()
            seen += [row['channel_id'] for row in body['data']]
            page = body['next']
        return seen, requests, body

    def test_boundaries_return_each_channel_exactly_once(self):
        for total, expected_requests in ((49, 1), (50, 1), (51, 2), (100, 2), (101, 3)):
            with self.subTest(total):
                Channel.objects.filter(owner=self.alice).delete()
                self._subscribe(total)
                seen, requests, body = self._traverse()
                self.assertEqual(sorted(seen), sorted(f'UC_{index}' for index in range(total)))
                self.assertEqual(requests, expected_requests)
                self.assertEqual(body['count'], total)

    def test_order_is_total_so_ties_cannot_repeat_between_pages(self):
        # Databases may order ties differently per query, so this checks the SQL itself.
        self._subscribe(2)
        with CaptureQueriesContext(connection) as queries:
            self.client.get('/api/channel/')
        ordered = [query['sql'] for query in queries if 'ORDER BY' in query['sql'] and 'channel_channel' in query['sql']]
        self.assertRegex(ordered[-1], r'ORDER BY .*"channel_name".*"id"')

    def test_no_subscriptions(self):
        body = self.client.get('/api/channel/').json()
        self.assertEqual((body['data'], body['count'], body['next']), ([], 0, None))

    def test_other_owners_channels_are_excluded(self):
        self._subscribe(1)
        seen, _, body = self._traverse()
        self.assertEqual(seen, ['UC_0'])
        self.assertEqual(body['count'], 1)

    def test_a_page_past_the_end_is_empty_and_final(self):
        self._subscribe(3)
        body = self.client.get('/api/channel/', {'page': 99}).json()
        self.assertEqual((body['data'], body['next']), ([], None))

    def test_malformed_pages_are_refused(self):
        for bad_page in ('abc', '0', '-1', '1.5', ''):
            with self.subTest(bad_page):
                self.assertEqual(self.client.get('/api/channel/', {'page': bad_page}).status_code, 400)


class _ListingYDL(_CapturingYDL):
    """Stand-in for yt_dlp.YoutubeDL returning a fixed channel listing."""
    entries = [{'id': 'LISTED_1', 'title': 'One'}, {'id': 'LISTED_2', 'title': 'Two'}]

    def extract_info(self, url, download=False):
        return {'entries': self.entries}


class ChannelCountTests(TestCase):
    """SW-012: a channel's counts describe that channel, not everything its owner has."""

    def setUp(self):
        media_root = tempfile.TemporaryDirectory()
        self.addCleanup(media_root.cleanup)
        settings_override = override_settings(MEDIA_ROOT=media_root.name)
        settings_override.enable()
        self.addCleanup(settings_override.disable)
        self.owner = Account.objects.create_user('count_u', 'count_u@test.local', 'Countpw_2026!')
        self.stranger = Account.objects.create_user('count_s', 'count_s@test.local', 'Countpw_2026!')
        self.channel = _make_channel(self.owner, 'UC_counted', name='Counted', sync_depth=0, video_count=9)

    def _track(self, owner, youtube_id, channel_id='UC_counted', on_disk=True):
        file_path = f'{owner.pk}-{youtube_id}.m4a'
        if on_disk:
            (Path(settings.MEDIA_ROOT) / file_path).write_bytes(b'audio')
        return Audio.objects.create(
            owner=owner, youtube_id=youtube_id, title=youtube_id, channel_id=channel_id,
            channel_name='Any', duration=1, file_path=file_path, file_size=5,
            published_date=timezone.now(),
        )

    def _sync(self):
        from task.tasks import download_channel_task
        with mock.patch('task.tasks.yt_dlp.YoutubeDL', _ListingYDL), \
                mock.patch('task.tasks.download_audio_task.delay'):
            download_channel_task(self.channel.id)
        self.channel.refresh_from_db()

    def test_downloaded_count_is_this_owners_files_from_this_channel(self):
        self._track(self.owner, 'LISTED_1')
        self._track(self.owner, 'ELSEWHERE', channel_id='UC_other')
        self._track(self.owner, 'NO_FILE', on_disk=False)
        self._track(self.stranger, 'LISTED_2')

        self._sync()

        self.assertEqual(self.channel.downloaded_count, 1)

    def test_track_from_another_channel_still_is_not_queued_again(self):
        self._track(self.owner, 'LISTED_1', channel_id='UC_other')

        self._sync()

        self.assertFalse(DownloadQueue.objects.filter(owner=self.owner, youtube_id='LISTED_1').exists())
        self.assertTrue(DownloadQueue.objects.filter(owner=self.owner, youtube_id='LISTED_2').exists())

    def test_full_scan_updates_the_remote_total_but_a_capped_scan_does_not(self):
        self._sync()
        self.assertEqual(self.channel.video_count, 2)

        self.channel.sync_depth = 25
        self.channel.video_count = 9
        self.channel.save()
        self._sync()
        self.assertEqual(self.channel.video_count, 9)

    def test_progress_measures_what_the_sync_depth_can_reach(self):
        self.channel.video_count = 1000
        self.channel.sync_depth = 50
        self.channel.downloaded_count = 25
        self.assertEqual(ChannelSerializer(self.channel).data['progress_percent'], 50)

        self.channel.downloaded_count = 80
        self.assertEqual(ChannelSerializer(self.channel).data['progress_percent'], 100)

    def test_outstanding_work_is_this_owners_rows_for_this_channel(self):
        rows = [
            (self.owner, 'Counted', 'P', 'pending'),
            (self.owner, 'Counted', 'F', 'failed'),
            (self.owner, 'Other', 'O', 'failed'),
            (self.stranger, 'Counted', 'S', 'failed'),
        ]
        for owner, channel_name, youtube_id, status in rows:
            DownloadQueue.objects.create(
                owner=owner, channel_name=channel_name, youtube_id=youtube_id, status=status,
                url=f'https://www.youtube.com/watch?v={youtube_id}',
            )

        data = ChannelSerializer(self.channel).data

        self.assertEqual((data['pending'], data['failed']), (1, 1))
        self.assertEqual(data['remote_total'], self.channel.video_count)

    def test_backfill_scopes_counts_without_touching_tracks(self):
        self.channel.downloaded_count = 50
        self.channel.save()
        self._track(self.owner, 'LISTED_1')
        self._track(self.owner, 'ELSEWHERE', channel_id='UC_other')
        tracks_before = Audio.objects.count()

        import_module('channel.migrations.0004_scope_downloaded_counts').scope_downloaded_counts_to_channel(apps, None)

        self.channel.refresh_from_db()
        self.assertEqual(self.channel.downloaded_count, 1)
        self.assertEqual(Audio.objects.count(), tracks_before)
