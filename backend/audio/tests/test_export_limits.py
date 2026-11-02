"""SW-018: exports stay inside their budget, never /tmp, and clean up after themselves.

Run: python manage.py test audio.tests.test_export_limits --settings=config.settings_test
"""
import errno
import os
import tempfile
import time
import uuid
from collections import namedtuple
from datetime import timedelta
from pathlib import Path
from unittest import mock

from django.core.cache import cache
from django.core.signals import request_finished
from django.db import close_old_connections
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from audio.export import ExportedTrack, ExportSourceUnavailable
from audio.export_limits import (
    JOB_SLOT,
    SYNC_SLOT,
    ExportRefused,
    estimated_export_bytes,
    refuse_if_no_room,
    remove_scratch_dir,
    take_slot,
)
from audio.models import Audio
from audio.models_export import (
    STATUS_CANCELED,
    STATUS_EXPIRED,
    STATUS_FAILED,
    STATUS_QUEUED,
    STATUS_READY,
    STATUS_RUNNING,
    ExportJob,
)
from audio.tasks import build_playlist_export, sweep_export_scratch
from playlist.models import Playlist, PlaylistItem
from user.models import Account

DiskUsage = namedtuple('DiskUsage', 'total used free')
PLENTY = DiskUsage(10 ** 13, 0, 10 ** 13)
MEGABYTE = 1024 ** 2
OPTIONS = {'format': 'mp3', 'quality': 'high', 'embed_lyrics': True, 'embed_artwork': True}


def fake_export(audio, target_format, quality, output_dir, *, filename=None, **options):
    written = Path(output_dir) / (filename or f'{audio.youtube_id}.{target_format}')
    written.write_bytes(b'audio-' + audio.youtube_id.encode())
    return ExportedTrack(written)


