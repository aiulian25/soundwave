"""SW-002: each owner's bytes are independent, from download path to delete and tag edit.

Run: python manage.py test audio.tests.test_media_lifecycle --settings=config.settings_test
"""
import json
import shutil
import tempfile
import wave
from io import StringIO
from pathlib import Path
from unittest import mock

import yt_dlp
from django.core.management import call_command
from django.db import transaction
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from audio.id3_service import ID3TagService
from audio.models import Audio, AudioProgress
from audio.storage_service import (
    contained_media_path,
    ensure_private_file,
    owner_download_template,
    relative_media_path,
    remove_if_unreferenced,
)
from audio.tasks_artwork import update_id3_tags_from_metadata
from download.models import DownloadQueue
from playlist.models import Playlist
from task.tasks import _publish_download, download_audio_task, download_playlist_task, measure_loudness_task
from user.models import Account

SHARED_PATH = 'Channel/Shared Title-LIFE_YT_01.wav'
YOUTUBE_ID = 'LIFE_YT_01'
COMMAND = 'migrate_media_paths'


def write_wav(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(8000)
        output.writeframes(bytes(1600))


def make_audio(owner, file_path=SHARED_PATH, youtube_id=YOUTUBE_ID):
    return Audio.objects.create(
        owner=owner, youtube_id=youtube_id, title='Shared Title', channel_id='UC', channel_name='Channel',
        duration=1, file_path=file_path, file_size=1, published_date=timezone.now(),
    )


class MediaLifecycleTestCase(TestCase):
    def setUp(self):
        self.media_root = Path(tempfile.mkdtemp(prefix='soundwave 100%(id)s '))
        self.addCleanup(shutil.rmtree, self.media_root)
        settings_override = override_settings(MEDIA_ROOT=str(self.media_root), DATA_DIR=str(self.media_root / 'data'))
        settings_override.enable()
        self.addCleanup(settings_override.disable)
        self.alice = Account.objects.create_user('alice_life', 'alice_life@test.local', 'Alicepw_2026!')
        self.bob = Account.objects.create_user('bob_life', 'bob_life@test.local', 'Bobpw_2026!')

    def shared_pair(self):
        write_wav(self.media_root / SHARED_PATH)
        return make_audio(self.alice), make_audio(self.bob)

    def bytes_of(self, audio):
        audio.refresh_from_db()
        return (self.media_root / audio.file_path).read_bytes()

    def tags_of(self, audio):
        audio.refresh_from_db()
        return ID3TagService().read_tags(str(self.media_root / audio.file_path)) or {}


class OwnerPathTests(MediaLifecycleTestCase):
    def test_real_yt_dlp_names_files_inside_the_owners_folder_under_a_custom_root(self):
        options = {'outtmpl': owner_download_template(self.alice.pk), 'quiet': True}
        with yt_dlp.YoutubeDL(options) as ydl:
            produced = ydl.prepare_filename({'id': YOUTUBE_ID, 'ext': 'webm', 'title': 'Any / Title', 'channel': 'X'})
        self.assertEqual(relative_media_path(produced), f'users/{self.alice.pk}/{YOUTUBE_ID}.webm')

    def test_two_owners_of_one_video_get_different_paths(self):
        self.assertNotEqual(owner_download_template(self.alice.pk), owner_download_template(self.bob.pk))

    def test_workers_read_from_the_configured_root(self):
        audio = make_audio(self.alice)
        with mock.patch('task.tasks.measure_loudness_lufs', return_value=None) as measure:
            measure_loudness_task(audio.pk)
        measure.assert_called_once_with(str(self.media_root / SHARED_PATH))

    def test_force_recheck_looks_in_the_configured_root(self):
        write_wav(self.media_root / SHARED_PATH)
        make_audio(self.alice)
        playlist = Playlist.objects.create(owner=self.alice, playlist_id='PL_life', title='T')

        class ListedYoutubeDL:
            def __init__(self, options):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *exc_info):
                return False

            def extract_info(self, url, download=False):
                return {'entries': [{'id': YOUTUBE_ID, 'title': 'Listed'}]}

        with mock.patch('task.tasks.yt_dlp.YoutubeDL', ListedYoutubeDL), \
                mock.patch('task.tasks.download_audio_task.delay') as delay:
            download_playlist_task(playlist.pk, force=True)
        delay.assert_not_called()

    def test_a_path_outside_the_root_is_not_contained(self):
        self.assertIsNone(contained_media_path('../outside.wav'))
        self.assertIsNone(contained_media_path('/etc/passwd'))
        self.assertIsNotNone(contained_media_path('Channel/inside.wav'))


