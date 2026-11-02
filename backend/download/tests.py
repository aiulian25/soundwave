"""F15 — activity center backend surface.

The activity center reuses the existing download endpoints: the queue list (now with
filter=all for one-request grouping) and the per-item retry. These tests lock in the
filter=all extension, owner-scoping, error_message exposure, and the retry flip.

Run: python manage.py test download --settings=config.settings_test
"""
import threading
import wave
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import timedelta
from unittest import mock, skipUnless

from django.db import DatabaseError, IntegrityError, OperationalError, connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase, TransactionTestCase
from django.utils import timezone
from rest_framework.test import APIClient

from audio.storage_service import absolute_media_path
from audio.models import Audio
from channel.models import Channel
from playlist.models import Playlist
from task.tasks import (
    _publish_download,
    download_audio_task,
    download_playlist_task,
    reset_stuck_downloads,
    retry_failed_downloads,
)
from user.models import Account
from download.claims import canonical_download_url, claim_download, keep_claim_alive, renew_claim
from download.models import DownloadQueue


def _queue(owner, url, status='pending', **extra):
    return DownloadQueue.objects.create(owner=owner, url=url, status=status, **extra)


class DownloadListFilterTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.alice = Account.objects.create_user('alice_dl', 'alice_dl@test.local', 'Alicepw_2026!')
        cls.bob = Account.objects.create_user('bob_dl', 'bob_dl@test.local', 'Bobpw_2026!')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.alice)

    def test_filter_all_returns_every_status(self):
        _queue(self.alice, 'https://www.youtube.com/watch?v=a', status='pending')
        _queue(self.alice, 'https://www.youtube.com/watch?v=b', status='downloading')
        _queue(self.alice, 'https://www.youtube.com/watch?v=c', status='failed', error_message='boom')
        _queue(self.alice, 'https://www.youtube.com/watch?v=d', status='completed')
        resp = self.client.get('/api/download/?filter=all')
        self.assertEqual(resp.status_code, 200)
        statuses = sorted(row['status'] for row in resp.json()['data'])
        self.assertEqual(statuses, ['completed', 'downloading', 'failed', 'pending'])

    def test_default_filter_is_pending(self):
        _queue(self.alice, 'https://www.youtube.com/watch?v=a', status='pending')
        _queue(self.alice, 'https://www.youtube.com/watch?v=b', status='failed')
        resp = self.client.get('/api/download/')
        self.assertEqual(resp.status_code, 200)
        rows = resp.json()['data']
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['status'], 'pending')

    def test_filter_all_is_owner_scoped(self):
        _queue(self.alice, 'https://www.youtube.com/watch?v=a', status='pending')
        _queue(self.bob, 'https://www.youtube.com/watch?v=z', status='pending')
        resp = self.client.get('/api/download/?filter=all')
        urls = [row['url'] for row in resp.json()['data']]
        self.assertEqual(urls, ['https://www.youtube.com/watch?v=a'])

    def test_failed_row_exposes_error_message(self):
        _queue(self.alice, 'https://www.youtube.com/watch?v=c', status='failed', error_message='ffmpeg failed')
        resp = self.client.get('/api/download/?filter=failed')
        rows = resp.json()['data']
        self.assertEqual(rows[0]['error_message'], 'ffmpeg failed')


class RetryTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.alice = Account.objects.create_user('alice_rt', 'alice_rt@test.local', 'Alicepw_2026!')
        cls.bob = Account.objects.create_user('bob_rt', 'bob_rt@test.local', 'Bobpw_2026!')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.alice)

    def test_retry_flips_failed_to_pending_and_redispatches(self):
        item = _queue(self.alice, 'https://www.youtube.com/watch?v=x', status='failed', error_message='boom')
        with mock.patch('task.tasks.download_audio_task.delay') as fake_delay:
            resp = self.client.post('/api/download/retry/', {'id': item.id}, format='json')
        self.assertEqual(resp.status_code, 200)
        item.refresh_from_db()
        self.assertEqual(item.status, 'pending')
        fake_delay.assert_called_once_with(item.id)

    def test_retry_cross_owner_is_404(self):
        item = _queue(self.bob, 'https://www.youtube.com/watch?v=z', status='failed')
        with mock.patch('task.tasks.download_audio_task.delay') as fake_delay:
            resp = self.client.post('/api/download/retry/', {'id': item.id}, format='json')
        self.assertEqual(resp.status_code, 404)
        fake_delay.assert_not_called()
        item.refresh_from_db()
        self.assertEqual(item.status, 'failed')  # unchanged