class ExportTestCase(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        work = tempfile.TemporaryDirectory()
        self.addCleanup(work.cleanup)
        self.scratch = Path(work.name) / 'scratch'
        self.media = Path(work.name) / 'media'
        self.media.mkdir()
        overrides = override_settings(
            EXPORT_SCRATCH_DIR=str(self.scratch), MEDIA_ROOT=str(self.media),
            EXPORT_MAX_BYTES=100 * MEGABYTE, EXPORT_MIN_FREE_BYTES=10 * MEGABYTE,
            EXPORT_SYNC_MAX_BYTES=10 * MEGABYTE, EXPORT_MAX_SYNC=2,
        )
        overrides.enable()
        self.addCleanup(overrides.disable)
        disk = mock.patch('audio.export_limits.shutil.disk_usage', return_value=PLENTY)
        self.disk_usage = disk.start()
        self.addCleanup(disk.stop)
        exporter = mock.patch('audio.export.export_track_to_file', side_effect=fake_export)
        self.exporter = exporter.start()
        self.addCleanup(exporter.stop)

        self.owner = Account.objects.create_user('lim_u', 'lim_u@test.local', 'Limitpw_2026!')
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def _track(self, youtube_id='LIM_1', duration=60, owner=None):
        (self.media / f'{youtube_id}.m4a').write_bytes(b'source')
        return Audio.objects.create(
            owner=owner or self.owner, youtube_id=youtube_id, title=f'Track {youtube_id}', channel_id='UC',
            channel_name='Chan', duration=duration, file_path=f'{youtube_id}.m4a', file_size=6,
            published_date=timezone.now(),
        )

    def _playlist(self, *tracks, owner=None):
        playlist = Playlist.objects.create(owner=owner or self.owner, playlist_id=f'PL{uuid.uuid4().hex[:8]}', title='Mix')
        for position, track in enumerate(tracks):
            PlaylistItem.objects.create(playlist=playlist, audio=track, position=position)
        return playlist

    def _big_playlist(self):
        # 60 seconds at 320k is 2.4 MB, so five tracks pass the 10 MB synchronous limit.
        return self._playlist(*[self._track(f'BIG_{index}', duration=60) for index in range(5)])

    def _scratch_contents(self):
        return list(self.scratch.iterdir()) if self.scratch.exists() else []

    def _job(self, playlist, **fields):
        return ExportJob.objects.create(owner=playlist.owner, playlist=playlist, options=OPTIONS, **fields)


class EstimateTests(ExportTestCase):
    def test_estimates_follow_format_and_quality(self):
        track = self._track(duration=100)

        self.assertEqual(estimated_export_bytes([track], 'mp3', 'low'), 1_600_000)
        self.assertEqual(estimated_export_bytes([track], 'mp3', 'high'), 4_000_000)
        self.assertEqual(estimated_export_bytes([track], 'flac', 'high'), 17_640_000)

    def test_a_copy_is_estimated_from_the_file_itself(self):
        track = self._track(duration=100)
        track.file_path = 'x.mp3'
        track.file_size = 1234

        self.assertEqual(estimated_export_bytes([track], 'mp3', 'original'), 1234)
        self.assertEqual(estimated_export_bytes([track], 'mp3', 'low'), 1_600_000)

    def test_estimates_add_up(self):
        tracks = [self._track(f'SUM_{index}', duration=100) for index in range(3)]

        self.assertEqual(estimated_export_bytes(tracks, 'mp3', 'low'), 4_800_000)


class RoomTests(ExportTestCase):
    def test_too_large_is_refused(self):
        with self.assertRaises(ExportRefused) as refused:
            refuse_if_no_room(101 * MEGABYTE)
        self.assertEqual(refused.exception.status, 413)

    def test_not_enough_free_space_is_refused(self):
        self.disk_usage.return_value = DiskUsage(0, 0, 15 * MEGABYTE)

        with self.assertRaises(ExportRefused) as refused:
            refuse_if_no_room(6 * MEGABYTE)
        self.assertEqual(refused.exception.status, 507)

    def test_enough_free_space_passes(self):
        self.disk_usage.return_value = DiskUsage(0, 0, 15 * MEGABYTE)

        refuse_if_no_room(5 * MEGABYTE)

    def test_free_space_is_measured_on_the_scratch_folder_not_tmp(self):
        refuse_if_no_room(1)

        self.disk_usage.assert_called_with(self.scratch)


class SlotTests(ExportTestCase):
    def test_capacity_is_respected_and_released_slots_return(self):
        first = take_slot(SYNC_SLOT, 2, 60)
        second = take_slot(SYNC_SLOT, 2, 60)

        self.assertIsNotNone(first)
        self.assertIsNotNone(second)
        self.assertIsNone(take_slot(SYNC_SLOT, 2, 60))

        cache.delete(first)
        self.assertIsNotNone(take_slot(SYNC_SLOT, 2, 60))

    def test_job_and_request_slots_are_separate(self):
        take_slot(SYNC_SLOT, 1, 60)

        self.assertIsNotNone(take_slot(JOB_SLOT, 1, 60))


class ScratchSafetyTests(ExportTestCase):
    def test_removal_refuses_anything_outside_scratch(self):
        source = self.media / 'precious.m4a'
        source.write_bytes(b'source')

        remove_scratch_dir(self.media)
        remove_scratch_dir(self.scratch)

        self.assertTrue(source.exists())

    def test_removal_follows_no_path_escape(self):
        source = self.media / 'precious.m4a'
        source.write_bytes(b'source')
        self.scratch.mkdir()

        remove_scratch_dir(self.scratch / '..' / 'media')

        self.assertTrue(source.exists())


class SingleExportTests(ExportTestCase):
    def setUp(self):
        super().setUp()
        self.track = self._track()
        self.url = f'/api/audio/{self.track.youtube_id}/export/'

    def test_streams_from_disk_and_cleans_up_when_finished(self):
        response = self.client.post(self.url, {'format': 'mp3'}, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.streaming)
        self.assertEqual(len(self._scratch_contents()), 1)
        self.assertEqual(b''.join(response.streaming_content), b'audio-LIM_1')
        self.assertEqual(self._scratch_contents(), [])

    def test_cleans_up_when_the_client_goes_away_mid_download(self):
        response = self.client.post(self.url, {'format': 'mp3'}, format='json')

        # As the test client does: closing would otherwise end the test's database connection.
        request_finished.disconnect(close_old_connections)
        self.addCleanup(request_finished.connect, close_old_connections)
        response.close()

        self.assertEqual(self._scratch_contents(), [])
        self.assertIsNotNone(take_slot(SYNC_SLOT, 1, 60))

    def test_failed_conversion_cleans_up_and_is_not_a_success(self):
        self.exporter.side_effect = subprocess_timeout()

        response = self.client.post(self.url, {'format': 'mp3'}, format='json')

        self.assertEqual(response.status_code, 500)
        self.assertEqual(self._scratch_contents(), [])
        self.assertIsNotNone(take_slot(SYNC_SLOT, 1, 60))

    def test_unexpected_failure_still_cleans_up(self):
        self.exporter.side_effect = RuntimeError('boom')
        client = APIClient(raise_request_exception=False)
        client.force_authenticate(self.owner)

        self.assertEqual(client.post(self.url, {'format': 'mp3'}, format='json').status_code, 500)

        self.assertEqual(self._scratch_contents(), [])

    def test_missing_source_is_not_found(self):
        self.exporter.side_effect = ExportSourceUnavailable('gone')

        self.assertEqual(self.client.post(self.url, {'format': 'mp3'}, format='json').status_code, 404)
        self.assertEqual(self._scratch_contents(), [])

    def test_too_large_is_refused_before_any_work(self):
        self.track.duration = 10 ** 6
        self.track.save()

        response = self.client.post(self.url, {'format': 'flac'}, format='json')

        self.assertEqual(response.status_code, 413)
        self.exporter.assert_not_called()

    def test_busy_server_is_refused_before_any_work(self):
        take_slot(SYNC_SLOT, 2, 60)
        take_slot(SYNC_SLOT, 2, 60)

        response = self.client.post(self.url, {'format': 'mp3'}, format='json')

        self.assertEqual(response.status_code, 429)
        self.exporter.assert_not_called()

    def test_source_file_is_never_touched(self):
        source = self.media / self.track.file_path

        response = self.client.post(self.url, {'format': 'mp3'}, format='json')
        b''.join(response.streaming_content)

        self.assertEqual(source.read_bytes(), b'source')


def subprocess_timeout():
    import subprocess
    return subprocess.TimeoutExpired(cmd='ffmpeg', timeout=1)


class PlaylistRouteTests(ExportTestCase):
    def _post(self, playlist, **body):
        return self.client.post(f'/api/playlist/{playlist.playlist_id}/export/', body, format='json')

    def test_small_playlist_stays_synchronous_and_cleans_up(self):
        playlist = self._playlist(self._track('S1'), self._track('S2'))

        response = self._post(playlist)

        self.assertEqual(response.status_code, 200)
        b''.join(response.streaming_content)
        self.assertEqual(self._scratch_contents(), [])
        self.assertFalse(ExportJob.objects.exists())
        self.assertTrue(cache.add(f'playlist_export_lock:{self.owner.id}', True))

    def test_large_playlist_becomes_a_job_and_holds_no_web_thread(self):
        playlist = self._big_playlist()

        with mock.patch('audio.tasks.build_playlist_export.delay') as delay, \
                self.captureOnCommitCallbacks(execute=True):
            response = self._post(playlist)

        self.assertEqual(response.status_code, 202)
        job = ExportJob.objects.get()
        self.assertEqual(response.data['job_id'], str(job.pk))
        self.assertEqual((job.status, job.tracks_total, job.owner), (STATUS_QUEUED, 5, self.owner))
        delay.assert_called_once_with(str(job.pk))
        self.exporter.assert_not_called()

    def test_oversized_playlist_is_refused_outright(self):
        playlist = self._playlist(self._track('HUGE', duration=10 ** 6))

        self.assertEqual(self._post(playlist).status_code, 413)
        self.assertFalse(ExportJob.objects.exists())

    def test_no_room_is_refused(self):
        self.disk_usage.return_value = DiskUsage(0, 0, MEGABYTE)

        self.assertEqual(self._post(self._playlist(self._track())).status_code, 507)

    def test_one_active_job_per_account(self):
        playlist = self._big_playlist()
        self._job(playlist, status=STATUS_RUNNING)

        self.assertEqual(self._post(playlist).status_code, 429)

    def test_busy_server_releases_the_personal_lock(self):
        take_slot(SYNC_SLOT, 2, 60)
        take_slot(SYNC_SLOT, 2, 60)

        self.assertEqual(self._post(self._playlist(self._track())).status_code, 429)
        self.assertTrue(cache.add(f'playlist_export_lock:{self.owner.id}', True))

    def test_nothing_exported_is_not_a_success(self):
        self.exporter.side_effect = ExportSourceUnavailable('gone')

        self.assertEqual(self._post(self._playlist(self._track())).status_code, 422)
        self.assertEqual(self._scratch_contents(), [])


class JobLifecycleTests(ExportTestCase):
    def setUp(self):
        super().setUp()
        self.playlist = self._playlist(self._track('J1'), self._track('J2'))
        self.job = self._job(self.playlist, tracks_total=2)

    def _run(self):
        build_playlist_export.apply(args=[str(self.job.pk)])
        self.job.refresh_from_db()

    def test_finishes_ready_with_an_expiry_and_a_real_file(self):
        self._run()

        self.assertEqual(self.job.status, STATUS_READY)
        self.assertEqual(self.job.tracks_done, 2)
        self.assertGreater(self.job.expires_at, timezone.now())
        self.assertGreater(self.job.file_bytes, 0)
        self.assertTrue(Path(self.job.scratch_dir, self.job.file_name).is_file())
        self.assertIsNotNone(take_slot(JOB_SLOT, 1, 60))

    def test_only_one_export_runs_and_another_waits(self):
        take_slot(JOB_SLOT, 1, 60)

        with mock.patch.object(build_playlist_export, 'apply_async') as retry:
            self._run()

        self.assertEqual(self.job.status, STATUS_QUEUED)
        retry.assert_called_once()
        self.exporter.assert_not_called()

    def test_a_canceled_job_stops_waiting(self):
        take_slot(JOB_SLOT, 1, 60)
        ExportJob.objects.filter(pk=self.job.pk).update(status=STATUS_CANCELED)

        with mock.patch.object(build_playlist_export, 'apply_async') as retry:
            self._run()

        retry.assert_not_called()

    def test_runs_only_once(self):
        self._run()
        calls = self.exporter.call_count

        self._run()

        self.assertEqual(self.exporter.call_count, calls)

    def test_cancel_during_the_run_stops_and_frees_the_space(self):
        def cancel_after_first(audio, *args, **kwargs):
            ExportJob.objects.filter(pk=self.job.pk).update(status=STATUS_CANCELED)
            return fake_export(audio, *args, **kwargs)

        self.exporter.side_effect = cancel_after_first

        self._run()

        self.assertEqual(self.job.status, STATUS_CANCELED)
        self.assertEqual(self.exporter.call_count, 1)
        self.assertEqual(self._scratch_contents(), [])
        self.assertEqual(self.job.scratch_dir, '')

    def test_failed_conversions_are_not_completed(self):
        self.exporter.side_effect = ExportSourceUnavailable('gone')

        self._run()

        self.assertEqual(self.job.status, STATUS_FAILED)
        self.assertTrue(self.job.error_message)
        self.assertEqual(self._scratch_contents(), [])

    def test_full_disk_fails_cleanly(self):
        self.exporter.side_effect = OSError(errno.ENOSPC, 'No space left on device')

        self._run()

        self.assertEqual(self.job.status, STATUS_FAILED)
        self.assertIn('space', self.job.error_message)
        self.assertEqual(self._scratch_contents(), [])
        self.assertIsNotNone(take_slot(JOB_SLOT, 1, 60))

    def test_task_time_limit_fails_cleanly(self):
        from celery.exceptions import SoftTimeLimitExceeded
        self.exporter.side_effect = SoftTimeLimitExceeded()

        self._run()

        self.assertEqual(self.job.status, STATUS_FAILED)
        self.assertIn('long', self.job.error_message)
        self.assertEqual(self._scratch_contents(), [])

    def test_growing_past_the_limit_stops_and_says_what_was_left_out(self):
        with override_settings(EXPORT_MAX_BYTES=1):
            self._run()

        self.assertEqual(self.job.status, STATUS_READY)
        self.assertEqual(self.job.summary['omitted'][0]['reason'], 'too_large')
        self.assertEqual(len(self.job.summary['omitted']), 1)

    def test_a_partial_result_records_what_was_omitted(self):
        def lose_second(audio, *args, **kwargs):
            if audio.youtube_id == 'J2':
                raise ExportSourceUnavailable('gone')
            return fake_export(audio, *args, **kwargs)

        self.exporter.side_effect = lose_second

        self._run()

        self.assertEqual(self.job.status, STATUS_READY)
        self.assertEqual(self.job.summary['omitted'][0]['title'], 'Track J2')

    def test_a_conversion_timeout_omits_that_track_only(self):
        def time_out_second(audio, *args, **kwargs):
            if audio.youtube_id == 'J2':
                raise subprocess_timeout()
            return fake_export(audio, *args, **kwargs)

        self.exporter.side_effect = time_out_second

        self._run()

        self.assertEqual(self.job.status, STATUS_READY)
        self.assertEqual(self.job.summary['omitted'][0]['reason'], 'TimeoutExpired')

    def test_task_names_are_registered_for_the_worker(self):
        from config.celery import app

        self.assertIn('audio.build_playlist_export', app.tasks)
        self.assertEqual(app.conf.beat_schedule['sweep-export-scratch']['task'], 'audio.sweep_export_scratch')
        self.assertIn('audio.sweep_export_scratch', app.tasks)

    def test_time_limit_outlasts_the_workers_default(self):
        self.assertGreater(build_playlist_export.soft_time_limit, 600)
        self.assertGreater(build_playlist_export.time_limit, build_playlist_export.soft_time_limit)


class JobApiTests(ExportTestCase):
    def setUp(self):
        super().setUp()
        self.playlist = self._playlist(self._track('A1'))
        self.stranger = Account.objects.create_user('lim_s', 'lim_s@test.local', 'Limitpw_2026!')
        self.stranger_client = APIClient()
        self.stranger_client.force_authenticate(self.stranger)

    def _ready_job(self, **fields):
        job = self._job(self.playlist, tracks_total=1)
        build_playlist_export.apply(args=[str(job.pk)])
        job.refresh_from_db()
        if fields:
            ExportJob.objects.filter(pk=job.pk).update(**fields)
            job.refresh_from_db()
        return job

    def test_progress_is_readable_by_the_owner_only(self):
        job = self._job(self.playlist, tracks_total=3, tracks_done=1)

        response = self.client.get(f'/api/export-jobs/{job.pk}/')

        self.assertEqual((response.data['tracks_done'], response.data['tracks_total']), (1, 3))
        self.assertEqual(self.stranger_client.get(f'/api/export-jobs/{job.pk}/').status_code, 404)

    def test_download_streams_for_the_owner_only(self):
        job = self._ready_job()
        url = f'/api/export-jobs/{job.pk}/download/'

        self.assertEqual(self.stranger_client.get(url).status_code, 404)
        response = self.client.get(url)

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.streaming)
        self.assertGreater(len(b''.join(response.streaming_content)), 0)
        self.assertTrue(Path(job.scratch_dir, job.file_name).exists())

    def test_expired_or_unfinished_cannot_be_downloaded(self):
        job = self._ready_job(expires_at=timezone.now() - timedelta(minutes=1))
        running = self._job(self.playlist, status=STATUS_RUNNING)

        self.assertEqual(self.client.get(f'/api/export-jobs/{job.pk}/download/').status_code, 410)
        self.assertEqual(self.client.get(f'/api/export-jobs/{running.pk}/download/').status_code, 410)

    def test_cancel_marks_a_running_job_and_the_stranger_cannot(self):
        job = self._job(self.playlist, status=STATUS_RUNNING)

        self.assertEqual(self.stranger_client.delete(f'/api/export-jobs/{job.pk}/').status_code, 404)
        job.refresh_from_db()
        self.assertEqual(job.status, STATUS_RUNNING)

        self.assertEqual(self.client.delete(f'/api/export-jobs/{job.pk}/').status_code, 204)
        job.refresh_from_db()
        self.assertEqual(job.status, STATUS_CANCELED)

    def test_discarding_a_ready_result_frees_its_space(self):
        job = self._ready_job()

        self.client.delete(f'/api/export-jobs/{job.pk}/')

        self.assertEqual(self._scratch_contents(), [])

    def test_listing_shows_this_accounts_current_exports(self):
        ready = self._ready_job()
        self._job(self.playlist, status=STATUS_FAILED)
        other = self._playlist(self._track('OTHER', owner=self.stranger), owner=self.stranger)
        self._job(other, status=STATUS_RUNNING)

        response = self.client.get('/api/export-jobs/', {'playlist': self.playlist.playlist_id})

        self.assertEqual([row['id'] for row in response.data['data']], [str(ready.pk)])
        everything = self.client.get('/api/export-jobs/')
        self.assertEqual([row['id'] for row in everything.data['data']], [str(ready.pk)])


