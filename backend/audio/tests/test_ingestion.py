"""SW-005: every way bytes enter respects the quota, and only real, finished audio is published.

RealPipelineTests runs real yt-dlp and FFmpeg against a loopback server, because the path
yt-dlp reports after conversion is exactly what fakes cannot prove.

Run: python manage.py test audio.tests.test_ingestion --settings=config.settings_test
"""
import shutil
import tempfile
import threading
import wave
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO, StringIO
from pathlib import Path
from types import SimpleNamespace
from unittest import mock, skipUnless

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.db import connection
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied
from rest_framework.test import APIClient, APIRequestFactory, force_authenticate

from audio.models import Audio
from audio.models_local import LocalAudio
from audio.views_local import LocalAudioViewSet
from audio.storage_service import (
    DISK_FULL_MARKER,
    DOWNLOAD_TOO_LARGE_MARKER,
    INVALID_OUTPUT_MARKER,
    IngestionRefused,
    NOT_SINGLE_ITEM_MARKER,
    QUOTA_EXCEEDED_MARKER,
    reserve_download,
)
from channel.models import Channel
from download.claims import claim_download
from download.models import DownloadQueue
from playlist.models import Playlist
from task.tasks import download_audio_task, subscribe_to_channel, subscribe_to_playlist
from user.models import Account

GIGABYTE = 1024 ** 3
URL = 'https://www.youtube.com/watch?v=INGEST_YT_01'
YOUTUBE_ID = 'INGEST_YT_01'
DISK_USAGE = 'audio.storage_service.shutil.disk_usage'
PLENTY_OF_DISK = mock.Mock(free=10 ** 13)


def wav_bytes(frames=1600):
    buffer = BytesIO()
    with wave.open(buffer, 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(8000)
        output.writeframes(bytes(frames))
    return buffer.getvalue()


def make_audio(owner, youtube_id, file_size):
    return Audio.objects.create(
        owner=owner, youtube_id=youtube_id, title='T', channel_id='UC', channel_name='C', duration=1,
        file_path=f'x/{youtube_id}.wav', file_size=file_size, published_date=timezone.now(),
    )


class TemporaryMediaTestCase(TestCase):
    def setUp(self):
        self.media_root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.media_root)
        settings_override = override_settings(MEDIA_ROOT=str(self.media_root))
        settings_override.enable()
        self.addCleanup(settings_override.disable)
        self.owner = Account.objects.create_user('ingest_u', 'ingest_u@test.local', 'Ingestpw_2026!')
        Account.objects.filter(pk=self.owner.pk).update(storage_quota_gb=1)
        self.owner.refresh_from_db()


class AccountingTests(TemporaryMediaTestCase):
    def test_usage_counts_downloads_uploads_and_active_reservations(self):
        make_audio(self.owner, 'A', 100)
        LocalAudio.objects.create(owner=self.owner, title='L', file='l.wav', file_size=20, duration=1, audio_format='wav')
        DownloadQueue.objects.create(owner=self.owner, url=f'{URL}1', status='downloading', reserved_bytes=3)
        self.assertEqual(self.owner.stored_bytes(), 120)
        self.assertEqual(self.owner.storage_used_bytes(), 123)

    def test_reservation_is_released_by_any_way_out_of_downloading(self):
        for status_value in ('pending', 'completed', 'failed', 'ignored'):
            with self.subTest(status_value):
                row = DownloadQueue.objects.create(owner=self.owner, url=URL, status='downloading', reserved_bytes=9)
                DownloadQueue.objects.filter(pk=row.pk).update(status=status_value)
                self.assertEqual(self.owner.storage_used_bytes(), 0)
                row.delete()

    def test_account_fetch_no_longer_erases_local_file_usage(self):
        LocalAudio.objects.create(owner=self.owner, title='L', file='l.wav', file_size=GIGABYTE, duration=1, audio_format='wav')
        client = APIClient()
        client.force_authenticate(self.owner)
        self.assertEqual(client.get('/api/user/account/').json()['storage_used_gb'], 1.0)