class TagIsolationTests(MediaLifecycleTestCase):
    def test_tag_edit_leaves_the_other_owners_bytes_alone(self):
        alice_audio, bob_audio = self.shared_pair()
        bob_bytes_before = self.bytes_of(bob_audio)

        Audio.objects.filter(pk=alice_audio.pk).update(title='Alice Title')
        update_id3_tags_from_metadata(alice_audio.pk)

        self.assertEqual(self.bytes_of(bob_audio), bob_bytes_before)
        bob_audio.refresh_from_db()
        self.assertEqual(bob_audio.file_path, SHARED_PATH)
        alice_audio.refresh_from_db()
        self.assertEqual(alice_audio.file_path, f'users/{self.alice.pk}/{YOUTUBE_ID}.wav')
        self.assertEqual(self.tags_of(alice_audio).get('title'), 'Alice Title')

    def test_metadata_view_edits_a_private_copy(self):
        alice_audio, bob_audio = self.shared_pair()
        bob_bytes_before = self.bytes_of(bob_audio)
        client = APIClient()
        client.force_authenticate(self.alice)
        response = client.post(
            f'/api/audio/{YOUTUBE_ID}/metadata/apply/', {'title': 'Edited', 'source': 'manual'}, format='json'
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.bytes_of(bob_audio), bob_bytes_before)
        alice_audio.refresh_from_db()
        self.assertNotEqual(alice_audio.file_path, SHARED_PATH)

    def test_a_file_nobody_else_uses_is_edited_in_place(self):
        write_wav(self.media_root / SHARED_PATH)
        audio = make_audio(self.alice)
        update_id3_tags_from_metadata(audio.pk)
        audio.refresh_from_db()
        self.assertEqual(audio.file_path, SHARED_PATH)

    def test_failed_copy_leaves_the_row_and_refuses_the_edit(self):
        alice_audio, bob_audio = self.shared_pair()
        bob_bytes_before = self.bytes_of(bob_audio)
        with mock.patch('audio.storage_service.filecmp.cmp', return_value=False), \
                mock.patch('audio.tasks_artwork.ID3TagService') as tag_service:
            update_id3_tags_from_metadata(alice_audio.pk)
        tag_service.assert_not_called()
        alice_audio.refresh_from_db()
        self.assertEqual(alice_audio.file_path, SHARED_PATH)
        self.assertEqual(self.bytes_of(bob_audio), bob_bytes_before)
        self.assertEqual(list((self.media_root / 'users').rglob('*.copying')), [])

    def test_missing_shared_file_cannot_be_made_private(self):
        alice_audio, _ = self.shared_pair()
        (self.media_root / SHARED_PATH).unlink()
        self.assertFalse(ensure_private_file(alice_audio))
        alice_audio.refresh_from_db()
        self.assertEqual(alice_audio.file_path, SHARED_PATH)

    def test_row_changed_during_the_copy_keeps_the_newer_value(self):
        alice_audio, _ = self.shared_pair()
        real_copy = shutil.copyfile

        def repaired_meanwhile(source, target):
            Audio.objects.filter(pk=alice_audio.pk).update(file_path='users/repaired.wav')
            return real_copy(source, target)

        with mock.patch('audio.storage_service.shutil.copyfile', repaired_meanwhile):
            self.assertFalse(ensure_private_file(alice_audio))
        self.assertEqual(alice_audio.file_path, 'users/repaired.wav')


