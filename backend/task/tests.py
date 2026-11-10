"""Sonic feature backfill task tests (CODE_REVIEW_REPORT Step 7).

Feature extraction otherwise only fires post-download, so any library predating F16 keeps
an empty `feature_vector` forever and Sonic/Auto-DJ stay on the metadata fallback.

The guard matters as much as the backfill: `extract_features_task` returns early on
ImportError WITHOUT writing a vector, so on an image without the DSP stack every hourly
run would re-enqueue the same tracks indefinitely.

Run: python manage.py test task --settings=config.settings_test
"""
import shutil
import subprocess
import tempfile
import unittest
import wave
from pathlib import Path
from unittest import mock

from yt_dlp.postprocessor.ffmpeg import FFmpegExtractAudioPP

from django.core.cache import cache
from django.conf import settings
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone

from datetime import timedelta

from rest_framework.test import APIClient

from audio.storage_service import absolute_media_path
from audio.models import Audio, AudioProgress
from audio.models_lyrics import Lyrics
from audio.models_radio import RadioTrackFeedback
from audio.models_segments import AudioSegment
from audio.radio_features import RADIO_FEEDBACK_RETENTION_DAYS
from download.models import DownloadQueue
from playlist.models import Playlist, PlaylistItem
from playlist.serializers import PlaylistSerializer
from stats.models import ListeningHistory
from task.tasks import (
    is_permanently_unavailable,
    COOKIES_FILE,
    COOKIES_FILE_ACCESS_MARKER,
    COOKIES_REFRESH_MARKER,
    INCOMPLETE_SCAN_MESSAGE,
    MAX_AUTO_RETRIES,
    PERMANENT_ERROR_PATTERNS,
    PLAYLIST_YTIDS_CACHE_PREFIX,
    _cache_playlist_video_ids,
    _postprocessor_for_quality,
    _resolve_download_quality,
    _stored_format,
    backfill_missing_features_task,
    download_audio_task,
    download_playlist_task,
    get_permanently_unavailable_ids,
    link_audio_to_playlists,
    mark_cookie_errors,
    prune_radio_feedback_task,
    retry_failed_downloads,
)
from channel.models import Channel
from user.models import Account, UserConfig

BACKFILL_TASK_NAME = 'task.tasks.backfill_missing_features_task'
PRUNE_TASK_NAME = 'task.tasks.prune_radio_feedback_task'
FEATURE_VECTOR = [0.5, 0.4, 0.3, 0.2, 0.6, 0.5, 0.5]


def _make_audio(owner, youtube_id, file_path='Chan/track.m4a', feature_vector=None):
    return Audio.objects.create(
        owner=owner,
        youtube_id=youtube_id,
        title=f'Track {youtube_id}',
        channel_id='UC_backfill',
        channel_name='Backfill Chan',
        duration=180,
        file_path=file_path,
        file_size=1024,
        published_date=timezone.now(),
        feature_vector=feature_vector or [],
    )


class BackfillMissingFeaturesTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = Account.objects.create_user('bf_user', 'bf@test.local', 'Bfpw_2026!')
        cls.needs_features = _make_audio(cls.user, 'BF_NEEDS_1')
        cls.also_needs = _make_audio(cls.user, 'BF_NEEDS_2')
        cls.already_done = _make_audio(cls.user, 'BF_DONE', feature_vector=FEATURE_VECTOR)
        cls.no_file = _make_audio(cls.user, 'BF_NOFILE', file_path='')

    def run_task(self, librosa_present=True, **kwargs):
        """Run the task with librosa availability faked, capturing enqueued ids."""
        spec = object() if librosa_present else None
        with mock.patch('task.tasks.find_spec', return_value=spec), \
             mock.patch('task.tasks.extract_features_task.delay') as fake_delay:
            result = backfill_missing_features_task(**kwargs)
        enqueued = [call.args[0] for call in fake_delay.call_args_list]
        return result, enqueued

    def test_enqueues_only_tracks_missing_a_vector(self):
        _, enqueued = self.run_task()
        self.assertCountEqual(enqueued, [self.needs_features.id, self.also_needs.id])

    def test_skips_tracks_that_already_have_a_vector(self):
        _, enqueued = self.run_task()
        self.assertNotIn(self.already_done.id, enqueued)

    def test_skips_tracks_with_no_file(self):
        _, enqueued = self.run_task()
        self.assertNotIn(self.no_file.id, enqueued)

    def test_respects_the_limit(self):
        _, enqueued = self.run_task(limit=1)
        self.assertEqual(len(enqueued), 1)

    # --- the guard: no endless re-enqueue on an image without the DSP stack ---
    def test_enqueues_nothing_when_librosa_is_unavailable(self):
        result, enqueued = self.run_task(librosa_present=False)
        self.assertEqual(enqueued, [])
        self.assertIn('librosa unavailable', result)


