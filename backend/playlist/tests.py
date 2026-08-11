"""F13 — playlist ZIP export endpoint.

Verifies the acceptance contract: N downloaded items -> ZIP with N files; an empty
playlist returns a friendly 400 (not a 500); owner-scoping; and unique arcnames.
export_track_to_file is mocked to write a dummy file so tests don't need ffmpeg.

Run: python manage.py test playlist --settings=config.settings_test
"""
import zipfile
from io import BytesIO
from pathlib import Path
from unittest import mock

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from user.models import Account
from audio.models import Audio
from playlist.models import Playlist, PlaylistItem


def _make_audio(owner, youtube_id, title, file_path='Channel/track.m4a'):
    return Audio.objects.create(
        owner=owner, youtube_id=youtube_id, title=title, channel_id='UC_test',
        channel_name='Channel', duration=10, file_path=file_path, file_size=1000,
        published_date=timezone.now(),
    )


def _fake_export(audio, target_format, quality, output_dir, *,
                 embed_lyrics=True, embed_artwork=True, artwork_url='', filename=None):
    written = Path(output_dir) / filename
    written.write_bytes(b'FAKE_AUDIO_' + (audio.youtube_id or '').encode())
    return written


class PlaylistExportTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.alice = Account.objects.create_user('alice_pl', 'alice_pl@test.local', 'Alicepw_2026!')
        cls.bob = Account.objects.create_user('bob_pl', 'bob_pl@test.local', 'Bobpw_2026!')

    def setUp(self):
        cache.clear()  # isolate the per-user export lock between tests
        self.playlist = Playlist.objects.create(owner=self.alice, playlist_id='PL_alice', title='My Mix')
        self.client = APIClient()
        self.client.force_authenticate(user=self.alice)

    def _add(self, audio, position):
        PlaylistItem.objects.create(playlist=self.playlist, audio=audio, position=position)

    def _url(self, playlist_id='PL_alice'):
        return f'/api/playlist/{playlist_id}/export/'

    def _zip_names(self, response):
        data = b''.join(response.streaming_content)
        with zipfile.ZipFile(BytesIO(data)) as archive:
            return sorted(archive.namelist())

    def test_empty_playlist_returns_400_not_500(self):
        resp = self.client.post(self._url(), {'format': 'mp3'}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('error', resp.json())

    def test_items_without_downloaded_file_are_treated_as_empty(self):
        self._add(_make_audio(self.alice, 'YT_nofile', 'No File', file_path=''), 0)
        resp = self.client.post(self._url(), {'format': 'mp3'}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_export_yields_zip_with_one_file_per_track(self):
        self._add(_make_audio(self.alice, 'YT_a', 'Track A'), 0)
        self._add(_make_audio(self.alice, 'YT_b', 'Track B'), 1)
        with mock.patch('audio.export.export_track_to_file', side_effect=_fake_export):
            resp = self.client.post(self._url(), {'format': 'mp3'}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp['Content-Type'], 'application/zip')
        self.assertEqual(self._zip_names(resp), ['Track A.mp3', 'Track B.mp3'])

    def test_duplicate_titles_get_unique_arcnames(self):
        self._add(_make_audio(self.alice, 'YT_a', 'Same'), 0)
        self._add(_make_audio(self.alice, 'YT_b', 'Same'), 1)
        with mock.patch('audio.export.export_track_to_file', side_effect=_fake_export):
            resp = self.client.post(self._url(), {'format': 'mp3'}, format='json')
        self.assertEqual(self._zip_names(resp), ['Same (2).mp3', 'Same.mp3'])

    def test_invalid_format_returns_400(self):
        self._add(_make_audio(self.alice, 'YT_a', 'Track A'), 0)
        resp = self.client.post(self._url(), {'format': 'wav'}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_cross_owner_is_404(self):
        self._add(_make_audio(self.alice, 'YT_a', 'Track A'), 0)
        self.client.force_authenticate(user=self.bob)
        with mock.patch('audio.export.export_track_to_file', side_effect=_fake_export):
            resp = self.client.post(self._url(), {'format': 'mp3'}, format='json')
        self.assertEqual(resp.status_code, 404)

    def test_over_cap_returns_400(self):
        self._add(_make_audio(self.alice, 'YT_a', 'Track A'), 0)
        self._add(_make_audio(self.alice, 'YT_b', 'Track B'), 1)
        with mock.patch('playlist.views.MAX_EXPORT_TRACKS', 1):
            resp = self.client.post(self._url(), {'format': 'mp3'}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_export_already_in_progress_returns_429(self):
        self._add(_make_audio(self.alice, 'YT_a', 'Track A'), 0)
        cache.add(f'playlist_export_lock:{self.alice.id}', True, 900)
        with mock.patch('audio.export.export_track_to_file', side_effect=_fake_export):
            resp = self.client.post(self._url(), {'format': 'mp3'}, format='json')
        self.assertEqual(resp.status_code, 429)