class FakeDownloader:
    """Everything outside the task replaced; `result` decides what the download produces."""

    source = {'id': YOUTUBE_ID, 'title': 'T', 'duration': 10, 'channel': 'C'}
    result = None
    transfers = 0

    def __init__(self, options):
        self.options = options

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False

    def extract_info(self, url, download=False):
        return dict(FakeDownloader.source)

    def process_ie_result(self, info, download=True):
        FakeDownloader.transfers += 1
        return {**info, **FakeDownloader.result(self.options)}


class WorkerTests(TemporaryMediaTestCase):
    def setUp(self):
        super().setUp()
        FakeDownloader.source = {'id': YOUTUBE_ID, 'title': 'T', 'duration': 10, 'channel': 'C'}
        FakeDownloader.transfers = 0
        FakeDownloader.result = staticmethod(self._write_real_audio)
        self.row = DownloadQueue.objects.create(owner=self.owner, url=URL, youtube_id=YOUTUBE_ID)
        for active_patch in (
            mock.patch('task.tasks.yt_dlp.YoutubeDL', FakeDownloader),
            mock.patch('common.url_security.check_public_http_url', return_value=(True, None)),
            mock.patch(DISK_USAGE, return_value=PLENTY_OF_DISK),
            mock.patch('task.tasks._resolve_download_quality', return_value='opus'),
            mock.patch('task.tasks._ext_for_quality', return_value='opus'),
            mock.patch('task.tasks._postprocessor_for_quality', return_value={}),
            mock.patch('task.tasks.link_audio_to_playlists.delay'),
            mock.patch('task.tasks.measure_loudness_task.delay'),
            mock.patch('task.tasks.extract_features_task.delay'),
        ):
            active_patch.start()
            self.addCleanup(active_patch.stop)

    def output_path(self):
        return self.media_root / f'users/{self.owner.pk}/{YOUTUBE_ID}.wav'

    def _write_real_audio(self, _options):
        path = self.output_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(wav_bytes())
        return {'requested_downloads': [{'filepath': str(path)}]}

    def assert_refused_with(self, marker, transfers=0):
        download_audio_task(self.row.pk)
        self.row.refresh_from_db()
        self.assertEqual(self.row.status, 'failed')
        self.assertIn(marker, self.row.error_message)
        self.assertEqual(FakeDownloader.transfers, transfers)
        self.assertFalse(Audio.objects.filter(youtube_id=YOUTUBE_ID).exists())

    def test_stored_size_is_the_size_on_disk(self):
        download_audio_task(self.row.pk)
        self.assertEqual(Audio.objects.get(youtube_id=YOUTUBE_ID).file_size, self.output_path().stat().st_size)

    def test_over_quota_is_refused_before_any_network_work(self):
        make_audio(self.owner, 'FULL', GIGABYTE)
        with mock.patch.object(FakeDownloader, 'extract_info') as extract:
            self.assert_refused_with(QUOTA_EXCEEDED_MARKER)
        extract.assert_not_called()

    def test_estimate_that_would_not_fit_is_refused_before_transfer(self):
        make_audio(self.owner, 'MOST', GIGABYTE - 100)
        self.assert_refused_with(QUOTA_EXCEEDED_MARKER)

    def test_other_active_reservations_count(self):
        DownloadQueue.objects.create(owner=self.owner, url=f'{URL}x', status='downloading', reserved_bytes=GIGABYTE - 100)
        self.assert_refused_with(QUOTA_EXCEEDED_MARKER)

    def test_actual_bytes_over_quota_are_refused_and_removed(self):
        make_audio(self.owner, 'MOST', GIGABYTE - 1_000_000)
        Account.objects.filter(pk=self.owner.pk).update(storage_quota_gb=1)
        FakeDownloader.source = {**FakeDownloader.source, 'duration': 1}

        def huge_output(options):
            result = self._write_real_audio(options)
            self.output_path().write_bytes(wav_bytes(frames=2_000_000))
            return result

        FakeDownloader.result = staticmethod(huge_output)
        self.assert_refused_with(QUOTA_EXCEEDED_MARKER, transfers=1)
        self.assertFalse(self.output_path().exists())

    def test_replacing_a_track_only_counts_the_difference(self):
        existing = make_audio(self.owner, YOUTUBE_ID, GIGABYTE - 1_000)
        FakeDownloader.source = {**FakeDownloader.source, 'duration': 0.001}
        download_audio_task(self.row.pk)
        existing.refresh_from_db()
        self.assertEqual(existing.file_size, self.output_path().stat().st_size)

    def test_admin_has_no_quota(self):
        make_audio(self.owner, 'FULL', 5 * GIGABYTE)
        Account.objects.filter(pk=self.owner.pk).update(is_admin=True)
        download_audio_task(self.row.pk)
        self.assertTrue(Audio.objects.filter(youtube_id=YOUTUBE_ID).exists())

    def test_low_disk_is_refused_before_transfer(self):
        with mock.patch(DISK_USAGE, return_value=mock.Mock(free=10)):
            self.assert_refused_with(DISK_FULL_MARKER)

    def test_collections_and_live_streams_are_refused_before_transfer(self):
        for source in ({'_type': 'playlist'}, {'_type': 'multi_video'}, {'is_live': True}):
            with self.subTest(source):
                FakeDownloader.source = {'id': YOUTUBE_ID, 'title': 'T', **source}
                DownloadQueue.objects.filter(pk=self.row.pk).update(status='pending')
                self.assert_refused_with(NOT_SINGLE_ITEM_MARKER)

    def test_source_longer_than_the_limit_is_refused_before_transfer(self):
        with override_settings(MAX_DOWNLOAD_DURATION_SECONDS=5):
            self.assert_refused_with(DOWNLOAD_TOO_LARGE_MARKER)

    def test_oversized_output_is_refused(self):
        with override_settings(MAX_DOWNLOAD_BYTES=10):
            self.assert_refused_with(DOWNLOAD_TOO_LARGE_MARKER, transfers=1)
        self.assertFalse(self.output_path().exists())

    def test_progress_over_the_byte_limit_stops_the_transfer(self):
        kept_transferring = []

        def hook_fires(options):
            options['progress_hooks'][0]({'downloaded_bytes': 11})
            kept_transferring.append(True)
            return self._write_real_audio(options)

        FakeDownloader.result = staticmethod(hook_fires)
        with override_settings(MAX_DOWNLOAD_BYTES=10):
            self.assert_refused_with(DOWNLOAD_TOO_LARGE_MARKER, transfers=1)
        self.assertEqual(kept_transferring, [], 'the hook must stop the transfer itself')

    def test_outputs_that_are_not_finished_audio_never_appear_completed(self):
        def no_path(_options):
            return {}

        def missing_file(_options):
            return {'requested_downloads': [{'filepath': str(self.output_path())}]}

        def not_audio(_options):
            result = self._write_real_audio(_options)
            self.output_path().write_bytes(b'<html>not audio</html>')
            return result

        def truncated(_options):
            result = self._write_real_audio(_options)
            self.output_path().write_bytes(b'')
            return result

        for label, result in (('no path', no_path), ('missing', missing_file), ('html', not_audio), ('empty', truncated)):
            with self.subTest(label):
                FakeDownloader.result = staticmethod(result)
                DownloadQueue.objects.filter(pk=self.row.pk).update(status='pending')
                FakeDownloader.transfers = 0
                self.assert_refused_with(INVALID_OUTPUT_MARKER, transfers=1)
                self.assertFalse(self.output_path().exists())

    def test_unrecognised_content_never_appears_completed(self):
        unknown_format = self.output_path().with_suffix('.bin')

        def garbage(_options):
            unknown_format.parent.mkdir(parents=True, exist_ok=True)
            unknown_format.write_bytes(b'not any audio format')
            return {'requested_downloads': [{'filepath': str(unknown_format)}]}

        FakeDownloader.result = staticmethod(garbage)
        self.assert_refused_with(INVALID_OUTPUT_MARKER, transfers=1)
        self.assertFalse(unknown_format.exists())

    def test_audio_with_no_length_never_appears_completed(self):
        def silent_header_only(options):
            result = self._write_real_audio(options)
            self.output_path().write_bytes(wav_bytes(frames=0))
            return result

        FakeDownloader.result = staticmethod(silent_header_only)
        self.assert_refused_with(INVALID_OUTPUT_MARKER, transfers=1)
        self.assertFalse(self.output_path().exists())

    def test_failed_replacement_keeps_the_existing_file(self):
        existing_path = 'x/existing.wav'
        (self.media_root / 'x').mkdir()
        (self.media_root / existing_path).write_bytes(wav_bytes())
        audio = make_audio(self.owner, YOUTUBE_ID, 10)
        Audio.objects.filter(pk=audio.pk).update(file_path=existing_path)
        FakeDownloader.result = staticmethod(lambda _options: {})
        self.assert_refused_with_row_kept(existing_path)

    def assert_refused_with_row_kept(self, existing_path):
        download_audio_task(self.row.pk)
        self.row.refresh_from_db()
        self.assertEqual(self.row.status, 'failed')
        self.assertEqual(Audio.objects.get(youtube_id=YOUTUBE_ID).file_path, existing_path)
        self.assertTrue((self.media_root / existing_path).exists())

    def test_refusal_releases_the_reservation(self):
        FakeDownloader.result = staticmethod(lambda _options: {})
        download_audio_task(self.row.pk)
        self.assertEqual(self.owner.storage_used_bytes(), 0)

    def test_claim_itself_reserves_nothing_until_the_size_is_known(self):
        claim_download(self.row.pk)
        self.row.refresh_from_db()
        self.assertEqual(self.row.reserved_bytes, 0)


