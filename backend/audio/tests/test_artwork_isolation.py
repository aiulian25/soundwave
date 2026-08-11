"""Artwork / metadata ViewSet multi-tenant isolation regression tests.

Codifies CODE_REVIEW_REPORT findings:
  - #2: ArtworkViewSet / MusicMetadataViewSet / ArtistInfoViewSet queried .objects.all()
        and AudioArtworkViewSet looked up Audio by pk with no owner filter -> any user
        could read/update/delete another tenant's artwork & metadata (BOLA).
  - #4: ChannelArtworkViewSet referenced an unimported `Channel` -> NameError -> 500.
  - Coupled: ArtworkViewSet.get_queryset ordered by a non-existent `created_at` column
        -> FieldError -> 500 (now `fetched_date`).

Routes: audio.urls includes audio.urls_artwork under `api/`, so the ViewSets live at
`/api/audio/api/<basename>/` (e.g. /api/audio/api/artwork/).

Run: python manage.py test audio --settings=config.settings_test
"""
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from user.models import Account
from audio.models import Audio
from audio.models_artwork import Artwork, MusicMetadata
from channel.models import Channel


def _make_audio(owner, youtube_id, title):
    return Audio.objects.create(
        owner=owner,
        youtube_id=youtube_id,
        title=title,
        channel_id='UC_test',
        channel_name='Test Channel',
        duration=180,
        file_path=f'Test Channel/{title}-{youtube_id}.m4a',
        file_size=1024,
        published_date=timezone.now(),
    )


class ArtworkIsolationTests(TestCase):
    ALICE_ART_URL = 'https://assets.fanart.tv/alice-secret-cover.jpg'
    ALICE_ALBUM = 'ALICE_SECRET_ALBUM'

    @classmethod
    def setUpTestData(cls):
        cls.alice = Account.objects.create_user('alice', 'alice@test.local', 'Alicepw_2026!')
        cls.bob = Account.objects.create_user('bob', 'bob@test.local', 'Bobpw_2026!')

        cls.alice_audio = _make_audio(cls.alice, 'ART_ALICE_YT0', 'Alice Art Track')
        cls.alice_artwork = Artwork.objects.create(
            audio=cls.alice_audio,
            artwork_type='audio_cover',
            source='fanart',
            url=cls.ALICE_ART_URL,
            priority=10,
        )
        cls.alice_metadata = MusicMetadata.objects.create(
            audio=cls.alice_audio, album_name=cls.ALICE_ALBUM,
        )
        cls.alice_channel = Channel.objects.create(
            owner=cls.alice, channel_id='UC_ART_ALICE', channel_name='Alice Chan', subscribed=True,
        )

    def client_for(self, user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    # --- ArtworkViewSet: cross-tenant detail/delete must 404; owner can read -----
    # NOTE: the ArtworkViewSet *list* (/api/audio/api/artwork/) is deliberately not
    # tested — that exact path is shadowed by the `<youtube_id>/artwork/`
    # ArtworkProxyView route (resolves with youtube_id='api'), so the list is
    # unreachable and cannot leak. The reachable detail/delete routes are what Step 5's
    # owner-scoping actually protects.
    def test_bob_cannot_read_alice_artwork_detail(self):
        resp = self.client_for(self.bob).get(f'/api/audio/api/artwork/{self.alice_artwork.id}/')
        self.assertEqual(resp.status_code, 404)
        self.assertNotIn(self.ALICE_ART_URL, resp.content.decode())

    def test_bob_cannot_delete_alice_artwork(self):
        resp = self.client_for(self.bob).delete(f'/api/audio/api/artwork/{self.alice_artwork.id}/')
        self.assertEqual(resp.status_code, 404)
        self.assertTrue(Artwork.objects.filter(id=self.alice_artwork.id).exists())

    def test_owner_reads_own_artwork_detail(self):
        # Positive control + regression for the ArtworkViewSet order_by('-created_at')
        # FieldError: get_object evaluates the owner-scoped, ordered queryset, which
        # would 500 if the ordering field didn't exist (now fetched_date).
        resp = self.client_for(self.alice).get(f'/api/audio/api/artwork/{self.alice_artwork.id}/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn(self.ALICE_ART_URL, resp.content.decode())

    # --- MusicMetadataViewSet: no cross-tenant leak -----------------------------
    def test_metadata_list_does_not_leak_across_tenants(self):
        resp = self.client_for(self.bob).get(
            f'/api/audio/api/metadata/?audio_id={self.alice_audio.id}'
        )
        self.assertEqual(resp.status_code, 200)
        self.assertNotIn(self.ALICE_ALBUM, resp.content.decode())

    # --- AudioArtworkViewSet: owner-scoped retrieve -----------------------------
    def test_bob_cannot_read_alice_audio_artwork(self):
        resp = self.client_for(self.bob).get(f'/api/audio/api/audio-artwork/{self.alice_audio.id}/')
        self.assertEqual(resp.status_code, 404)
        self.assertNotIn(self.ALICE_ART_URL, resp.content.decode())

    def test_owner_reads_own_audio_artwork(self):
        resp = self.client_for(self.alice).get(f'/api/audio/api/audio-artwork/{self.alice_audio.id}/')
        self.assertEqual(resp.status_code, 200)

    # --- ChannelArtworkViewSet: no NameError (finding #4), owner-scoped (#5) -----
    def test_channel_artwork_owner_ok_not_500(self):
        # Before the fix this raised NameError('Channel') -> 500.
        resp = self.client_for(self.alice).get(
            f'/api/audio/api/channel-artwork/{self.alice_channel.id}/'
        )
        self.assertEqual(resp.status_code, 200)

    def test_bob_cannot_read_alice_channel_artwork(self):
        resp = self.client_for(self.bob).get(
            f'/api/audio/api/channel-artwork/{self.alice_channel.id}/'
        )
        self.assertEqual(resp.status_code, 404)