class IgnoreTests(TestCase):
    """Dismissing a permanently-dead download flips it to 'ignored' (stops the nagging)."""

    @classmethod
    def setUpTestData(cls):
        cls.alice = Account.objects.create_user('alice_ig', 'alice_ig@test.local', 'Alicepw_2026!')
        cls.bob = Account.objects.create_user('bob_ig', 'bob_ig@test.local', 'Bobpw_2026!')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.alice)

    def test_ignore_flips_failed_to_ignored(self):
        item = _queue(self.alice, 'https://www.youtube.com/watch?v=x', status='failed', error_message='removed')
        resp = self.client.post('/api/download/ignore/', {'id': item.id}, format='json')
        self.assertEqual(resp.status_code, 200)
        item.refresh_from_db()
        self.assertEqual(item.status, 'ignored')

    def test_ignore_all_dismisses_only_failed(self):
        _queue(self.alice, 'https://www.youtube.com/watch?v=a', status='failed')
        _queue(self.alice, 'https://www.youtube.com/watch?v=b', status='failed')
        keep = _queue(self.alice, 'https://www.youtube.com/watch?v=c', status='pending')
        resp = self.client.post('/api/download/ignore/', {}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['count'], 2)
        self.assertEqual(DownloadQueue.objects.filter(owner=self.alice, status='ignored').count(), 2)
        keep.refresh_from_db()
        self.assertEqual(keep.status, 'pending')  # non-failed untouched

    def test_ignore_cross_owner_is_404(self):
        item = _queue(self.bob, 'https://www.youtube.com/watch?v=z', status='failed')
        resp = self.client.post('/api/download/ignore/', {'id': item.id}, format='json')
        self.assertEqual(resp.status_code, 404)
        item.refresh_from_db()
        self.assertEqual(item.status, 'failed')  # unchanged


class ActivityFeedShapeTests(TestCase):
    """CODE_REVIEW_REPORT Step 16 — dismissed rows are tombstones, not activity."""

    @classmethod
    def setUpTestData(cls):
        cls.alice = Account.objects.create_user('alice_feed', 'alice_feed@test.local', 'Alicepw_2026!')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.alice)

    def test_filter_all_omits_ignored_rows(self):
        _queue(self.alice, 'https://www.youtube.com/watch?v=keep', status='failed')
        _queue(self.alice, 'https://www.youtube.com/watch?v=gone', status='ignored')
        resp = self.client.get('/api/download/?filter=all')
        statuses = [row['status'] for row in resp.json()['data']]
        self.assertEqual(statuses, ['failed'])

    def test_ignored_rows_remain_addressable_by_explicit_filter(self):
        # Excluding them from the feed must not make them unqueryable — the row still exists
        # and 'ignored' is a real status a client may ask for.
        _queue(self.alice, 'https://www.youtube.com/watch?v=gone', status='ignored')
        resp = self.client.get('/api/download/?filter=ignored')
        self.assertEqual(len(resp.json()['data']), 1)

    def test_feed_is_newest_first(self):
        older = _queue(self.alice, 'https://www.youtube.com/watch?v=old', status='completed')
        newer = _queue(self.alice, 'https://www.youtube.com/watch?v=new', status='completed')
        resp = self.client.get('/api/download/?filter=all')
        ids = [row['id'] for row in resp.json()['data']]
        self.assertEqual(ids, [newer.id, older.id])


class ClearQueueTests(TestCase):
    """CODE_REVIEW_REPORT Step 15 — DELETE honours the same filter the list does."""

    @classmethod
    def setUpTestData(cls):
        cls.alice = Account.objects.create_user('alice_clear', 'alice_clear@test.local', 'Alicepw_2026!')
        cls.bob = Account.objects.create_user('bob_clear', 'bob_clear@test.local', 'Bobpw_2026!')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.alice)

    def test_delete_all_clears_every_status(self):
        _queue(self.alice, 'https://www.youtube.com/watch?v=a', status='pending')
        _queue(self.alice, 'https://www.youtube.com/watch?v=b', status='failed')
        _queue(self.alice, 'https://www.youtube.com/watch?v=c', status='completed')

        resp = self.client.delete('/api/download/?filter=all')

        self.assertEqual(resp.status_code, 204)
        self.assertEqual(DownloadQueue.objects.filter(owner=self.alice).count(), 0)

    def test_delete_defaults_to_pending_only(self):
        _queue(self.alice, 'https://www.youtube.com/watch?v=a', status='pending')
        _queue(self.alice, 'https://www.youtube.com/watch?v=b', status='failed')

        resp = self.client.delete('/api/download/')

        self.assertEqual(resp.status_code, 204)
        remaining = list(DownloadQueue.objects.filter(owner=self.alice).values_list('status', flat=True))
        self.assertEqual(remaining, ['failed'])

    def test_delete_of_one_status_leaves_the_others(self):
        _queue(self.alice, 'https://www.youtube.com/watch?v=a', status='pending')
        _queue(self.alice, 'https://www.youtube.com/watch?v=b', status='failed')

        resp = self.client.delete('/api/download/?filter=failed')

        self.assertEqual(resp.status_code, 204)
        remaining = list(DownloadQueue.objects.filter(owner=self.alice).values_list('status', flat=True))
        self.assertEqual(remaining, ['pending'])

    def test_delete_all_never_touches_another_owner(self):
        _queue(self.alice, 'https://www.youtube.com/watch?v=a', status='pending')
        _queue(self.bob, 'https://www.youtube.com/watch?v=z', status='pending')

        self.client.delete('/api/download/?filter=all')

        self.assertEqual(DownloadQueue.objects.filter(owner=self.bob).count(), 1)