class SubmissionTests(TemporaryMediaTestCase):
    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.client.force_authenticate(self.owner)
        check = mock.patch('download.serializers.check_public_http_url', return_value=(True, None))
        check.start()
        self.addCleanup(check.stop)

    def submit(self, urls):
        with mock.patch('task.tasks.download_audio_task.delay') as delay:
            response = self.client.post('/api/download/', {'urls': urls, 'auto_start': True}, format='json')
        return response, delay

    def test_collection_urls_are_routed_to_subscriptions(self):
        for url in (
            'https://www.youtube.com/playlist?list=PL1',
            'https://www.youtube.com/channel/UC1',
            'https://www.youtube.com/@someone',
            'https://youtube.com/c/someone',
            'https://youtube.com/user/someone',
        ):
            with self.subTest(url):
                response, delay = self.submit([url])
                self.assertEqual(response.status_code, 400, response.content)
                delay.assert_not_called()

    def test_a_watch_url_with_a_list_is_still_one_track(self):
        response, delay = self.submit(['https://www.youtube.com/watch?v=abc&list=PL1'])
        self.assertEqual(response.status_code, 201, response.content)
        delay.assert_called_once()

    def test_request_size_is_bounded(self):
        response, delay = self.submit([f'https://example.test/{index}' for index in range(101)])
        self.assertEqual(response.status_code, 400)
        delay.assert_not_called()

    def test_over_quota_cannot_queue(self):
        make_audio(self.owner, 'FULL', GIGABYTE)
        response, delay = self.submit([URL])
        self.assertEqual(response.status_code, 403)
        delay.assert_not_called()
        self.assertEqual(self.client.get('/api/download/').status_code, 200, 'reading stays allowed')

    def test_admin_can_queue_over_quota(self):
        make_audio(self.owner, 'FULL', GIGABYTE)
        Account.objects.filter(pk=self.owner.pk).update(is_admin=True)
        self.owner.refresh_from_db()
        self.assertEqual(self.submit([URL])[0].status_code, 201)