class DeleteTests(MediaLifecycleTestCase):
    def test_deleting_one_owner_keeps_the_other_and_the_last_removes_the_file(self):
        alice_audio, bob_audio = self.shared_pair()
        with self.captureOnCommitCallbacks(execute=True):
            alice_audio.delete()
        self.assertTrue((self.media_root / SHARED_PATH).exists())
        with self.captureOnCommitCallbacks(execute=True):
            bob_audio.delete()
        self.assertFalse((self.media_root / SHARED_PATH).exists())

    def test_failed_transaction_removes_no_live_bytes(self):
        alice_audio = make_audio(self.alice, file_path='only.wav')
        write_wav(self.media_root / 'only.wav')

        class Abort(Exception):
            pass

        with self.captureOnCommitCallbacks(execute=True):
            with self.assertRaises(Abort), transaction.atomic():
                alice_audio.delete()
                raise Abort
        self.assertTrue((self.media_root / 'only.wav').exists())

    def test_a_stored_path_outside_the_root_is_never_deleted(self):
        outside = self.media_root.parent / f'{self.media_root.name}-outside.wav'
        write_wav(outside)
        self.addCleanup(outside.unlink, missing_ok=True)
        audio = make_audio(self.alice, file_path=f'../{outside.name}')
        with self.captureOnCommitCallbacks(execute=True):
            audio.delete()
        self.assertTrue(outside.exists())

    def test_remove_reports_only_bytes_it_removed(self):
        self.assertFalse(remove_if_unreferenced('never-existed.wav'))

    def test_admin_delete_removes_the_owners_folder_and_keeps_shared_bytes(self):
        write_wav(self.media_root / SHARED_PATH)
        private = f'users/{self.alice.pk}/PRIVATE.wav'
        write_wav(self.media_root / private)
        make_audio(self.alice)
        make_audio(self.alice, file_path=private, youtube_id='PRIVATE')
        make_audio(self.bob)
        admin = Account.objects.create_superuser('admin_life', 'admin_life@test.local', 'Adminpw_2026!')
        client = APIClient()
        client.force_authenticate(admin)
        response = client.delete(f'/api/user/admin/users/{self.alice.pk}/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['files_deleted'], 1)
        self.assertFalse((self.media_root / private).parent.exists())
        self.assertTrue((self.media_root / SHARED_PATH).exists())


class RepairAndCancelTests(MediaLifecycleTestCase):
    INFO = {'id': YOUTUBE_ID, 'title': 'T', 'filesize': 10, 'channel': 'Channel'}

    def queue_row(self):
        return DownloadQueue.objects.create(owner=self.alice, url='https://www.youtube.com/watch?v=x', status='pending')

    def test_repair_keeps_identity_and_dependents_and_retires_the_old_private_file(self):
        write_wav(self.media_root / SHARED_PATH)
        audio = make_audio(self.alice)
        progress = AudioProgress.objects.create(user=self.alice, audio=audio, position=42)
        new_path = f'users/{self.alice.pk}/{YOUTUBE_ID}.opus'
        row = self.queue_row()
        DownloadQueue.objects.filter(pk=row.pk).update(status='downloading', claim_token='6d9c8a2e-0f3b-4f7e-8a11-2b6d9c8a2e0f')
        token = DownloadQueue.objects.get(pk=row.pk).claim_token
        with mock.patch('task.tasks.link_audio_to_playlists.delay'), self.captureOnCommitCallbacks(execute=True):
            self.assertTrue(_publish_download(row.pk, token, self.INFO, new_path, 'opus', 10))
        audio.refresh_from_db()
        self.assertEqual(audio.file_path, new_path)
        self.assertEqual(AudioProgress.objects.get(pk=progress.pk).audio_id, audio.pk)
        self.assertFalse((self.media_root / SHARED_PATH).exists())

    def test_repair_does_not_remove_a_file_another_owner_uses(self):
        write_wav(self.media_root / SHARED_PATH)
        make_audio(self.alice)
        make_audio(self.bob)
        row = self.queue_row()
        DownloadQueue.objects.filter(pk=row.pk).update(status='downloading', claim_token='6d9c8a2e-0f3b-4f7e-8a11-2b6d9c8a2e0f')
        token = DownloadQueue.objects.get(pk=row.pk).claim_token
        with mock.patch('task.tasks.link_audio_to_playlists.delay'), self.captureOnCommitCallbacks(execute=True):
            _publish_download(row.pk, token, self.INFO, f'users/{self.alice.pk}/{YOUTUBE_ID}.opus', 'opus', 10)
        self.assertTrue((self.media_root / SHARED_PATH).exists())

    def _download_with(self, during_download):
        class FakeYoutubeDL:
            def __init__(self, options):
                self.template = options['outtmpl']

            def __enter__(self):
                return self

            def __exit__(self, *exc_info):
                return False

            def extract_info(self, url, download=False):
                return {'id': YOUTUBE_ID, 'title': 'T', 'channel': 'C'}

            def process_ie_result(self, info, download=True):
                # The template the task really passed, so its location is what gets tested.
                path = Path(self.template % {'id': YOUTUBE_ID, 'ext': 'wav', 'channel': 'C', 'title': 'T'})
                write_wav(path)
                during_download()
                return {**info, 'requested_downloads': [{'filepath': str(path)}]}

        row = self.queue_row()
        with mock.patch('task.tasks.yt_dlp.YoutubeDL', FakeYoutubeDL), \
                mock.patch('common.url_security.check_public_http_url', return_value=(True, None)), \
                mock.patch('audio.storage_service.shutil.disk_usage', return_value=mock.Mock(free=10 ** 12)), \
                mock.patch('task.tasks._resolve_download_quality', return_value='opus'), \
                mock.patch('task.tasks._postprocessor_for_quality', return_value={}), \
                mock.patch('task.tasks.link_audio_to_playlists.delay'), \
                mock.patch('task.tasks.measure_loudness_task.delay'), \
                mock.patch('task.tasks.extract_features_task.delay'):
            download_audio_task(row.pk)
        return row

    def test_a_finished_download_lands_in_the_owners_folder(self):
        self._download_with(lambda: None)
        self.assertEqual(Audio.objects.get(owner=self.alice).file_path, f'users/{self.alice.pk}/{YOUTUBE_ID}.wav')

    def test_a_cancelled_download_leaves_no_bytes_behind(self):
        self._download_with(lambda: DownloadQueue.objects.all().delete())
        self.assertFalse(Audio.objects.exists())
        self.assertFalse((self.media_root / f'users/{self.alice.pk}/{YOUTUBE_ID}.wav').exists())


class MigrationCommandTests(MediaLifecycleTestCase):
    DISK_USAGE = 'audio.management.commands.migrate_media_paths.shutil.disk_usage'

    def setUp(self):
        super().setUp()
        # The temp folder's real free space is not what these tests are about.
        plenty_of_space = mock.patch(self.DISK_USAGE, return_value=mock.Mock(free=10 ** 12))
        plenty_of_space.start()
        self.addCleanup(plenty_of_space.stop)

    def run_command(self, *args):
        out = StringIO()
        call_command(COMMAND, *args, stdout=out, stderr=out)
        return out.getvalue()

    def journal_rows(self):
        path = self.media_root / 'data' / 'media_migration_journal.jsonl'
        return [json.loads(line) for line in path.read_text().splitlines()]

    def three_owners(self):
        carol = Account.objects.create_user('carol_life', 'carol_life@test.local', 'Carolpw_2026!')
        write_wav(self.media_root / SHARED_PATH)
        return make_audio(self.alice), make_audio(self.bob), make_audio(carol)

    def test_dry_run_changes_nothing(self):
        rows = self.three_owners()
        output = self.run_command()
        self.assertIn('Dry run', output)
        self.assertIn('1 shared file(s) across 3 row(s)', output)
        for audio in rows:
            audio.refresh_from_db()
            self.assertEqual(audio.file_path, SHARED_PATH)
        self.assertFalse((self.media_root / 'users').exists())

    def test_apply_separates_owners_and_never_touches_the_original(self):
        rows = self.three_owners()
        original = (self.media_root / SHARED_PATH).read_bytes()
        self.run_command('--apply')
        paths = []
        for audio in rows:
            audio.refresh_from_db()
            paths.append(audio.file_path)
            self.assertEqual((self.media_root / audio.file_path).read_bytes(), original)
        self.assertEqual(len(set(paths)), 3)
        self.assertEqual(paths[-1], SHARED_PATH, 'the last owner keeps the original')
        self.assertEqual((self.media_root / SHARED_PATH).read_bytes(), original)
        self.assertEqual([row['previous_path'] for row in self.journal_rows()], [SHARED_PATH, SHARED_PATH])

    def test_batches_resume_and_a_finished_run_is_a_no_op(self):
        self.three_owners()
        self.run_command('--apply', '--limit', '1')
        self.assertEqual(Audio.objects.filter(file_path=SHARED_PATH).count(), 2)
        self.run_command('--apply', '--limit', '1')
        self.assertEqual(Audio.objects.filter(file_path=SHARED_PATH).count(), 1)
        output = self.run_command('--apply')
        self.assertIn('0 shared file(s)', output)
        self.assertEqual(len(self.journal_rows()), 2)

    def test_owners_stream_their_own_path_after_migrating(self):
        alice_audio, _, _ = self.three_owners()
        self.run_command('--apply')
        alice_audio.refresh_from_db()
        client = APIClient()
        client.force_authenticate(self.alice)
        with mock.patch('audio.tasks_lyrics.fetch_lyrics_for_audio.delay'):
            player = client.get(f'/api/audio/{YOUTUBE_ID}/player/').json()
        self.assertIn(f'/media/users/{self.alice.pk}/', player['stream_url'])

    def test_missing_source_is_reported_and_skipped(self):
        self.three_owners()
        (self.media_root / SHARED_PATH).unlink()
        output = self.run_command('--apply')
        self.assertIn('1 missing on disk', output)
        self.assertEqual(Audio.objects.filter(file_path=SHARED_PATH).count(), 3)

    def test_refuses_to_start_without_enough_free_space(self):
        self.three_owners()
        with mock.patch(self.DISK_USAGE, return_value=mock.Mock(free=1)):
            output = self.run_command('--apply')
        self.assertIn('Not enough free space', output)
        self.assertEqual(Audio.objects.filter(file_path=SHARED_PATH).count(), 3)