class PruneRadioFeedbackTests(TestCase):
    """RadioTrackFeedback gains a row per skip/like and is aggregated on every next-track."""

    @classmethod
    def setUpTestData(cls):
        cls.user = Account.objects.create_user('prune_u', 'prune@test.local', 'Prunepw_2026!')

    def _feedback(self, youtube_id, age_days=0):
        row = RadioTrackFeedback.objects.create(
            user=self.user, youtube_id=youtube_id, channel_id='c', feedback_type='skipped'
        )
        if age_days:
            stale = timezone.now() - timedelta(days=age_days)
            RadioTrackFeedback.objects.filter(pk=row.pk).update(created_at=stale)
        return row

    def test_deletes_only_rows_past_the_retention_window(self):
        recent = self._feedback('KEEP_ME')
        stale = self._feedback('DROP_ME', age_days=RADIO_FEEDBACK_RETENTION_DAYS + 1)

        prune_radio_feedback_task()

        self.assertTrue(RadioTrackFeedback.objects.filter(pk=recent.pk).exists())
        self.assertFalse(RadioTrackFeedback.objects.filter(pk=stale.pk).exists())

    def test_reports_how_many_rows_were_pruned(self):
        for index in range(3):
            self._feedback(f'OLD_{index}', age_days=RADIO_FEEDBACK_RETENTION_DAYS + 5)
        self.assertIn('3', prune_radio_feedback_task())

    def test_is_a_no_op_when_nothing_is_stale(self):
        self._feedback('FRESH')
        prune_radio_feedback_task()
        self.assertEqual(RadioTrackFeedback.objects.count(), 1)


class BeatScheduleTests(TestCase):
    """A typo'd dotted path in beat_schedule fails silently at runtime -- pin it."""

    def test_backfill_is_scheduled_and_the_task_name_resolves(self):
        from config.celery import app

        entry = app.conf.beat_schedule.get('backfill-missing-sonic-features')
        self.assertIsNotNone(entry, 'backfill beat entry is missing')
        self.assertEqual(entry['task'], BACKFILL_TASK_NAME)
        self.assertIn(BACKFILL_TASK_NAME, app.tasks,
                      'beat_schedule points at a task name Celery has not registered')

    def test_prune_is_scheduled_and_the_task_name_resolves(self):
        from config.celery import app

        entry = app.conf.beat_schedule.get('prune-radio-feedback')
        self.assertIsNotNone(entry, 'prune beat entry is missing')
        self.assertEqual(entry['task'], PRUNE_TASK_NAME)
        self.assertIn(PRUNE_TASK_NAME, app.tasks,
                      'beat_schedule points at a task name Celery has not registered')


class CookieErrorMarkerTests(SimpleTestCase):
    """The SPA swaps these markers for a cookies.txt hint, so a missed or wrong marker
    leaves users with raw yt-dlp output, or tells them to refresh cookies that are fine."""

    def test_cookie_failures_get_the_marker_for_their_fix(self):
        cases = [
            ("ERROR: [youtube] VIDEO_ID_01: Sign in to confirm you're not a bot. "
             "Use --cookies-from-browser or --cookies for the authentication.", COOKIES_REFRESH_MARKER),
            ('ERROR: [youtube] VIDEO_ID_01: Sign in to confirm your age. '
             'This video may be inappropriate for some users.', COOKIES_REFRESH_MARKER),
            ('Cookies file must be Netscape formatted, not JSON.', COOKIES_REFRESH_MARKER),
            (f"[Errno 30] Read-only file system: '{COOKIES_FILE}'", COOKIES_FILE_ACCESS_MARKER),
            (f"[Errno 13] Permission denied: '{COOKIES_FILE}'", COOKIES_FILE_ACCESS_MARKER),
        ]
        for message, marker in cases:
            with self.subTest(message=message):
                self.assertEqual(mark_cookie_errors(message), f'{marker} {message}')

    def test_other_failures_are_left_unchanged(self):
        unrelated = [
            # yt-dlp suggests cookies for private videos too, but new cookies cannot fix them.
            "ERROR: [youtube] VIDEO_ID_01: Private video. Sign in if you've been granted "
            "access to this video. Use --cookies-from-browser or --cookies for the authentication.",
            "[Errno 13] Permission denied: '/app/audio/Some Channel'",
            'ERROR: [youtube] VIDEO_ID_01: Video unavailable',
        ]
        for message in unrelated:
            with self.subTest(message=message):
                self.assertEqual(mark_cookie_errors(message), message)
        self.assertEqual(mark_cookie_errors(None), '')