class LocalFileTests(TemporaryMediaTestCase):
    def upload_file(self):
        return SimpleUploadedFile('song.wav', wav_bytes(), content_type='audio/wav')

    def upload(self):
        request = APIRequestFactory().post('/', {'file': self.upload_file(), 'title': 'T'}, format='multipart')
        force_authenticate(request, user=self.owner)
        return LocalAudioViewSet.as_view({'post': 'create'})(request)

    def test_upload_that_would_exceed_is_refused_and_writes_nothing(self):
        make_audio(self.owner, 'MOST', GIGABYTE - 10)
        response = self.upload()
        self.assertEqual(response.status_code, 403, response.data)
        self.assertFalse(LocalAudio.objects.exists())
        self.assertEqual(list(self.media_root.rglob('song*')), [])

    def test_upload_that_fits_is_accepted(self):
        response = self.upload()
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(self.owner.stored_bytes(), len(wav_bytes()))

    def test_metadata_update_cannot_replace_the_file(self):
        self.assertEqual(self.upload().status_code, 201)
        local = LocalAudio.objects.get(owner=self.owner)
        original = local.file.name
        replacement = SimpleUploadedFile('evil.exe', b'x' * 2048, content_type='application/octet-stream')
        request = APIRequestFactory().patch('/', {'file': replacement, 'title': 'Renamed'}, format='multipart')
        force_authenticate(request, user=self.owner)
        response = LocalAudioViewSet.as_view({'patch': 'partial_update'})(request, pk=local.pk)
        self.assertEqual(response.status_code, 200, response.data)
        local.refresh_from_db()
        self.assertEqual(local.file.name, original)
        self.assertEqual(local.title, 'Renamed')
        self.assertEqual(local.file_size, len(wav_bytes()))


