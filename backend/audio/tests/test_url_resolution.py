"""SW-009: every concrete namespace reaches its own view, and ordinary track IDs still do.

Run: python manage.py test audio.tests.test_url_resolution --settings=config.settings_test
"""
import shutil
import tempfile
from io import BytesIO
import wave
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, TestCase, override_settings
from django.urls import resolve
from django.utils import timezone
from rest_framework.test import APIClient

from audio.models import Audio
from audio.models_artwork import Artwork
from audio.models_local import LocalAudio, LocalAudioPlaylist
from audio.models_lyrics import Lyrics
from audio.storage_service import IngestionRefused, RESERVED_AUDIO_IDS, refuse_unsuitable_source
from audio.urls import urlpatterns
from audio.views import AudioDetailView, AudioListView, AudioPlayerView, ArtworkProxyView
from audio.views_artwork import ArtworkViewSet, AudioArtworkViewSet, MusicMetadataViewSet
from audio.views_local import LocalAudioPlaylistViewSet, LocalAudioViewSet
from audio.views_lyrics import LyricsCacheViewSet, LyricsViewSet
from audio.views_quick_sync import QuickSyncStatusView
from user.models import Account

API_ROOTS = ('/api/audio', '/api/v1/audio')
ORDINARY_ID = 'dQw4w9WgXcQ'
ID_WITH_PUNCTUATION = 'a-b_c-d_e-f'
CONCRETE_ROUTES = {
    'list/': AudioListView,
    'local-audio/': LocalAudioViewSet,
    'local-audio/5/': LocalAudioViewSet,
    'local-audio/stats/': LocalAudioViewSet,
    'local-playlists/': LocalAudioPlaylistViewSet,
    'local-playlists/5/': LocalAudioPlaylistViewSet,
    'lyrics/': LyricsViewSet,
    'lyrics/stats/': LyricsViewSet,
    'lyrics-cache/': LyricsCacheViewSet,
    'lyrics-cache/stats/': LyricsCacheViewSet,
    'quick-sync/status/': QuickSyncStatusView,
    'api/artwork/': ArtworkViewSet,
    'api/artwork/5/': ArtworkViewSet,
    'api/metadata/': MusicMetadataViewSet,
    'api/audio-artwork/5/': AudioArtworkViewSet,
}


def view_class(path):
    return resolve(path).func.cls if hasattr(resolve(path).func, 'cls') else resolve(path).func.view_class


class ResolutionTests(SimpleTestCase):
    def test_concrete_routes_reach_their_own_views(self):
        for root in API_ROOTS:
            for path, expected in CONCRETE_ROUTES.items():
                with self.subTest(f'{root}/{path}'):
                    self.assertIs(view_class(f'{root}/{path}'), expected)

    def test_ordinary_track_ids_still_resolve(self):
        for track_id in (ORDINARY_ID, ID_WITH_PUNCTUATION):
            routes = {
                f'{track_id}/': AudioDetailView,
                f'{track_id}/player/': AudioPlayerView,
                f'{track_id}/artwork/': ArtworkProxyView,
                f'{track_id}/lyrics/': LyricsViewSet,
            }
            for path, expected in routes.items():
                with self.subTest(path):
                    match = resolve(f'/api/audio/{path}')
                    self.assertIs(view_class(f'/api/audio/{path}'), expected)
                    self.assertEqual(match.kwargs['youtube_id'], track_id)

    def test_every_concrete_first_segment_is_reserved(self):
        literal_segments = {
            str(pattern.pattern).split('/')[0]
            for pattern in urlpatterns
            if str(pattern.pattern) and '<' not in str(pattern.pattern).split('/')[0]
        }
        router_prefixes = {'lyrics', 'lyrics-cache', 'local-audio', 'local-playlists', 'quick-sync'}
        self.assertLessEqual(literal_segments | router_prefixes, RESERVED_AUDIO_IDS)

    def test_a_source_with_a_reserved_id_is_refused(self):
        for reserved in RESERVED_AUDIO_IDS:
            with self.subTest(reserved), self.assertRaises(IngestionRefused):
                refuse_unsuitable_source({'id': reserved})

    def test_a_normal_source_id_is_accepted(self):
        refuse_unsuitable_source({'id': ORDINARY_ID})