class AutoRetryBudgetTests(TestCase):
    """Both automatic retry paths stop after MAX_AUTO_RETRIES. The count used to live in
    error_message, which every failed download overwrites, so retry_failed_downloads never
    hit its cap and playlist syncs re-queued failures on every run."""

    FAILURE = "[cookies_refresh] ERROR: [youtube] VIDEO_ID_01: Sign in to confirm you're not a bot."
    VIDEO_ID = 'VIDEO_ID_01'

    def setUp(self):
        self.owner = Account.objects.create_user('retry_owner', 'retry@test.local', 'Retrypw_2026!')
        self.queue_item = DownloadQueue.objects.create(
            owner=self.owner, url=f'https://example.invalid/{self.VIDEO_ID}', youtube_id=self.VIDEO_ID,
            status='failed', error_message=self.FAILURE,
        )
        self.playlist = Playlist.objects.create(owner=self.owner, playlist_id='PL_demo', title='Demo playlist')

    def _fail_again(self, queue_id):
        # What download_audio_task does on failure: back to failed, message overwritten.
        DownloadQueue.objects.filter(id=queue_id).update(status='failed', error_message=self.FAILURE)

    def _sync_playlist(self, runs, force=False):
        flat_playlist = {'entries': [{'id': self.VIDEO_ID, 'title': 'Demo track'}]}
        with mock.patch('task.tasks.yt_dlp.YoutubeDL') as youtube_dl, \
                mock.patch('task.tasks.download_audio_task.delay', side_effect=self._fail_again) as dispatch:
            youtube_dl.return_value.__enter__.return_value.extract_info.return_value = flat_playlist
            for _ in range(runs):
                download_playlist_task(self.playlist.id, force=force)
        return dispatch

    def test_retry_failed_downloads_stops_at_the_budget(self):
        with mock.patch('task.tasks.download_audio_task.delay', side_effect=self._fail_again) as dispatch:
            for _ in range(MAX_AUTO_RETRIES + 2):
                retry_failed_downloads()
        self.assertEqual(dispatch.call_count, MAX_AUTO_RETRIES)
        self.queue_item.refresh_from_db()
        self.assertEqual(self.queue_item.retry_count, MAX_AUTO_RETRIES)

    def test_playlist_sync_stops_requeueing_at_the_budget(self):
        dispatch = self._sync_playlist(runs=MAX_AUTO_RETRIES + 2)
        self.assertEqual(dispatch.call_count, MAX_AUTO_RETRIES)

    def test_forced_sync_retries_and_starts_a_fresh_budget(self):
        DownloadQueue.objects.filter(id=self.queue_item.id).update(retry_count=MAX_AUTO_RETRIES)
        dispatch = self._sync_playlist(runs=1, force=True)
        self.assertEqual(dispatch.call_count, 1)
        self.queue_item.refresh_from_db()
        self.assertEqual(self.queue_item.retry_count, 0)


class _PlaylistEntriesYDL:
    """Stand-in for yt_dlp.YoutubeDL returning one playlist entry."""

    def __init__(self, opts):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False

    def extract_info(self, url, download=False):
        return {'entries': [{'id': 'REPAIR_YT_01', 'title': 'Repair Track'}]}


# Three hours of audio at 3x real time: half the conversion speed measured on a 6-core shared VPS.
THREE_HOUR_MIX_SECONDS = 3 * 60 * 60
CONSERVATIVE_CONVERSION_SPEED = 3
THREE_HOUR_MIX_CONVERSION_SECONDS = THREE_HOUR_MIX_SECONDS // CONSERVATIVE_CONVERSION_SPEED


class _UntitledEntryYDL(_PlaylistEntriesYDL):
    """YouTube's flat listings can report the title key with no value."""

    def extract_info(self, url, download=False):
        return {'entries': [{'id': 'UNTITLED_001', 'title': None}, {'id': 'TITLED_0001', 'title': 'Named'}]}


class UntitledPlaylistEntryTests(TestCase):
    def test_an_entry_without_a_title_is_queued_and_does_not_stop_the_rest(self):
        owner = Account.objects.create_user('untitled_u', 'untitled@test.local', 'Untitledpw_2026!')
        playlist = Playlist.objects.create(owner=owner, playlist_id='PL_untitled', title='Untitled')

        with mock.patch('task.tasks.yt_dlp.YoutubeDL', _UntitledEntryYDL), \
                mock.patch('task.tasks.download_audio_task.delay') as delay:
            download_playlist_task(playlist.pk)

        queued = dict(DownloadQueue.objects.filter(owner=owner).values_list('youtube_id', 'title'))
        self.assertEqual(queued, {'UNTITLED_001': 'Unknown', 'TITLED_0001': 'Named'})
        self.assertEqual(delay.call_count, 2)


class DownloadTimeBudgetTests(SimpleTestCase):
    def test_a_download_gets_its_own_time_budget_rather_than_the_ten_minute_default(self):
        self.assertEqual(download_audio_task.soft_time_limit, settings.DOWNLOAD_TASK_SOFT_LIMIT_SECONDS)
        self.assertGreater(download_audio_task.time_limit, download_audio_task.soft_time_limit)
        self.assertGreaterEqual(download_audio_task.soft_time_limit, THREE_HOUR_MIX_CONVERSION_SECONDS)