class SubscriptionLimitTests(TemporaryMediaTestCase):
    CHANNEL_METADATA = {
        'channel_id': 'UC_new', 'channel_name': 'N', 'channel_description': '', 'channel_thumbnail': '',
        'subscriber_count': 0, 'video_count': 0,
    }
    PLAYLIST_METADATA = {
        'title': 'P', 'description': '', 'channel_name': 'C', 'channel_id': 'UC', 'thumbnail_url': '', 'item_count': 0,
    }

    def test_channel_limit_holds_when_the_task_runs(self):
        Account.objects.filter(pk=self.owner.pk).update(max_channels=1)
        Channel.objects.create(owner=self.owner, channel_id='UC_old', channel_name='O')
        with mock.patch('common.src.youtube_metadata.get_channel_metadata', return_value=self.CHANNEL_METADATA), \
                mock.patch('task.tasks.download_channel_task.delay') as delay:
            message = subscribe_to_channel(self.owner.pk, 'UC_new')
        self.assertIn('limit', message)
        self.assertFalse(Channel.objects.filter(channel_id='UC_new').exists())
        delay.assert_not_called()

    def test_playlist_limit_holds_when_the_task_runs(self):
        Account.objects.filter(pk=self.owner.pk).update(max_playlists=1)
        Playlist.objects.create(owner=self.owner, playlist_id='PL_old', title='O')
        with mock.patch('common.src.youtube_metadata.get_playlist_metadata', return_value=self.PLAYLIST_METADATA), \
                mock.patch('task.tasks.download_playlist_task.delay') as delay:
            message = subscribe_to_playlist(self.owner.pk, 'https://www.youtube.com/playlist?list=PL_new')
        self.assertIn('limit', message)
        self.assertFalse(Playlist.objects.filter(playlist_id='PL_new').exists())
        delay.assert_not_called()

    def test_subscribing_under_the_limit_still_works(self):
        with mock.patch('common.src.youtube_metadata.get_channel_metadata', return_value=self.CHANNEL_METADATA), \
                mock.patch('task.tasks.download_channel_task.delay') as delay:
            subscribe_to_channel(self.owner.pk, 'UC_new')
        delay.assert_called_once()
        self.assertTrue(Channel.objects.filter(channel_id='UC_new').exists())

    def test_custom_playlist_creation_respects_the_limit(self):
        Account.objects.filter(pk=self.owner.pk).update(max_playlists=0)
        self.owner.refresh_from_db()
        client = APIClient()
        client.force_authenticate(self.owner)
        response = client.post('/api/playlist/', {'title': 'Mine'}, format='json')
        self.assertEqual(response.status_code, 403)