def wav_upload():
    buffer = BytesIO()
    with wave.open(buffer, 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(8000)
        output.writeframes(bytes(1600))
    return SimpleUploadedFile('song.wav', buffer.getvalue(), content_type='audio/wav')


class CollectionBehaviourTests(TestCase):
    def setUp(self):
        media_root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, media_root)
        settings_override = override_settings(MEDIA_ROOT=media_root)
        settings_override.enable()
        self.addCleanup(settings_override.disable)
        self.alice = Account.objects.create_user('alice_route', 'alice_route@test.local', 'Alicepw_2026!')
        self.bob = Account.objects.create_user('bob_route', 'bob_route@test.local', 'Bobpw_2026!')
        self.alice_audio = self.make_audio(self.alice, 'ROUTE_ALICE')
        self.bob_audio = self.make_audio(self.bob, 'ROUTE_BOB01')
        self.alice_client = self.client_for(self.alice)
        self.bob_client = self.client_for(self.bob)

    @staticmethod
    def make_audio(owner, youtube_id):
        return Audio.objects.create(
            owner=owner, youtube_id=youtube_id, title='T', channel_id='UC', channel_name='C', duration=1,
            file_path=f'x/{youtube_id}.wav', file_size=1, published_date=timezone.now(),
        )

    @staticmethod
    def client_for(user):
        client = APIClient()
        client.force_authenticate(user)
        return client

    @staticmethod
    def rows(response):
        data = response.json()
        return data['results'] if isinstance(data, dict) else data

    def test_collections_require_authentication(self):
        for path in ('local-audio/', 'local-playlists/', 'lyrics/', 'lyrics-cache/', 'api/artwork/', 'api/'):
            with self.subTest(path):
                self.assertIn(APIClient().get(f'/api/audio/{path}').status_code, (401, 403))

    def test_local_upload_list_and_owner_scoping_over_http(self):
        created = self.alice_client.post('/api/audio/local-audio/', {'file': wav_upload(), 'title': 'Mine'}, format='multipart')
        self.assertEqual(created.status_code, 201, created.content)
        local = LocalAudio.objects.get(owner=self.alice)

        listed = self.alice_client.get('/api/audio/local-audio/')
        self.assertEqual([row['id'] for row in self.rows(listed)], [local.pk])
        self.assertEqual(self.rows(self.bob_client.get('/api/audio/local-audio/')), [])

        foreign_write = self.bob_client.patch(f'/api/audio/local-audio/{local.pk}/', {'title': 'Stolen'}, format='multipart')
        foreign_delete = self.bob_client.delete(f'/api/audio/local-audio/{local.pk}/')
        self.assertEqual((foreign_write.status_code, foreign_delete.status_code), (404, 404))
        local.refresh_from_db()
        self.assertEqual(local.title, 'Mine')

    def test_upload_over_quota_is_refused_over_http(self):
        Account.objects.filter(pk=self.alice.pk).update(storage_quota_gb=0)
        response = self.alice_client.post('/api/audio/local-audio/', {'file': wav_upload(), 'title': 'T'}, format='multipart')
        self.assertEqual(response.status_code, 403)
        self.assertFalse(LocalAudio.objects.exists())

    def test_upload_rejects_a_disallowed_file_type_over_http(self):
        bad = SimpleUploadedFile('tool.exe', b'x', content_type='application/octet-stream')
        response = self.alice_client.post('/api/audio/local-audio/', {'file': bad, 'title': 'T'}, format='multipart')
        self.assertEqual(response.status_code, 400)

    def test_local_playlists_over_http(self):
        created = self.alice_client.post('/api/audio/local-playlists/', {'title': 'Mine'}, format='json')
        self.assertEqual(created.status_code, 201, created.content)
        playlist = LocalAudioPlaylist.objects.get(owner=self.alice)
        self.assertEqual(self.rows(self.bob_client.get('/api/audio/local-playlists/')), [])
        self.assertEqual(self.bob_client.delete(f'/api/audio/local-playlists/{playlist.pk}/').status_code, 404)

        theirs = LocalAudio.objects.create(owner=self.bob, title='B', file='b.wav', file_size=1)
        foreign_item = self.alice_client.post(
            f'/api/audio/local-playlists/{playlist.pk}/add_item/', {'audio_id': theirs.pk}, format='json'
        )
        self.assertEqual(foreign_item.status_code, 404)

    def test_artwork_create_over_http_stays_within_the_requesters_library(self):
        body = {'artwork_type': 'audio_cover', 'source': 'manual', 'url': 'https://example.test/a.png'}
        created = self.alice_client.post(
            '/api/audio/api/artwork/', {**body, 'audio': self.alice_audio.pk, 'local_path': '/etc/passwd'}, format='json'
        )
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(Artwork.objects.get(audio=self.alice_audio).local_path, '')

        foreign = self.alice_client.post('/api/audio/api/artwork/', {**body, 'audio': self.bob_audio.pk}, format='json')
        self.assertEqual(foreign.status_code, 400)
        self.assertFalse(Artwork.objects.filter(audio=self.bob_audio).exists())

    def test_lyrics_list_is_owner_scoped(self):
        Lyrics.objects.create(audio=self.alice_audio, plain_lyrics='mine')
        Lyrics.objects.create(audio=self.bob_audio, plain_lyrics='theirs')
        listed = self.rows(self.alice_client.get('/api/audio/lyrics/'))
        self.assertEqual([row['audio_id'] for row in listed], ['ROUTE_ALICE'])

    def test_lyrics_cannot_be_created_at_the_collection(self):
        response = self.alice_client.post('/api/audio/lyrics/', {'plain_lyrics': 'x'}, format='json')
        self.assertEqual(response.status_code, 405)
        self.assertFalse(Lyrics.objects.exists())

    def test_lyrics_actions_on_the_collection_still_work(self):
        self.assertEqual(self.alice_client.get('/api/audio/lyrics/stats/').status_code, 200)
        with mock.patch('audio.views_lyrics.fetch_lyrics_batch.delay') as delay:
            response = self.alice_client.post('/api/audio/lyrics/fetch_batch/', {'youtube_ids': ['ROUTE_ALICE']}, format='json')
        self.assertEqual(response.status_code, 200)
        delay.assert_called_once()

    def test_lyrics_cache_is_read_only_for_regular_users(self):
        self.assertEqual(self.alice_client.get('/api/audio/lyrics-cache/').status_code, 200)
        self.assertEqual(self.alice_client.post('/api/audio/lyrics-cache/', {}, format='json').status_code, 405)

    def test_an_ordinary_track_is_still_served_and_still_private(self):
        self.assertEqual(self.alice_client.get('/api/audio/ROUTE_ALICE/').json()['youtube_id'], 'ROUTE_ALICE')
        self.assertEqual(self.bob_client.get('/api/audio/ROUTE_ALICE/').status_code, 404)
