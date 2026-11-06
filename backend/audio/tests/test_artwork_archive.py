"""Downloaded tracks keep their artwork on this server: fetched once, then never asked for again.

Run: python manage.py test audio.tests.test_artwork_archive --settings=config.settings_test
"""
import io
import shutil
import tempfile
from pathlib import Path
from unittest import mock

import requests
from django.test import TestCase, override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from audio.artwork_archive import archive_track_artwork
from audio.export import _fetch_cover_art
from audio.models import Audio
from audio.models_artwork import Artwork
from audio.tasks_artwork import archive_missing_artwork
from common.safe_http import FetchedResponse, FetchRefused, REFUSED_UPSTREAM_STATUS
from user.models import Account

FETCH = 'audio.artwork_archive.fetch_public_url'
NO_PAUSE = mock.patch('audio.tasks_artwork.ARCHIVE_PAUSE_SECONDS', 0)
THUMBNAIL_LINK = 'https://i.ytimg.com/vi/KEEP_ART_01/hqdefault.jpg'
COVER_LINK = 'https://coverartarchive.org/release/abc/front-250'
PASSWORD = 'Keepart_2026!'
NOT_FOUND = 404
SERVICE_UNAVAILABLE = 503


def _image_bytes(colour, image_format='JPEG'):
    buffer = io.BytesIO()
    Image.new('RGB', (4, 4), colour).save(buffer, format=image_format)
    return buffer.getvalue()


THUMBNAIL_IMAGE = _image_bytes('red')
COVER_IMAGE = _image_bytes('blue', 'PNG')


def _served(image_data):
    return FetchedResponse(image_data, 'image/jpeg')


def _gone():
    return FetchRefused(REFUSED_UPSTREAM_STATUS, NOT_FOUND)


class ArchiveCase(TestCase):
    def setUp(self):
        media_root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, media_root)
        override = override_settings(MEDIA_ROOT=str(media_root))
        override.enable()
        self.addCleanup(override.disable)
        self.media_root = media_root
        self.owner = Account.objects.create_user('keep_art', 'keep_art@test.local', PASSWORD)
        self.audio = self._track('KEEP_ART_01')
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def _track(self, youtube_id, **fields):
        return Audio.objects.create(
            owner=self.owner, youtube_id=youtube_id, title='Track', channel_id='UC_keep',
            channel_name='Channel', duration=60, file_path=f'users/{self.owner.id}/{youtube_id}.m4a',
            file_size=1, published_date=timezone.now(), thumbnail_url=THUMBNAIL_LINK, **fields,
        )

    def _artwork_response(self, audio=None):
        return self.client.get(f'/api/audio/{(audio or self.audio).youtube_id}/artwork/')


class KeptOnceTests(ArchiveCase):
    def test_artwork_is_kept_the_first_time_and_served_from_disk_after(self):
        with mock.patch(FETCH, return_value=_served(THUMBNAIL_IMAGE)) as fetch:
            first = self._artwork_response()
        with mock.patch(FETCH, side_effect=_gone()) as fetch_after_removal:
            second = self._artwork_response()

        self.assertEqual(fetch.call_count, 1)
        fetch_after_removal.assert_not_called()
        for response in (first, second):
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response['Content-Type'], 'image/jpeg')
            self.assertEqual(response.content, THUMBNAIL_IMAGE)
            self.assertTrue(response['Cache-Control'].startswith('private'))

    def test_an_image_youtube_no_longer_has_is_not_asked_for_again(self):
        with mock.patch(FETCH, side_effect=_gone()) as fetch:
            first = self._artwork_response()
            second = self._artwork_response()

        self.assertEqual((first.status_code, second.status_code), (404, 404))
        self.assertEqual(fetch.call_count, 1)

    def test_a_temporary_failure_is_tried_again_later(self):
        temporary_failures = (
            FetchRefused(REFUSED_UPSTREAM_STATUS, SERVICE_UNAVAILABLE),
            requests.ConnectionError('synthetic'),
            FetchRefused('too_large'),
        )
        for failure in temporary_failures:
            with self.subTest(failure=failure), mock.patch(FETCH, side_effect=failure):
                self.assertEqual(self._artwork_response().status_code, 404)

        with mock.patch(FETCH, return_value=_served(THUMBNAIL_IMAGE)):
            self.assertEqual(self._artwork_response().status_code, 200)

    def test_something_that_is_not_an_image_is_never_kept(self):
        with mock.patch(FETCH, return_value=FetchedResponse(b'<html>not an image</html>', 'text/html')):
            response = self._artwork_response()

        self.assertEqual(response.status_code, 404)
        self.assertFalse(Artwork.objects.exclude(local_path='').exists())

    def test_a_full_disk_does_not_break_the_caller(self):
        with mock.patch(FETCH, return_value=_served(THUMBNAIL_IMAGE)), \
                mock.patch('audio.artwork_archive._write_image', side_effect=OSError('No space left')):
            self.assertIsNone(archive_track_artwork(self.audio))


