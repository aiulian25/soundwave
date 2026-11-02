"""SW-025: every artwork fetch goes through the bounded helper and keeps only real images.

Run: python manage.py test audio.tests.test_artwork_fetch --settings=config.settings_test
"""
import shutil
import tempfile
from io import BytesIO
from pathlib import Path
from unittest import mock

import requests
from celery.exceptions import Retry
from django.test import TestCase, override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from audio.export import _fetch_cover_art
from audio.models import Audio
from audio.models_artwork import Artwork
from audio.tag_writer import download_cover_art
from audio.tasks_artwork import download_artwork
from common.tests.test_safe_http import fake_network, image_response, redirect_to
from user.models import Account

COVER_URL = 'https://coverartarchive.org/release/synthetic/front'
PUBLIC_STORAGE_URL = 'https://ia800.us.archive.org/cover.png'
PRIVATE_URL = 'http://10.0.0.5/secret'
EMBED_DELAY = 'audio.tasks_artwork.embed_artwork_in_audio.delay'


def fake_getaddrinfo(host, port, **kwargs):
    return [(2, 1, 6, '', ('8.8.8.8', port))]


def png_bytes():
    buffer = BytesIO()
    Image.new('RGB', (2, 2), 'red').save(buffer, format='PNG')
    return buffer.getvalue()


class public_network(fake_network):
    def __init__(self, routes):
        super().__init__(routes)
        self.patches[1] = mock.patch('common.url_security.socket.getaddrinfo', fake_getaddrinfo)


class ArtworkFetchTestCase(TestCase):
    def setUp(self):
        self.media_root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.media_root)
        settings_override = override_settings(MEDIA_ROOT=str(self.media_root))
        settings_override.enable()
        self.addCleanup(settings_override.disable)
        self.owner = Account.objects.create_user('fetch_u', 'fetch_u@test.local', 'Fetchpw_2026!')
        self.audio = Audio.objects.create(
            owner=self.owner, youtube_id='FETCH_YT_01', title='T', channel_id='UC', channel_name='C',
            duration=1, file_path='t.m4a', file_size=1, published_date=timezone.now(), thumbnail_url=COVER_URL,
        )
        self.artwork = Artwork.objects.create(
            audio=self.audio, artwork_type='audio_cover', source='manual', url=COVER_URL
        )

    def stored_files(self):
        return list(self.media_root.glob('artwork/*'))


class DownloadArtworkTaskTests(ArtworkFetchTestCase):
    def test_redirected_image_is_saved_under_its_real_type_and_embedded(self):
        routes = {
            COVER_URL: redirect_to(PUBLIC_STORAGE_URL),
            PUBLIC_STORAGE_URL: (200, {'content-type': 'image/jpeg'}, png_bytes()),
        }
        with public_network(routes), mock.patch(EMBED_DELAY) as embed:
            download_artwork(self.artwork.pk)
        self.artwork.refresh_from_db()
        self.assertTrue(self.artwork.local_path.endswith('.png'))
        self.assertEqual((self.media_root / self.artwork.local_path).read_bytes(), png_bytes())
        embed.assert_called_once_with(self.audio.pk, self.artwork.pk)

    def test_redirect_to_private_address_saves_nothing(self):
        with public_network({COVER_URL: redirect_to(PRIVATE_URL)}) as transport, mock.patch(EMBED_DELAY) as embed:
            download_artwork(self.artwork.pk)
        self.assertEqual(transport.requested, [COVER_URL])
        self.assertEqual(self.stored_files(), [])
        embed.assert_not_called()

    def test_non_image_is_never_written_to_disk(self):
        with public_network({COVER_URL: image_response(b'<html>not an image</html>')}), \
                mock.patch(EMBED_DELAY) as embed:
            download_artwork(self.artwork.pk)
        self.assertEqual(self.stored_files(), [])
        self.artwork.refresh_from_db()
        self.assertEqual(self.artwork.local_path, '')
        embed.assert_not_called()

    def test_network_failure_is_still_retried(self):
        failing = mock.patch('audio.tasks_artwork.fetch_public_url', side_effect=requests.ConnectionError('synthetic'))
        with failing, mock.patch.object(download_artwork, 'retry', side_effect=Retry()) as retry:
            with self.assertRaises(Retry):
                download_artwork(self.artwork.pk)
        retry.assert_called_once()


class EmbeddingFetchTests(ArtworkFetchTestCase):
    def fetchers(self):
        return {
            'export': lambda: _fetch_cover_art(self.audio, COVER_URL),
            'tag writer': lambda: download_cover_art(COVER_URL),
        }

    def test_valid_image_through_public_redirect_is_returned(self):
        routes = {COVER_URL: redirect_to(PUBLIC_STORAGE_URL), PUBLIC_STORAGE_URL: image_response(png_bytes())}
        for label, fetch in self.fetchers().items():
            with self.subTest(label), public_network(routes):
                self.assertEqual(fetch(), png_bytes())

    def test_redirect_to_private_address_returns_nothing(self):
        for label, fetch in self.fetchers().items():
            with self.subTest(label), public_network({COVER_URL: redirect_to(PRIVATE_URL)}) as transport:
                self.assertIsNone(fetch())
                self.assertEqual(transport.requested, [COVER_URL])

    def test_non_image_returns_nothing(self):
        for label, fetch in self.fetchers().items():
            with self.subTest(label), public_network({COVER_URL: image_response(b'not an image')}):
                self.assertIsNone(fetch())

    def test_host_allow_list_still_applies_first(self):
        with public_network({}) as transport:
            self.assertIsNone(_fetch_cover_art(self.audio, 'https://evil.example.test/a.png'))
            self.assertIsNone(download_cover_art('https://evil.example.test/a.png'))
        self.assertEqual(transport.requested, [])


class ArtworkProxyRedirectTests(ArtworkFetchTestCase):
    def test_proxy_refuses_redirect_to_private_address(self):
        client = APIClient()
        client.force_authenticate(self.owner)
        with public_network({COVER_URL: redirect_to(PRIVATE_URL)}) as transport:
            response = client.get('/api/audio/FETCH_YT_01/artwork/')
        self.assertEqual(response.status_code, 502)
        self.assertEqual(transport.requested, [COVER_URL])