class ReconcileCommandTests(TemporaryMediaTestCase):
    def run_command(self, *args):
        out = StringIO()
        call_command('reconcile_media_sizes', *args, stdout=out)
        return out.getvalue()

    def prepared_row(self):
        audio = make_audio(self.owner, 'SIZE', 0)
        (self.media_root / 'x').mkdir(exist_ok=True)
        (self.media_root / audio.file_path).write_bytes(b'x' * 2048)
        return audio

    def test_dry_run_changes_nothing(self):
        audio = self.prepared_row()
        self.assertIn('Would update 1 row(s)', self.run_command())
        audio.refresh_from_db()
        self.assertEqual(audio.file_size, 0)

    def test_apply_sets_the_size_from_disk_and_is_idempotent(self):
        audio = self.prepared_row()
        self.run_command('--apply')
        audio.refresh_from_db()
        self.assertEqual(audio.file_size, 2048)
        self.assertIn('Updated 0 row(s)', self.run_command('--apply'))

    def test_missing_file_is_reported_and_left_alone(self):
        audio = make_audio(self.owner, 'GONE', 77)
        self.assertIn('1 file(s) missing', self.run_command('--apply'))
        audio.refresh_from_db()
        self.assertEqual(audio.file_size, 77)


class _AudioHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        body = wav_bytes(frames=80_000) if self.path.endswith('.wav') else b'<html>no media here</html>'
        self.send_response(200)
        self.send_header('Content-Type', 'audio/wav' if self.path.endswith('.wav') else 'text/html')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