class ForceRecheckKeepsTrackTests(TestCase):
    """SW-002: a missing file is a repair job; the Audio row and its history stay."""

    def setUp(self):
        self.owner = Account.objects.create_user('repair_u', 'repair_u@test.local', 'Repairpw_2026!')
        self.audio = _make_audio(self.owner, youtube_id='REPAIR_YT_01')
        self.playlist = Playlist.objects.create(owner=self.owner, playlist_id='PL_repair', title='Repair')
        self.item = PlaylistItem.objects.create(playlist=self.playlist, audio=self.audio, position=0)
        self.progress = AudioProgress.objects.create(user=self.owner, audio=self.audio, position=42)
        self.segment = AudioSegment.objects.create(audio=self.audio, start_seconds=0, end_seconds=1)
        self.history = ListeningHistory.objects.create(
            user=self.owner, audio=self.audio, title='Repair Track', channel_name='Channel'
        )
        Lyrics.objects.create(audio=self.audio, plain_lyrics='synthetic words')

    def _recheck(self, force=True, file_present=False):
        with mock.patch('task.tasks.yt_dlp.YoutubeDL', _PlaylistEntriesYDL), \
                mock.patch('task.tasks.os.path.isfile', return_value=file_present), \
                mock.patch('task.tasks.download_audio_task.delay') as delay:
            download_playlist_task(self.playlist.pk, force=force)
        return delay

    def _assert_track_intact(self):
        self.assertTrue(Audio.objects.filter(pk=self.audio.pk).exists())
        self.assertTrue(PlaylistItem.objects.filter(pk=self.item.pk).exists())
        self.assertEqual(AudioProgress.objects.get(pk=self.progress.pk).position, 42)
        self.assertTrue(AudioSegment.objects.filter(pk=self.segment.pk).exists())
        self.assertTrue(ListeningHistory.objects.filter(pk=self.history.pk).exists())
        self.assertEqual(Lyrics.objects.get(audio_id=self.audio.pk).plain_lyrics, 'synthetic words')

    def _completed_queue_item(self):
        return DownloadQueue.objects.create(
            owner=self.owner,
            url='https://www.youtube.com/watch?v=REPAIR_YT_01',
            youtube_id='REPAIR_YT_01',
            status='completed',
        )

    def test_missing_file_queues_repair_for_a_completed_item(self):
        queue_item = self._completed_queue_item()
        delay = self._recheck()
        self._assert_track_intact()
        delay.assert_called_once_with(queue_item.pk)
        queue_item.refresh_from_db()
        self.assertEqual(queue_item.status, 'pending')

    def test_missing_file_queues_repair_without_a_queue_item(self):
        delay = self._recheck()
        self._assert_track_intact()
        delay.assert_called_once_with(DownloadQueue.objects.get(youtube_id='REPAIR_YT_01').pk)

    def test_present_file_is_left_alone(self):
        self._completed_queue_item()
        delay = self._recheck(file_present=True)
        self._assert_track_intact()
        delay.assert_not_called()

    def test_plain_sync_does_not_repair(self):
        self._completed_queue_item()
        delay = self._recheck(force=False)
        self._assert_track_intact()
        delay.assert_not_called()


class _RedownloadYDL(_PlaylistEntriesYDL):
    """Stand-in for a finished download that landed on a different path."""

    NEW_PATH = 'Channel/Renamed Title-REPAIR_YT_01.wav'
    INFO = {'id': 'REPAIR_YT_01', 'title': 'Renamed Title'}

    def extract_info(self, url, download=False):
        return dict(self.INFO)

    def process_ie_result(self, info, download=True):
        path = absolute_media_path(self.NEW_PATH)
        path.parent.mkdir(parents=True, exist_ok=True)
        with wave.open(str(path), 'wb') as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(8000)
            output.writeframes(bytes(1600))
        return {**info, 'requested_downloads': [{'filepath': str(path)}]}


class RedownloadRepairsInPlaceTests(TestCase):
    def setUp(self):
        self.owner = Account.objects.create_user('inplace_u', 'inplace_u@test.local', 'Inplacepw_2026!')
        self.audio = _make_audio(self.owner, youtube_id='REPAIR_YT_01')
        self.progress = AudioProgress.objects.create(user=self.owner, audio=self.audio, position=42)
        self.queue_item = DownloadQueue.objects.create(
            owner=self.owner,
            url='https://www.youtube.com/watch?v=REPAIR_YT_01',
            youtube_id='REPAIR_YT_01',
            status='pending',
        )

    def test_existing_row_points_at_the_new_file(self):
        with mock.patch('task.tasks.yt_dlp.YoutubeDL', _RedownloadYDL), \
                mock.patch('common.url_security.check_public_http_url', return_value=(True, None)), \
                mock.patch('audio.storage_service.shutil.disk_usage', return_value=mock.Mock(free=10 ** 12)), \
                mock.patch('task.tasks._resolve_download_quality', return_value='opus'), \
                mock.patch('task.tasks._postprocessor_for_quality', return_value={}), \
                mock.patch('task.tasks.link_audio_to_playlists.delay'), \
                mock.patch('task.tasks.measure_loudness_task.delay') as loudness:
            download_audio_task(self.queue_item.pk)

        self.audio.refresh_from_db()
        self.assertEqual(self.audio.file_path, _RedownloadYDL.NEW_PATH)
        self.assertEqual(self.audio.file_size, absolute_media_path(_RedownloadYDL.NEW_PATH).stat().st_size)
        self.assertEqual(self.audio.audio_format, 'wav')
        self.assertEqual(Audio.objects.filter(owner=self.owner).count(), 1)
        self.assertEqual(AudioProgress.objects.get(pk=self.progress.pk).audio_id, self.audio.pk)
        loudness.assert_not_called()