class SweepTests(ExportTestCase):
    def setUp(self):
        super().setUp()
        self.playlist = self._playlist(self._track('SW'))

    def _ready_job(self):
        job = self._job(self.playlist, tracks_total=1)
        build_playlist_export.apply(args=[str(job.pk)])
        job.refresh_from_db()
        return job

    def test_expired_results_free_their_space(self):
        job = self._ready_job()
        ExportJob.objects.filter(pk=job.pk).update(expires_at=timezone.now() - timedelta(seconds=1))

        sweep_export_scratch()

        job.refresh_from_db()
        self.assertEqual(job.status, STATUS_EXPIRED)
        self.assertEqual(self._scratch_contents(), [])

    def test_results_within_their_lifetime_stay(self):
        job = self._ready_job()

        sweep_export_scratch()

        job.refresh_from_db()
        self.assertEqual(job.status, STATUS_READY)
        self.assertEqual(len(self._scratch_contents()), 1)

    def test_jobs_a_dead_worker_left_are_failed_and_freed(self):
        leftover = self.scratch / 'leftover'
        leftover.mkdir(parents=True)
        job = self._job(self.playlist, status=STATUS_RUNNING, scratch_dir=str(leftover))
        ExportJob.objects.filter(pk=job.pk).update(created_at=timezone.now() - timedelta(hours=3))

        sweep_export_scratch()

        job.refresh_from_db()
        self.assertEqual(job.status, STATUS_FAILED)
        self.assertFalse(leftover.exists())

    def test_recent_active_jobs_are_left_alone(self):
        job = self._job(self.playlist, status=STATUS_RUNNING)

        sweep_export_scratch()

        job.refresh_from_db()
        self.assertEqual(job.status, STATUS_RUNNING)

    def test_old_stray_folders_go_and_recent_ones_stay(self):
        old = self.scratch / 'old'
        recent = self.scratch / 'recent'
        old.mkdir(parents=True)
        recent.mkdir()
        long_ago = time.time() - 7 * 60 * 60
        os.utime(old, (long_ago, long_ago))

        sweep_export_scratch()

        self.assertFalse(old.exists())
        self.assertTrue(recent.exists())

    def test_sweep_never_touches_source_media(self):
        source = self.media / 'SW.m4a'
        job = self._job(self.playlist, status=STATUS_RUNNING, scratch_dir=str(self.media))
        ExportJob.objects.filter(pk=job.pk).update(created_at=timezone.now() - timedelta(hours=3))

        sweep_export_scratch()

        self.assertTrue(source.exists())