WATCH_URL = 'https://www.youtube.com/watch?v=CLAIM_YT_001'
YOUTUBE_ID = 'CLAIM_YT_001'
RELATIVE_FILE_PATH = 'Channel/Claimed-CLAIM_YT_001.wav'


class FakeYoutubeDL:
    """Stands in for a finished download; `during_download` lets a test act mid-flight."""

    extractions = []
    during_download = staticmethod(lambda: None)
    fail_with = None

    def __init__(self, options):
        self.options = options

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False

    def extract_info(self, url, download=False):
        FakeYoutubeDL.extractions.append(url)
        return {'id': YOUTUBE_ID, 'title': 'Claimed', 'channel': 'Channel'}

    def process_ie_result(self, info, download=True):
        FakeYoutubeDL.during_download()
        for hook in self.options.get('progress_hooks', []):
            hook({})
        if FakeYoutubeDL.fail_with:
            raise FakeYoutubeDL.fail_with
        path = absolute_media_path(RELATIVE_FILE_PATH)
        path.parent.mkdir(parents=True, exist_ok=True)
        with wave.open(str(path), 'wb') as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(8000)
            output.writeframes(bytes(1600))
        return {**info, 'requested_downloads': [{'filepath': str(path)}]}


class WorkerTestMixin:
    """Everything outbound is replaced; the task body and database work run for real."""

    def setUp(self):
        super().setUp()
        FakeYoutubeDL.extractions = []
        FakeYoutubeDL.during_download = staticmethod(lambda: None)
        FakeYoutubeDL.fail_with = None
        for active_patch in (
            mock.patch('task.tasks.yt_dlp.YoutubeDL', FakeYoutubeDL),
            mock.patch('common.url_security.check_public_http_url', return_value=(True, None)),
            mock.patch('audio.storage_service.shutil.disk_usage', return_value=mock.Mock(free=10 ** 12)),
            mock.patch('task.tasks._resolve_download_quality', return_value='opus'),
            mock.patch('task.tasks._ext_for_quality', return_value='opus'),
            mock.patch('task.tasks._postprocessor_for_quality', return_value={}),
            mock.patch('task.tasks.link_audio_to_playlists.delay'),
            mock.patch('task.tasks.measure_loudness_task.delay'),
            mock.patch('task.tasks.extract_features_task.delay'),
        ):
            active_patch.start()
            self.addCleanup(active_patch.stop)

    def queue_row(self, owner, **fields):
        fields.setdefault('url', WATCH_URL)
        fields.setdefault('youtube_id', YOUTUBE_ID)
        return DownloadQueue.objects.create(owner=owner, **fields)