class _SnapshotYDL:
    """Stand-in for yt_dlp.YoutubeDL returning whatever listing the test set."""
    info = None
    captured_opts = None

    def __init__(self, opts):
        _SnapshotYDL.captured_opts = opts

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False

    def extract_info(self, url, download=False):
        return _SnapshotYDL.info


def _entry(video_id, title='A track'):
    return {'id': video_id, 'title': title}


class PlaylistSnapshotTests(TestCase):
    """SW-012: a sync only reorders or detaches on a list it can show is whole."""

    def setUp(self):
        media_root = tempfile.TemporaryDirectory()
        self.addCleanup(media_root.cleanup)
        settings_override = override_settings(MEDIA_ROOT=media_root.name)
        settings_override.enable()
        self.addCleanup(settings_override.disable)
        self.owner = Account.objects.create_user('snap_u', 'snap_u@test.local', 'Snappw_2026!')
        self.playlist = Playlist.objects.create(
            owner=self.owner, playlist_id='PL_snap', title='Snap', item_count=2,
            remote_video_ids=['SNAP_A', 'SNAP_B'],
        )
        self.track_a = self._member('SNAP_A', 0)
        self.track_b = self._member('SNAP_B', 1)

    def _member(self, youtube_id, position):
        audio = self._stored_track(youtube_id)
        PlaylistItem.objects.create(playlist=self.playlist, audio=audio, position=position)
        return audio

    def _stored_track(self, youtube_id):
        audio = _make_audio(self.owner, youtube_id, file_path=f'{youtube_id}.m4a')
        absolute_media_path(audio.file_path).write_bytes(b'audio')
        return audio

    def _sync(self, entries, **listing):
        _SnapshotYDL.info = {'entries': entries, **listing}
        with mock.patch('task.tasks.yt_dlp.YoutubeDL', _SnapshotYDL), \
                mock.patch('task.tasks.download_audio_task.delay') as delay:
            download_playlist_task(self.playlist.pk)
        self.playlist.refresh_from_db()
        return delay

    def _positions(self):
        return dict(PlaylistItem.objects.filter(playlist=self.playlist).values_list(
            'audio__youtube_id', 'position'
        ))

    def _serialized(self):
        return PlaylistSerializer(self.playlist).data

    def _assert_last_snapshot_kept(self):
        self.assertEqual(self._positions(), {'SNAP_A': 0, 'SNAP_B': 1})
        self.assertEqual(self.playlist.item_count, 2)
        self.assertEqual(self.playlist.remote_video_ids, ['SNAP_A', 'SNAP_B'])
        self.assertEqual(self.playlist.sync_status, 'stale')
        self.assertEqual(self.playlist.error_message, INCOMPLETE_SCAN_MESSAGE)

    def test_remote_reorder_updates_existing_positions(self):
        self._sync([_entry('SNAP_B'), _entry('SNAP_A')])

        self.assertEqual(self._positions(), {'SNAP_B': 0, 'SNAP_A': 1})
        self.assertEqual(self.playlist.remote_video_ids, ['SNAP_B', 'SNAP_A'])
        self.assertEqual(self.playlist.sync_status, 'success')

    def test_repeated_video_keeps_its_first_occurrence_and_counts_once(self):
        self._sync([_entry('SNAP_B'), _entry('SNAP_A'), _entry('SNAP_B')], playlist_count=3)

        self.assertEqual(self._positions(), {'SNAP_B': 0, 'SNAP_A': 1})
        self.assertEqual(self.playlist.item_count, 2)
        self.assertEqual(self.playlist.sync_status, 'success')

    def test_repeated_new_video_is_queued_once(self):
        delay = self._sync([_entry('SNAP_A'), _entry('SNAP_B'), _entry('SNAP_NEW'), _entry('SNAP_NEW')])

        self.assertEqual(delay.call_count, 1)
        self.assertEqual(DownloadQueue.objects.filter(owner=self.owner, youtube_id='SNAP_NEW').count(), 1)

    def test_track_gone_from_a_complete_list_is_detached_but_stays_in_the_library(self):
        self._sync([_entry('SNAP_A')], playlist_count=1)

        self.assertEqual(self._positions(), {'SNAP_A': 0})
        self.assertTrue(Audio.objects.filter(pk=self.track_b.pk).exists())
        self.assertTrue(absolute_media_path(self.track_b.file_path).is_file())

    def test_list_shorter_than_declared_keeps_the_last_snapshot(self):
        self._sync([_entry('SNAP_B')], playlist_count=2)

        self._assert_last_snapshot_kept()

    def test_list_with_an_unreadable_entry_keeps_the_last_snapshot(self):
        for unreadable in (None, {'title': 'No id'}):
            with self.subTest(unreadable=unreadable):
                self._sync([_entry('SNAP_B'), unreadable])

                self._assert_last_snapshot_kept()

    def test_new_tracks_still_download_from_an_incomplete_list(self):
        delay = self._sync([_entry('SNAP_NEW'), None])

        self.assertEqual(delay.call_count, 1)
        self._assert_last_snapshot_kept()

    def test_more_entries_than_declared_is_complete(self):
        self._sync([_entry('SNAP_B'), _entry('SNAP_A')], playlist_count=1)

        self.assertEqual(self.playlist.sync_status, 'success')

    def test_sync_asks_ytdlp_to_raise_on_incomplete_pages(self):
        self._sync([_entry('SNAP_A'), _entry('SNAP_B')])

        self.assertEqual(
            _SnapshotYDL.captured_opts['extractor_args'],
            {'youtube': {'raise_incomplete_data': ['true']}},
        )

    def test_reconciliation_is_all_or_nothing(self):
        real_save = Playlist.save

        def fail_when_recording_snapshot(playlist, *args, **kwargs):
            if 'remote_video_ids' in (kwargs.get('update_fields') or ()):
                raise RuntimeError('database went away')
            return real_save(playlist, *args, **kwargs)

        with mock.patch.object(Playlist, 'save', fail_when_recording_snapshot), \
                self.assertRaises(RuntimeError):
            self._sync([_entry('SNAP_B')], playlist_count=1)

        self.assertEqual(self._positions(), {'SNAP_A': 0, 'SNAP_B': 1})

    def test_archived_deleted_track_stays_and_only_unheld_ones_count_as_unavailable(self):
        self._sync([
            _entry('SNAP_A'),
            _entry('SNAP_B', '[Deleted video]'),
            _entry('SNAP_GONE', '[Private video]'),
        ])

        self.assertEqual(self._positions(), {'SNAP_A': 0, 'SNAP_B': 1})
        data = self._serialized()
        self.assertEqual(data['remote_total'], 3)
        self.assertEqual(data['remote_unavailable_count'], 1)
        self.assertEqual(data['local_available'], 2)
        self.assertEqual(data['progress_percent'], 100)

    def test_stored_path_without_a_file_is_not_available(self):
        absolute_media_path(self.track_b.file_path).unlink()

        self._sync([_entry('SNAP_A'), _entry('SNAP_B')])

        data = self._serialized()
        self.assertEqual(data['local_available'], 1)
        self.assertEqual(data['progress_percent'], 50)
        self.assertEqual(data['item_count'], 2)
        self.assertFalse(self.track_b.downloaded)
        self.assertTrue(self.track_a.downloaded)

    def test_pending_and_failed_are_this_owners_rows_for_this_playlist(self):
        stranger = Account.objects.create_user('snap_s', 'snap_s@test.local', 'Snappw_2026!')
        self.playlist.remote_video_ids = ['SNAP_A', 'SNAP_B', 'SNAP_P', 'SNAP_D', 'SNAP_F']
        rows = [
            (self.owner, 'SNAP_P', 'pending'),
            (self.owner, 'SNAP_D', 'downloading'),
            (self.owner, 'SNAP_F', 'failed'),
            (self.owner, 'SNAP_OTHER', 'failed'),
            (self.owner, 'SNAP_A', 'completed'),
            (stranger, 'SNAP_F', 'failed'),
        ]
        for owner, youtube_id, status in rows:
            DownloadQueue.objects.create(
                owner=owner, youtube_id=youtube_id, status=status,
                url=f'https://www.youtube.com/watch?v={youtube_id}',
            )

        data = self._serialized()

        self.assertEqual(data['pending'], 2)
        self.assertEqual(data['failed'], 1)
        self.assertNotIn('remote_video_ids', data)

    def test_link_after_download_counts_the_new_file(self):
        _cache_playlist_video_ids(self.playlist.playlist_id, ['SNAP_A', 'SNAP_B', 'SNAP_NEW'])
        self.addCleanup(cache.delete, f'{PLAYLIST_YTIDS_CACHE_PREFIX}{self.playlist.playlist_id}')
        new_track = self._stored_track('SNAP_NEW')

        link_audio_to_playlists(new_track.pk, self.owner.pk)

        self.playlist.refresh_from_db()
        self.assertEqual(self._positions()['SNAP_NEW'], 2)
        self.assertEqual(self.playlist.downloaded_count, 3)

    def _add_through_api(self, playlist):
        client = APIClient()
        client.force_authenticate(self.owner)
        extra = self._stored_track(f'{playlist.playlist_type[:4]}_EXTRA')
        response = client.post(
            f'/api/playlist/{playlist.playlist_id}/items/', {'youtube_id': extra.youtube_id}, format='json',
        )
        self.assertEqual(response.status_code, 201)
        playlist.refresh_from_db()

    def test_manual_edit_keeps_the_remote_total_of_a_youtube_playlist(self):
        self._add_through_api(self.playlist)

        self.assertEqual(self.playlist.remote_total, 2)
        self.assertEqual(self.playlist.downloaded_count, 3)
        self.assertEqual(PlaylistSerializer(self.playlist).data['item_count'], 3)

    def test_custom_playlist_counts_its_own_tracks_and_has_no_remote_total(self):
        custom = Playlist.objects.create(
            owner=self.owner, playlist_id='custom-snap', title='Mine', playlist_type='custom',
        )

        self._add_through_api(custom)

        self.assertEqual(custom.item_count, 1)
        self.assertEqual(custom.downloaded_count, 1)
        data = PlaylistSerializer(custom).data
        self.assertIsNone(data['remote_total'])
        self.assertEqual(data['progress_percent'], 100)