class CoverArtTests(ArchiveCase):
    def _fetch_by_link(self, link, *arguments):
        return _served(COVER_IMAGE if link.startswith('https://coverartarchive.org') else THUMBNAIL_IMAGE)

    def test_cover_art_is_kept_too_and_preferred_over_the_thumbnail(self):
        Audio.objects.filter(pk=self.audio.pk).update(cover_art_url=COVER_LINK)

        with mock.patch(FETCH, side_effect=self._fetch_by_link):
            response = self._artwork_response()

        self.assertEqual(response.content, COVER_IMAGE)
        self.assertEqual(response['Content-Type'], 'image/png')
        self.assertEqual(Artwork.objects.exclude(local_path='').count(), 2)

    def test_a_new_cover_link_replaces_the_kept_cover(self):
        Audio.objects.filter(pk=self.audio.pk).update(cover_art_url=COVER_LINK)
        with mock.patch(FETCH, side_effect=self._fetch_by_link):
            self._artwork_response()

        replacement = _image_bytes('green', 'PNG')
        Audio.objects.filter(pk=self.audio.pk).update(cover_art_url=f'{COVER_LINK}-new')
        with mock.patch(FETCH, return_value=FetchedResponse(replacement, 'image/png')):
            response = self._artwork_response()

        self.assertEqual(response.content, replacement)
        self.assertEqual(Artwork.objects.filter(artwork_type='audio_cover').count(), 1)


class ClientsNeverLoadTheOriginalTests(ArchiveCase):
    def test_track_lists_point_at_this_server(self):
        self._track('KEEP_ART_02', cover_art_url=COVER_LINK)

        response = self.client.get('/api/audio/list/')

        self.assertEqual(response.status_code, 200)
        self.assertNotIn('ytimg', response.content.decode())
        self.assertNotIn('coverartarchive', response.content.decode())
        tracks = {track['youtube_id']: track for track in response.json()['data']}
        self.assertEqual(tracks['KEEP_ART_01']['thumbnail_url'], '/api/audio/KEEP_ART_01/artwork/')
        self.assertEqual(tracks['KEEP_ART_01']['cover_art_url'], '')
        self.assertEqual(tracks['KEEP_ART_02']['cover_art_url'], '/api/audio/KEEP_ART_02/artwork/')

    def test_a_signed_in_browser_can_load_the_artwork(self):
        browser = APIClient()
        browser.login(username='keep_art', password=PASSWORD)

        with mock.patch(FETCH, return_value=_served(THUMBNAIL_IMAGE)):
            response = browser.get(f'/api/audio/{self.audio.youtube_id}/artwork/')

        self.assertEqual(response.status_code, 200)

    def test_exports_embed_the_kept_copy(self):
        with mock.patch(FETCH, return_value=_served(THUMBNAIL_IMAGE)):
            archive_track_artwork(self.audio)

        with mock.patch(FETCH, side_effect=_gone()) as fetch:
            embedded = _fetch_cover_art(self.audio, '')

        self.assertEqual(embedded, THUMBNAIL_IMAGE)
        fetch.assert_not_called()


class BackfillTests(ArchiveCase):
    def test_tracks_without_kept_artwork_are_filled_in_a_batch_at_a_time(self):
        for number in range(2, 5):
            self._track(f'KEEP_ART_0{number}')

        with NO_PAUSE, mock.patch(FETCH, return_value=_served(THUMBNAIL_IMAGE)) as fetch:
            archive_missing_artwork(limit=2)
            archive_missing_artwork(limit=2)

        self.assertEqual(fetch.call_count, 4)
        self.assertEqual(Artwork.objects.exclude(local_path='').count(), 4)

    def test_tracks_youtube_no_longer_has_are_not_retried(self):
        with NO_PAUSE, mock.patch(FETCH, side_effect=_gone()) as fetch:
            archive_missing_artwork()
            archive_missing_artwork()

        self.assertEqual(fetch.call_count, 1)

    def test_tracks_that_were_never_downloaded_are_left_alone(self):
        Audio.objects.filter(pk=self.audio.pk).update(file_path='')

        with NO_PAUSE, mock.patch(FETCH) as fetch:
            archive_missing_artwork()

        fetch.assert_not_called()
