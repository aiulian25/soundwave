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
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from user.models import Account
from audio.export import ExportedTrack
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
    return ExportedTrack(written)


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


class PlaylistDeleteKeepsMediaTests(TestCase):
    """SW-002: removing a list is not removing its tracks."""

    def setUp(self):
        self.alice = Account.objects.create_user('alice_keep', 'alice_keep@test.local', 'Alicepw_2026!')
        self.audio = _make_audio(self.alice, 'KEEP_YT_0001', 'Shared Track')
        self.first = Playlist.objects.create(owner=self.alice, playlist_id='PL_first', title='First')
        self.second = Playlist.objects.create(owner=self.alice, playlist_id='PL_second', title='Second')
        PlaylistItem.objects.create(playlist=self.first, audio=self.audio, position=0)
        PlaylistItem.objects.create(playlist=self.second, audio=self.audio, position=0)
        self.client = APIClient()
        self.client.force_authenticate(user=self.alice)

    def test_common_track_survives_in_library_and_other_list(self):
        with mock.patch('pathlib.Path.unlink') as unlink, self.captureOnCommitCallbacks(execute=True):
            response = self.client.delete('/api/playlist/PL_first/')
        self.assertEqual(response.status_code, 200)
        unlink.assert_not_called()
        self.assertFalse(Playlist.objects.filter(pk=self.first.pk).exists())
        self.assertFalse(PlaylistItem.objects.filter(playlist_id=self.first.pk).exists())
        self.assertTrue(Audio.objects.filter(pk=self.audio.pk).exists())
        self.assertTrue(PlaylistItem.objects.filter(playlist=self.second, audio=self.audio).exists())

    def test_other_owner_cannot_delete(self):
        bob = Account.objects.create_user('bob_keep', 'bob_keep@test.local', 'Bobpw_2026!')
        client = APIClient()
        client.force_authenticate(user=bob)
        self.assertEqual(client.delete('/api/playlist/PL_first/').status_code, 404)
        self.assertTrue(Playlist.objects.filter(pk=self.first.pk).exists())


class PlaylistItemPagesTests(TestCase):
    """A big playlist used to arrive as one response: seconds of work and megabytes (SW-116)."""

    TRACKS = 120
    MAX_QUERIES_PER_PAGE = 5
    ITEMS_URL = '/api/playlist/PL_PAGES/items/'
    DETAIL_URL = '/api/playlist/PL_PAGES/'

    @classmethod
    def setUpTestData(cls):
        cls.owner = Account.objects.create_user('pages_u', 'pages_u@test.local', 'Pagespw_2026!')
        cls.playlist = Playlist.objects.create(owner=cls.owner, playlist_id='PL_PAGES', title='Long', playlist_type='custom')
        PlaylistItem.objects.bulk_create(
            PlaylistItem(
                playlist=cls.playlist,
                audio=_make_audio(cls.owner, f'PAGE_{number:04d}', f'Track {number}'),
                # Stored out of order, so the test shows the playlist's own order is what is served.
                position=cls.TRACKS - number,
            )
            for number in range(cls.TRACKS)
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def _page(self, page):
        return self.client.get(self.ITEMS_URL, {'page': page})

    def test_items_arrive_a_page_at_a_time_in_playlist_order(self):
        first = self._page(1).json()

        self.assertEqual(first['count'], self.TRACKS)
        self.assertEqual(len(first['data']), first['page_size'])
        self.assertLess(first['page_size'], self.TRACKS)
        self.assertEqual(first['next'], 2)
        self.assertEqual([item['position'] for item in first['data']], list(range(1, first['page_size'] + 1)))
        self.assertEqual(first['data'][0]['audio']['youtube_id'], f'PAGE_{self.TRACKS - 1:04d}')

    def test_following_next_reaches_every_item_exactly_once(self):
        seen, page = [], 1
        while page is not None:
            body = self._page(page).json()
            seen.extend(item['audio']['youtube_id'] for item in body['data'])
            page = body['next']

        self.assertEqual(len(seen), self.TRACKS)
        self.assertEqual(len(set(seen)), self.TRACKS)

    def test_a_page_is_a_few_queries_not_one_per_track(self):
        with CaptureQueriesContext(connection) as queries:
            self._page(2)

        self.assertLessEqual(len(queries), self.MAX_QUERIES_PER_PAGE)

    def test_the_playlist_itself_no_longer_carries_its_items(self):
        self.assertNotIn('items', self.client.get(self.DETAIL_URL).json())

    def test_an_older_app_still_gets_items_but_a_bounded_number(self):
        from playlist.views import LEGACY_INCLUDED_ITEMS_LIMIT

        body = self.client.get(self.DETAIL_URL, {'include_items': 'true'}).json()

        self.assertEqual(len(body['items']), min(self.TRACKS, LEGACY_INCLUDED_ITEMS_LIMIT))
        self.assertLess(LEGACY_INCLUDED_ITEMS_LIMIT, self.TRACKS)

    def test_another_users_playlist_has_no_pages(self):
        stranger = APIClient()
        stranger.force_authenticate(Account.objects.create_user('pages_v', 'pages_v@test.local', 'Pagespw_2026!'))

        self.assertEqual(stranger.get(self.ITEMS_URL).status_code, 404)

    def test_a_page_that_is_not_a_number_is_refused(self):
        self.assertEqual(self._page('many').status_code, 400)