class FailureClassifierTests(TestCase):
    """SW-012: automatic retries and sync skips agree on what is permanent."""

    def setUp(self):
        self.owner = Account.objects.create_user('class_u', 'class_u@test.local', 'Classpw_2026!')

    def _failed(self, youtube_id, error_message):
        return DownloadQueue.objects.create(
            owner=self.owner, youtube_id=youtube_id, status='failed', error_message=error_message,
            url=f'https://www.youtube.com/watch?v={youtube_id}',
        )

    def test_every_permanent_pattern_is_left_alone_by_automatic_retry(self):
        rows = [self._failed(f'perm_{index}', f'ERROR: {pattern}') for index, pattern in enumerate(PERMANENT_ERROR_PATTERNS)]

        with mock.patch('task.tasks.download_audio_task.delay') as delay:
            retry_failed_downloads()

        delay.assert_not_called()
        self.assertEqual(get_permanently_unavailable_ids(self.owner), {row.youtube_id for row in rows})

    def test_rate_limits_and_missing_formats_are_retried_despite_their_wording(self):
        temporary_messages = [
            'ERROR: [youtube] VIDEO_ID_01: Requested format is not available. Use --list-formats',
            "ERROR: [youtube] VIDEO_ID_01: Video unavailable. This content isn't available, try again later. "
            'The current session has been rate-limited by YouTube for up to an hour.',
        ]
        rows = [self._failed(f'temporary_{index}', message) for index, message in enumerate(temporary_messages)]

        with mock.patch('task.tasks.download_audio_task.delay') as delay:
            retry_failed_downloads()

        self.assertEqual(delay.call_count, len(rows))
        self.assertEqual(get_permanently_unavailable_ids(self.owner), set())
        for message in temporary_messages:
            self.assertFalse(is_permanently_unavailable(message))

    def test_transient_failure_is_retried(self):
        row = self._failed('transient', 'ERROR: HTTP 503')

        with mock.patch('task.tasks.download_audio_task.delay') as delay:
            retry_failed_downloads()

        delay.assert_called_once_with(row.pk)
        self.assertEqual(get_permanently_unavailable_ids(self.owner), set())