@skipUnless(shutil.which('ffmpeg'), 'Needs FFmpeg')
class RealPipelineTests(TemporaryMediaTestCase):
    """Real yt-dlp, real FFmpeg; a loopback server stands in for the internet."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), _AudioHandler)
        cls.server.daemon_threads = True
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base_url = f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        super().tearDownClass()

    def setUp(self):
        super().setUp()
        for active_patch in (
            mock.patch('common.url_security.check_public_http_url', return_value=(True, None)),
            # The stand-in for the internet is a plain file server, which only this extractor reads.
            mock.patch('common.ytdlp_session.ALLOWED_EXTRACTORS', ['generic']),
            mock.patch(DISK_USAGE, return_value=PLENTY_OF_DISK),
            mock.patch('task.tasks.link_audio_to_playlists.delay'),
            mock.patch('task.tasks.measure_loudness_task.delay'),
            mock.patch('task.tasks.extract_features_task.delay'),
        ):
            active_patch.start()
            self.addCleanup(active_patch.stop)

    def download(self, path):
        row = DownloadQueue.objects.create(owner=self.owner, url=f'{self.base_url}/{path}')
        try:
            download_audio_task(row.pk)
        except Exception:  # noqa: BLE001 - a genuine failure is re-raised by design; the row records it
            pass
        row.refresh_from_db()
        return row

    def test_real_download_publishes_the_converted_file_at_its_real_size(self):
        row = self.download('track.wav')
        self.assertEqual(row.status, 'completed', row.error_message)
        audio = Audio.objects.get(owner=self.owner)
        path = self.media_root / audio.file_path
        self.assertTrue(audio.file_path.startswith(f'users/{self.owner.pk}/'), audio.file_path)
        self.assertEqual(path.suffix, f'.{audio.audio_format}')
        self.assertEqual(audio.file_size, path.stat().st_size)
        self.assertGreater(audio.file_size, 0)
        self.assertEqual([item for item in path.parent.iterdir() if item != path], [], 'no leftovers')

    def test_real_byte_limit_stops_the_transfer(self):
        with override_settings(MAX_DOWNLOAD_BYTES=1000):
            row = self.download('track.wav')
        self.assertEqual(row.status, 'failed')
        self.assertIn(DOWNLOAD_TOO_LARGE_MARKER, row.error_message)
        self.assertFalse(Audio.objects.exists())

    def test_a_page_with_no_media_never_appears_completed(self):
        row = self.download('page.html')
        self.assertEqual(row.status, 'failed')
        self.assertFalse(Audio.objects.exists())


@skipUnless(connection.vendor == 'postgresql', 'Row locking cannot be established on SQLite')
class PostgresQuotaConcurrencyTests(TransactionTestCase):
    THREADS = 8

    def setUp(self):
        self.owner = Account.objects.create_user('race_quota', 'race_quota@test.local', 'Racepw_2026!')
        Account.objects.filter(pk=self.owner.pk).update(storage_quota_gb=1, max_channels=1, max_playlists=1)

    def run_together(self, work):
        start = threading.Barrier(self.THREADS)

        def worker(index):
            try:
                start.wait()
                return work(index)
            finally:
                connection.close()

        with ThreadPoolExecutor(self.THREADS) as pool:
            return list(pool.map(worker, range(self.THREADS)))

    def test_concurrent_reservations_cannot_overspend(self):
        rows = [
            DownloadQueue.objects.create(owner=self.owner, url=f'{URL}{index}', status='downloading')
            for index in range(self.THREADS)
        ]
        # Each reservation is 40% of the quota, so exactly two fit.
        reservation = int(0.4 * GIGABYTE)

        def reserve(index):
            try:
                reserve_download(rows[index].pk, self.owner.pk, reservation)
                return True
            except IngestionRefused:
                return False

        with mock.patch(DISK_USAGE, return_value=PLENTY_OF_DISK):
            outcomes = self.run_together(reserve)
        self.assertEqual(sum(outcomes), 2)
        self.assertLessEqual(self.owner.storage_used_bytes(), GIGABYTE)

    def test_concurrent_channel_subscriptions_cannot_exceed_the_limit(self):
        def metadata(channel_id):
            return {
                'channel_id': channel_id, 'channel_name': channel_id, 'channel_description': '',
                'channel_thumbnail': '', 'subscriber_count': 0, 'video_count': 0,
            }

        with mock.patch('common.src.youtube_metadata.get_channel_metadata', side_effect=metadata), \
                mock.patch('task.tasks.download_channel_task.delay'):
            self.run_together(lambda index: subscribe_to_channel(self.owner.pk, f'UC_{index}'))
        self.assertEqual(Channel.objects.filter(owner=self.owner).count(), 1)

    def test_concurrent_playlist_subscriptions_cannot_exceed_the_limit(self):
        metadata = {
            'title': 'P', 'description': '', 'channel_name': 'C', 'channel_id': 'UC', 'thumbnail_url': '', 'item_count': 0,
        }
        with mock.patch('common.src.youtube_metadata.get_playlist_metadata', return_value=metadata), \
                mock.patch('task.tasks.download_playlist_task.delay'):
            self.run_together(
                lambda index: subscribe_to_playlist(self.owner.pk, f'https://www.youtube.com/playlist?list=PL_{index}')
            )
        self.assertEqual(Playlist.objects.filter(owner=self.owner).count(), 1)

    def test_concurrent_custom_playlists_cannot_exceed_the_limit(self):
        def create(index):
            client = APIClient()
            client.force_authenticate(Account.objects.get(pk=self.owner.pk))
            return client.post('/api/playlist/', {'title': f'Mine {index}'}, format='json').status_code

        statuses = self.run_together(create)
        self.assertEqual(Playlist.objects.filter(owner=self.owner).count(), 1, statuses)

    def test_concurrent_uploads_cannot_overspend(self):
        Account.objects.filter(pk=self.owner.pk).update(storage_quota_gb=1)
        size = int(0.4 * GIGABYTE)
        media_root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, media_root)

        def upload(index):
            view = LocalAudioViewSet()
            view.request = SimpleNamespace(user=self.owner)
            serializer = mock.Mock()
            serializer.validated_data = {'file': SimpleNamespace(size=size)}

            def save(owner):
                return LocalAudio.objects.create(
                    owner=owner, title=str(index), file=f'{index}.wav', file_size=size, duration=1, audio_format='wav'
                )

            serializer.save.side_effect = save
            try:
                view.perform_create(serializer)
                return True
            except PermissionDenied:
                return False

        self.assertEqual(sum(self.run_together(upload)), 2)