class DownloadClaimTests(WorkerTestMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.owner = Account.objects.create_user('claim_u', 'claim_u@test.local', 'Claimpw_2026!')

    def test_duplicate_delivery_downloads_and_publishes_once(self):
        row = self.queue_row(self.owner)
        download_audio_task(row.pk)
        download_audio_task(row.pk)
        self.assertEqual(len(FakeYoutubeDL.extractions), 1)
        self.assertEqual(Audio.objects.filter(owner=self.owner).count(), 1)
        row.refresh_from_db()
        self.assertEqual(row.status, 'completed')
        self.assertIsNone(row.claim_token)

    def test_only_pending_rows_can_be_claimed(self):
        for status_value in ('completed', 'failed', 'ignored', 'downloading'):
            with self.subTest(status_value):
                row = self.queue_row(self.owner, url=f'{WATCH_URL}-{status_value}', status=status_value)
                self.assertIsNone(claim_download(row.pk))
                row.refresh_from_db()
                self.assertEqual(row.status, status_value)

    def test_missing_row_is_a_no_op(self):
        self.assertIsNone(download_audio_task(999999))
        self.assertEqual(FakeYoutubeDL.extractions, [])

    def test_clearing_the_queue_during_a_download_prevents_publication(self):
        row = self.queue_row(self.owner)
        FakeYoutubeDL.during_download = staticmethod(lambda: DownloadQueue.objects.filter(pk=row.pk).delete())
        download_audio_task(row.pk)
        self.assertFalse(Audio.objects.exists())
        self.assertFalse(DownloadQueue.objects.filter(pk=row.pk).exists())

    def test_lost_lease_prevents_publication_and_stale_saves(self):
        row = self.queue_row(self.owner)
        new_owner_token = uuid.uuid4()

        def another_worker_takes_over():
            DownloadQueue.objects.filter(pk=row.pk).update(claim_token=new_owner_token)

        FakeYoutubeDL.during_download = staticmethod(another_worker_takes_over)
        download_audio_task(row.pk)
        self.assertFalse(Audio.objects.exists())
        row.refresh_from_db()
        self.assertEqual(row.status, 'downloading')
        self.assertEqual(row.claim_token, new_owner_token)

    def test_owner_deleted_during_a_download_never_reappears(self):
        row = self.queue_row(self.owner)
        owner_id = self.owner.pk
        FakeYoutubeDL.during_download = staticmethod(lambda: Account.objects.filter(pk=owner_id).delete())
        download_audio_task(row.pk)
        self.assertFalse(Audio.objects.filter(owner_id=owner_id).exists())
        self.assertFalse(Account.objects.filter(pk=owner_id).exists())
        self.assertFalse(DownloadQueue.objects.filter(pk=row.pk).exists())

    def test_failure_is_recorded_and_raised_while_the_claim_is_held(self):
        row = self.queue_row(self.owner)
        FakeYoutubeDL.fail_with = RuntimeError('synthetic failure')
        with self.assertRaises(RuntimeError):
            download_audio_task(row.pk)
        row.refresh_from_db()
        self.assertEqual(row.status, 'failed')
        self.assertIn('synthetic failure', row.error_message)
        self.assertIsNone(row.claim_token)

    def test_failure_after_losing_the_claim_overwrites_nothing(self):
        row = self.queue_row(self.owner)

        def user_dismisses_it():
            DownloadQueue.objects.filter(pk=row.pk).update(status='ignored', claim_token=None)

        FakeYoutubeDL.during_download = staticmethod(user_dismisses_it)
        FakeYoutubeDL.fail_with = RuntimeError('synthetic failure')
        download_audio_task(row.pk)
        row.refresh_from_db()
        self.assertEqual(row.status, 'ignored')
        self.assertEqual(row.error_message, '')

    def test_redownload_keeps_the_existing_audio_row(self):
        audio = Audio.objects.create(
            owner=self.owner, youtube_id=YOUTUBE_ID, title='Old', channel_id='UC', channel_name='C',
            duration=1, file_path='old/path.m4a', file_size=1, published_date=timezone.now(),
        )
        download_audio_task(self.queue_row(self.owner).pk)
        audio.refresh_from_db()
        self.assertEqual(audio.file_path, RELATIVE_FILE_PATH)
        self.assertEqual(Audio.objects.filter(owner=self.owner).count(), 1)

    def test_lost_claim_stops_a_running_download(self):
        row = self.queue_row(self.owner)
        FakeYoutubeDL.during_download = staticmethod(lambda: DownloadQueue.objects.filter(pk=row.pk).delete())

        @contextmanager
        def already_lost(_queue_id, _token):
            claim_lost = threading.Event()
            claim_lost.set()
            yield claim_lost

        with mock.patch('task.tasks.keep_claim_alive', already_lost), \
                mock.patch('task.tasks._publish_download') as publish:
            download_audio_task(row.pk)
        publish.assert_not_called()


class LeaseTests(WorkerTestMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.owner = Account.objects.create_user('lease_u', 'lease_u@test.local', 'Leasepw_2026!')

    def running_row(self, **fields):
        return self.queue_row(self.owner, status='downloading', claim_token=uuid.uuid4(), **fields)

    def test_active_work_older_than_thirty_minutes_is_left_alone(self):
        row = self.running_row(
            started_date=timezone.now() - timedelta(hours=3),
            lease_expires_at=timezone.now() + timedelta(minutes=4),
        )
        reset_stuck_downloads()
        row.refresh_from_db()
        self.assertEqual(row.status, 'downloading')

    def test_a_crashed_worker_is_recovered_exactly_once(self):
        row = self.running_row(
            started_date=timezone.now() - timedelta(minutes=6),
            lease_expires_at=timezone.now() - timedelta(minutes=1),
        )
        reset_stuck_downloads()
        row.refresh_from_db()
        self.assertEqual(row.status, 'failed')
        self.assertIsNone(row.claim_token)

        with mock.patch('task.tasks.download_audio_task.delay') as delay:
            retry_failed_downloads()
        delay.assert_called_once_with(row.pk)

        download_audio_task(row.pk)
        download_audio_task(row.pk)
        self.assertEqual(len(FakeYoutubeDL.extractions), 1)

    def test_rows_claimed_before_leases_existed_are_still_recovered(self):
        stale = self.queue_row(self.owner, status='downloading', started_date=timezone.now() - timedelta(hours=1))
        recent = self.queue_row(
            self.owner, url=f'{WATCH_URL}-recent', status='downloading', started_date=timezone.now()
        )
        reset_stuck_downloads()
        stale.refresh_from_db()
        recent.refresh_from_db()
        self.assertEqual(stale.status, 'failed')
        self.assertEqual(recent.status, 'downloading')

    def test_renewal_extends_only_a_held_claim(self):
        row = self.queue_row(self.owner)
        token = claim_download(row.pk)
        DownloadQueue.objects.filter(pk=row.pk).update(lease_expires_at=timezone.now())
        self.assertTrue(renew_claim(row.pk, token))
        row.refresh_from_db()
        self.assertGreater(row.lease_expires_at, timezone.now() + timedelta(minutes=4))
        self.assertFalse(renew_claim(row.pk, uuid.uuid4()))

    def test_heartbeat_reports_a_lost_claim(self):
        with mock.patch('download.claims.HEARTBEAT_INTERVAL_SECONDS', 0.01), \
                mock.patch('download.claims.renew_claim', return_value=False):
            with keep_claim_alive(1, uuid.uuid4()) as claim_lost:
                self.assertTrue(claim_lost.wait(2))

    def test_heartbeat_survives_a_database_blip(self):
        with mock.patch('download.claims.HEARTBEAT_INTERVAL_SECONDS', 0.01), \
                mock.patch('download.claims.renew_claim', side_effect=DatabaseError('synthetic')) as renew:
            with keep_claim_alive(1, uuid.uuid4()) as claim_lost:
                deadline = time.monotonic() + 5
                while renew.call_count < 2 and time.monotonic() < deadline:
                    time.sleep(0.01)
                self.assertGreaterEqual(renew.call_count, 2)
                self.assertFalse(claim_lost.is_set())


class QueueIdentityTests(WorkerTestMixin, TestCase):
    URL_SPELLINGS = (
        'https://www.youtube.com/watch?v=CLAIM_YT_001',
        'https://youtube.com/watch?v=CLAIM_YT_001&list=PL123&index=4',
        'https://m.youtube.com/watch?t=30&v=CLAIM_YT_001',
        'https://music.youtube.com/watch?v=CLAIM_YT_001',
        'https://youtu.be/CLAIM_YT_001?si=abc',
        'https://www.youtube.com/shorts/CLAIM_YT_001',
    )

    def setUp(self):
        super().setUp()
        self.owner = Account.objects.create_user('ident_u', 'ident_u@test.local', 'Identpw_2026!')
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def test_spellings_of_one_video_share_a_key(self):
        self.assertEqual({canonical_download_url(url) for url in self.URL_SPELLINGS}, {WATCH_URL})

    def test_other_urls_are_left_as_they_are(self):
        for url in ('https://www.youtube.com/playlist?list=PL123', 'https://example.test/watch?v=abc'):
            with self.subTest(url):
                self.assertEqual(canonical_download_url(url), url)

    def test_submitting_one_video_many_ways_creates_one_row_and_one_download(self):
        with mock.patch('task.tasks.download_audio_task.delay') as delay, \
                mock.patch('download.serializers.check_public_http_url', return_value=(True, None)):
            response = self.client.post(
                '/api/download/', {'urls': list(self.URL_SPELLINGS), 'auto_start': True}, format='json'
            )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(DownloadQueue.objects.filter(owner=self.owner).count(), 1)
        delay.assert_called_once()

    def test_database_refuses_a_duplicate(self):
        self.queue_row(self.owner)
        with self.assertRaises(IntegrityError), transaction.atomic():
            self.queue_row(self.owner)

    def test_two_owners_can_queue_the_same_video(self):
        other = Account.objects.create_user('ident_v', 'ident_v@test.local', 'Identpw_2026!')
        self.queue_row(self.owner)
        self.queue_row(other)
        self.assertEqual(DownloadQueue.objects.count(), 2)

    def test_internal_fields_stay_out_of_the_api(self):
        row = self.queue_row(self.owner, claim_token=uuid.uuid4(), status='downloading')
        data = self.client.get('/api/download/', {'filter': 'all'}).json()['data'][0]
        self.assertEqual(data['id'], row.pk)
        self.assertFalse({'claim_token', 'lease_expires_at', 'source_playlist_id'} & set(data))

    def _redownload_through_audio_view(self, audio):
        with mock.patch('task.tasks.download_audio_task.delay') as delay:
            response = self.client.post(f'/api/audio/{audio.youtube_id}/', {'action': 'download'}, format='json')
        return response, delay

    def test_redownloading_a_failed_track_requeues_it_so_it_can_be_claimed(self):
        audio = Audio.objects.create(
            owner=self.owner, youtube_id=YOUTUBE_ID, title='T', channel_id='UC', channel_name='C',
            duration=1, file_path='', file_size=0, published_date=timezone.now(),
        )
        row = self.queue_row(self.owner, status='failed')
        response, delay = self._redownload_through_audio_view(audio)
        self.assertEqual(response.status_code, 202, response.content)
        delay.assert_called_once_with(row.pk)
        self.assertIsNotNone(claim_download(row.pk))

    def test_a_row_submitted_with_no_youtube_id_is_found_not_duplicated(self):
        audio = Audio.objects.create(
            owner=self.owner, youtube_id=YOUTUBE_ID, title='T', channel_id='UC', channel_name='C',
            duration=1, file_path='', file_size=0, published_date=timezone.now(),
        )
        self.queue_row(self.owner, youtube_id='')
        response, _ = self._redownload_through_audio_view(audio)
        self.assertLess(response.status_code, 500, response.content)
        self.assertEqual(DownloadQueue.objects.filter(owner=self.owner).count(), 1)


class SubscriptionRemovalTests(WorkerTestMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.owner = Account.objects.create_user('subs_u', 'subs_u@test.local', 'Subspw_2026!')
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def rows_by_status(self, **source):
        return {
            status_value: self.queue_row(self.owner, url=f'{WATCH_URL}-{status_value}', status=status_value, **source)
            for status_value in ('pending', 'downloading', 'failed', 'completed', 'ignored')
        }

    def assert_only_finished_and_tombstones_remain(self, rows):
        remaining = set(DownloadQueue.objects.filter(pk__in=[row.pk for row in rows.values()]).values_list('status', flat=True))
        self.assertEqual(remaining, {'completed', 'ignored'})

    def test_unsubscribing_cancels_work_it_started(self):
        Channel.objects.create(owner=self.owner, channel_id='UC_subs', channel_name='Subscribed Channel')
        rows = self.rows_by_status(channel_name='Subscribed Channel')
        unrelated = self.queue_row(self.owner, url=f'{WATCH_URL}-other', channel_name='Another Channel')
        self.assertEqual(self.client.delete('/api/channel/UC_subs/').status_code, 200)
        self.assert_only_finished_and_tombstones_remain(rows)
        self.assertTrue(DownloadQueue.objects.filter(pk=unrelated.pk).exists())

    def test_deleting_a_playlist_cancels_work_it_started(self):
        Playlist.objects.create(owner=self.owner, playlist_id='PL_subs', title='Subscribed')
        rows = self.rows_by_status(source_playlist_id='PL_subs')
        manual = self.queue_row(self.owner, url=f'{WATCH_URL}-manual')
        self.assertEqual(self.client.delete('/api/playlist/PL_subs/').status_code, 200)
        self.assert_only_finished_and_tombstones_remain(rows)
        self.assertTrue(DownloadQueue.objects.filter(pk=manual.pk).exists())

    def test_cancelling_does_not_reach_another_owner(self):
        other = Account.objects.create_user('subs_v', 'subs_v@test.local', 'Subspw_2026!')
        theirs = self.queue_row(other, channel_name='Subscribed Channel')
        Channel.objects.create(owner=self.owner, channel_id='UC_subs', channel_name='Subscribed Channel')
        self.client.delete('/api/channel/UC_subs/')
        self.assertTrue(DownloadQueue.objects.filter(pk=theirs.pk).exists())


class PlaylistSyncTombstoneTests(WorkerTestMixin, TestCase):
    class EntriesYDL(FakeYoutubeDL):
        def extract_info(self, url, download=False):
            return {'entries': [{'id': YOUTUBE_ID, 'title': 'Listed'}]}

    def setUp(self):
        super().setUp()
        self.owner = Account.objects.create_user('tomb_u', 'tomb_u@test.local', 'Tombpw_2026!')
        self.playlist = Playlist.objects.create(owner=self.owner, playlist_id='PL_tomb', title='T')

    def sync(self, force=False):
        with mock.patch('task.tasks.yt_dlp.YoutubeDL', self.EntriesYDL), \
                mock.patch('task.tasks.download_audio_task.delay') as delay:
            download_playlist_task(self.playlist.pk, force=force)
        return delay

    def test_sync_leaves_a_dismissed_download_dismissed(self):
        row = self.queue_row(self.owner, status='ignored')
        self.sync().assert_not_called()
        row.refresh_from_db()
        self.assertEqual(row.status, 'ignored')

    def test_explicit_force_recheck_brings_it_back(self):
        row = self.queue_row(self.owner, status='ignored')
        self.sync(force=True).assert_called_once_with(row.pk)
        row.refresh_from_db()
        self.assertEqual(row.status, 'pending')

    def test_sync_leaves_active_work_alone_however_old(self):
        row = self.queue_row(
            self.owner,
            status='downloading',
            claim_token=uuid.uuid4(),
            started_date=timezone.now() - timedelta(hours=3),
            lease_expires_at=timezone.now() + timedelta(minutes=4),
        )
        self.sync().assert_not_called()
        row.refresh_from_db()
        self.assertEqual(row.status, 'downloading')

    def test_new_rows_record_the_playlist_that_queued_them(self):
        self.sync()
        self.assertEqual(DownloadQueue.objects.get(youtube_id=YOUTUBE_ID).source_playlist_id, 'PL_tomb')

    def test_syncing_a_deleted_playlist_is_a_no_op(self):
        playlist_id = self.playlist.pk
        self.playlist.delete()
        self.assertIn('no longer exists', download_playlist_task(playlist_id))


class QueueIdentityMigrationTests(TransactionTestCase):
    before = [('download', '0002_downloadqueue_retry_count')]
    # The whole app: the assertions below read rows through the current model.
    after = [('download', '0004_downloadqueue_reserved_bytes')]

    def tearDown(self):
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())

    def test_duplicates_merge_conservatively(self):
        executor = MigrationExecutor(connection)
        executor.migrate(self.before)
        apps = executor.loader.project_state(self.before).apps
        OldQueue = apps.get_model('download', 'DownloadQueue')
        owner = Account.objects.create_user('mig_u', 'mig_u@test.local', 'Migpw_2026!')
        other = Account.objects.create_user('mig_v', 'mig_v@test.local', 'Migpw_2026!')

        def old_row(url, status, row_owner=owner, youtube_id=''):
            return OldQueue.objects.create(owner_id=row_owner.pk, url=url, status=status, youtube_id=youtube_id)

        old_row('https://youtu.be/AAA', 'failed', youtube_id='AAA')
        kept_completed = old_row('https://www.youtube.com/watch?v=AAA&list=PL', 'completed')
        old_row('https://youtube.com/watch?v=AAA', 'pending')
        kept_ignored = old_row('https://www.youtube.com/watch?v=BBB', 'ignored')
        old_row('https://youtu.be/BBB', 'failed')
        untouched_other_owner = old_row('https://youtu.be/AAA', 'pending', row_owner=other)
        untouched_playlist = old_row('https://www.youtube.com/playlist?list=PL', 'pending')

        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(self.after)

        rows = {row.pk: row for row in DownloadQueue.objects.all()}
        self.assertEqual(
            set(rows), {kept_completed.pk, kept_ignored.pk, untouched_other_owner.pk, untouched_playlist.pk}
        )
        self.assertEqual(rows[kept_completed.pk].url, 'https://www.youtube.com/watch?v=AAA')
        self.assertEqual(rows[kept_completed.pk].youtube_id, 'AAA')
        self.assertEqual(rows[kept_ignored.pk].status, 'ignored')
        self.assertEqual(rows[untouched_other_owner.pk].url, 'https://www.youtube.com/watch?v=AAA')
        self.assertEqual(rows[untouched_playlist.pk].url, 'https://www.youtube.com/playlist?list=PL')


@skipUnless(connection.vendor == 'postgresql', 'Row locking cannot be established on SQLite')
class PostgresConcurrencyTests(WorkerTestMixin, TransactionTestCase):
    THREADS = 8

    def setUp(self):
        super().setUp()
        self.owner = Account.objects.create_user('race_u', 'race_u@test.local', 'Racepw_2026!')

    def run_together(self, work):
        start = threading.Barrier(self.THREADS)

        def worker():
            try:
                start.wait()
                return work()
            finally:
                connection.close()

        with ThreadPoolExecutor(self.THREADS) as pool:
            return list(pool.map(lambda _: worker(), range(self.THREADS)))

    def test_exactly_one_worker_wins_a_claim(self):
        row = self.queue_row(self.owner)
        tokens = self.run_together(lambda: claim_download(row.pk))
        self.assertEqual(len([token for token in tokens if token]), 1)

    def test_simultaneous_deliveries_publish_once(self):
        row = self.queue_row(self.owner)
        self.run_together(lambda: download_audio_task(row.pk))
        self.assertEqual(len(FakeYoutubeDL.extractions), 1)
        self.assertEqual(Audio.objects.filter(owner=self.owner).count(), 1)

    def test_simultaneous_submits_create_one_row(self):
        self.run_together(lambda: DownloadQueue.objects.get_or_create(owner=self.owner, url=WATCH_URL))
        self.assertEqual(DownloadQueue.objects.filter(owner=self.owner).count(), 1)

    def test_publication_and_clearing_never_both_win(self):
        for attempt in range(10):
            video_url = f'{WATCH_URL}{attempt}'
            row = self.queue_row(self.owner, url=video_url)
            token = claim_download(row.pk)
            info = {'id': f'{YOUTUBE_ID}{attempt}', 'title': 'T', 'filesize': 1, 'channel': 'C'}
            with ThreadPoolExecutor(2) as pool:
                publishing = pool.submit(self._closing, _publish_download, row.pk, token, info, f'p/{attempt}.opus', 'opus', 1)
                clearing = pool.submit(self._closing, lambda: DownloadQueue.objects.filter(pk=row.pk).delete())
                published, _ = publishing.result(), clearing.result()
            self.assertEqual(Audio.objects.filter(youtube_id=info['id']).exists(), published)

    def test_row_cannot_be_cleared_while_it_is_being_published(self):
        row = self.queue_row(self.owner)
        token = claim_download(row.pk)
        info = {'id': YOUTUBE_ID, 'title': 'T', 'filesize': 1, 'channel': 'C'}
        real_get_or_create = Audio.objects.get_or_create
        clear_was_blocked = []

        def try_to_take_the_row():
            with transaction.atomic():
                DownloadQueue.objects.filter(pk=row.pk).select_for_update(nowait=True).first()

        def publishing(**kwargs):
            with ThreadPoolExecutor(1) as pool:
                attempt = pool.submit(self._closing, try_to_take_the_row)
                clear_was_blocked.append(isinstance(attempt.exception(), OperationalError))
            return real_get_or_create(**kwargs)

        with mock.patch('task.tasks.Audio.objects.get_or_create', side_effect=publishing):
            self.assertTrue(_publish_download(row.pk, token, info, RELATIVE_FILE_PATH, 'opus', 1))
        self.assertEqual(clear_was_blocked, [True])

    @staticmethod
    def _closing(work, *args):
        try:
            return work(*args)
        finally:
            connection.close()

    def test_heartbeat_renews_from_its_own_connection(self):
        row = self.queue_row(self.owner)
        token = claim_download(row.pk)
        DownloadQueue.objects.filter(pk=row.pk).update(lease_expires_at=timezone.now())
        with mock.patch('download.claims.HEARTBEAT_INTERVAL_SECONDS', 0.01):
            with keep_claim_alive(row.pk, token) as claim_lost:
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline:
                    row.refresh_from_db()
                    if row.lease_expires_at > timezone.now() + timedelta(minutes=4):
                        break
                    time.sleep(0.01)
                self.assertFalse(claim_lost.is_set())
        self.assertGreater(row.lease_expires_at, timezone.now() + timedelta(minutes=4))

    def test_heartbeat_notices_a_cleared_row(self):
        row = self.queue_row(self.owner)
        token = claim_download(row.pk)
        with mock.patch('download.claims.HEARTBEAT_INTERVAL_SECONDS', 0.01):
            with keep_claim_alive(row.pk, token) as claim_lost:
                DownloadQueue.objects.filter(pk=row.pk).delete()
                self.assertTrue(claim_lost.wait(5))