class DormantTaskApiTests(TestCase):
    """SW-022: an API with nothing behind it must say so rather than promise queued work."""

    def setUp(self):
        admin = Account.objects.create_user('task_a', 'task_a@test.local', 'Taskpw_2026!')
        admin.is_staff = True
        admin.save()
        self.client = APIClient()
        self.client.force_authenticate(admin)

    def test_creating_a_task_does_not_claim_success(self):
        with mock.patch('task.tasks.update_subscriptions_task.delay') as delay:
            response = self.client.post('/api/task/create/', {'task_name': 'update_subscriptions'}, format='json')

        self.assertEqual(response.status_code, 501)
        self.assertNotIn('message', response.data)
        delay.assert_not_called()

    def test_listing_does_not_claim_nothing_is_running(self):
        response = self.client.get('/api/task/')

        self.assertEqual(response.status_code, 501)
        self.assertNotIn('data', response.data)


class DownloadQualityTests(SimpleTestCase):
    """YouTube audio is already lossy: converting it costs CPU and disk and adds nothing (SW-112)."""

    def test_original_asks_for_the_source_codec_and_no_bitrate(self):
        self.assertEqual(_postprocessor_for_quality('original'), {'preferredcodec': 'best'})

    def test_an_unset_or_unknown_setting_means_original(self):
        for quality in (None, '', 'auto', 'no-such-tier', ' Original '):
            with self.subTest(quality):
                self.assertEqual(_postprocessor_for_quality(quality), _postprocessor_for_quality('original'))

    def test_the_converting_tiers_still_convert(self):
        self.assertEqual(_postprocessor_for_quality('high'), {'preferredcodec': 'm4a', 'preferredquality': '320'})
        self.assertEqual(_postprocessor_for_quality('low'), {'preferredcodec': 'opus', 'preferredquality': '96'})
        for lossless_alias in ('best', 'ultra', 'flac'):
            self.assertEqual(_postprocessor_for_quality(lossless_alias), {'preferredcodec': 'flac'})

    def test_the_stored_format_is_what_the_finished_file_is(self):
        self.assertEqual(_stored_format('users/1/Track-abc.opus'), 'opus')
        self.assertEqual(_stored_format('users/1/Track.with.dots-abc.M4A'), 'm4a')


@unittest.skipUnless(shutil.which('ffmpeg'), 'needs ffmpeg')
class OriginalQualityKeepsTheStreamTests(SimpleTestCase):
    """Runs yt-dlp's real extraction step on a real file, the way a download would."""

    SECONDS = 20

    def setUp(self):
        self.folder = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.folder, ignore_errors=True)

    def _source(self, name, encoder):
        path = self.folder / name
        subprocess.run(
            ['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', f'sine=frequency=440:duration={self.SECONDS}',
             '-c:a', encoder, str(path)],
            check=True, timeout=60,
        )
        return path

    def _extract(self, source, quality):
        step = FFmpegExtractAudioPP(None, **_postprocessor_for_quality(quality))
        with mock.patch.object(step, 'run_ffmpeg', wraps=step.run_ffmpeg) as ffmpeg_run:
            _leftovers, result = step.run({'filepath': str(source), 'ext': source.suffix.lstrip('.')})
        return Path(result['filepath']), ffmpeg_run

    def test_opus_from_youtubes_container_is_moved_not_re_encoded(self):
        source = self._source('track.webm', 'libopus')
        source_bytes = source.stat().st_size

        finished, ffmpeg_run = self._extract(source, 'original')

        self.assertEqual(_stored_format(finished), 'opus')
        self.assertEqual(ffmpeg_run.call_args.args[2], 'copy')
        self.assertLessEqual(finished.stat().st_size, source_bytes * 1.05)

    def test_audio_already_in_a_playable_file_is_left_alone(self):
        source = self._source('track.m4a', 'aac')

        finished, ffmpeg_run = self._extract(source, 'original')

        self.assertEqual(finished, source)
        ffmpeg_run.assert_not_called()

    def test_a_converting_tier_re_encodes_the_same_source(self):
        """The control: this is the work 'original' no longer does."""
        source = self._source('track.webm', 'libopus')

        finished, ffmpeg_run = self._extract(source, 'high')

        self.assertEqual(_stored_format(finished), 'm4a')
        self.assertNotEqual(ffmpeg_run.call_args.args[2], 'copy')


class DownloadQualitySettingTests(TestCase):
    CONFIG_URL = '/api/user/config/'

    def setUp(self):
        self.owner = Account.objects.create_user('quality_u', 'quality_u@test.local', 'Qualitypw_2026!')
        self.client = APIClient()
        self.client.force_authenticate(user=self.owner)

    def _queued(self, **fields):
        return DownloadQueue.objects.create(owner=self.owner, url='https://www.youtube.com/watch?v=QUALITY_001', **fields)

    def test_a_new_account_downloads_in_original_quality(self):
        self.assertEqual(self.client.get(self.CONFIG_URL).json()['audio_quality'], 'original')
        self.assertEqual(_resolve_download_quality(self._queued()), 'original')

    def test_original_can_be_chosen_and_an_unknown_tier_cannot(self):
        UserConfig.objects.create(user=self.owner, audio_quality='high')

        chosen = self.client.post(self.CONFIG_URL, {'audio_quality': 'original'}, format='json')
        unknown = self.client.post(self.CONFIG_URL, {'audio_quality': 'studio-master'}, format='json')

        self.assertEqual(chosen.status_code, 200)
        self.assertEqual(unknown.status_code, 400)
        self.assertEqual(UserConfig.objects.get(user=self.owner).audio_quality, 'original')

    def test_an_account_that_chose_a_conversion_keeps_it(self):
        UserConfig.objects.create(user=self.owner, audio_quality='high')

        self.assertEqual(_resolve_download_quality(self._queued()), 'high')

    def test_a_channel_set_to_original_overrides_the_account(self):
        UserConfig.objects.create(user=self.owner, audio_quality='high')
        Channel.objects.create(
            owner=self.owner, channel_id='UC_QUALITY', channel_name='Talks', subscribed=True, download_quality='original',
        )

        self.assertEqual(_resolve_download_quality(self._queued(channel_name='Talks')), 'original')
