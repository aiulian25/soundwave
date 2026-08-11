"""Lyrics endpoint multi-tenant isolation + robustness regression tests.

Codifies CODE_REVIEW_REPORT findings:
  - #1: the lyrics handlers looked up Audio by youtube_id with no owner filter, so a
        user could read/update/delete another tenant's lyrics, and — because
        Audio.unique_together = ('owner', 'youtube_id') — two users owning the same
        video made the un-scoped .get() raise MultipleObjectsReturned -> HTTP 500.
  - #6: LyricsViewSet.stats filtered on the `downloaded` @property (not a column) ->
        FieldError -> HTTP 500.

Run: python manage.py test audio --settings=config.settings_test
"""
from unittest import mock

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from user.models import Account
from audio.models import Audio
from audio.models_lyrics import Lyrics


def _make_audio(owner, youtube_id, title):
    """Create a downloaded Audio row with all required (non-null) fields set."""
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


class LyricsIsolationTests(TestCase):
    SHARED_YT = 'SHARED_YT_ID0'
    ALICE_ONLY_YT = 'ALICE_ONLY_YT0'
    ALICE_SECRET = 'ALICE_SECRET_LYRICS'
    BOB_SECRET = 'BOB_SECRET_LYRICS'

    @classmethod
    def setUpTestData(cls):
        cls.alice = Account.objects.create_user('alice', 'alice@test.local', 'Alicepw_2026!')
        cls.bob = Account.objects.create_user('bob', 'bob@test.local', 'Bobpw_2026!')

        # Alice-only track + lyrics (Bob has no Audio with this youtube_id).
        cls.alice_only = _make_audio(cls.alice, cls.ALICE_ONLY_YT, 'Alice Only')
        Lyrics.objects.create(
            audio=cls.alice_only, plain_lyrics=cls.ALICE_SECRET, fetch_attempted=True,
        )

        # The SAME youtube_id owned by BOTH users — allowed by the model, and the exact
        # case that made the un-scoped .get() raise MultipleObjectsReturned.
        cls.alice_shared = _make_audio(cls.alice, cls.SHARED_YT, 'Alice Shared')
        Lyrics.objects.create(
            audio=cls.alice_shared, plain_lyrics=cls.ALICE_SECRET, fetch_attempted=True,
        )
        cls.bob_shared = _make_audio(cls.bob, cls.SHARED_YT, 'Bob Shared')
        Lyrics.objects.create(
            audio=cls.bob_shared, plain_lyrics=cls.BOB_SECRET, fetch_attempted=True,
        )

    def setUp(self):
        # retrieve() triggers an async lyrics fetch when a track has none. All fixtures
        # above set fetch_attempted=True so that branch never runs, but patch the task
        # too so a test never depends on a Celery broker being available.
        patcher = mock.patch('audio.views_lyrics.fetch_lyrics_for_audio')
        patcher.start()
        self.addCleanup(patcher.stop)

    def client_for(self, user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    # --- cross-tenant read/write/delete must 404, never leak --------------------
    def test_bob_cannot_read_alice_lyrics(self):
        resp = self.client_for(self.bob).get(f'/api/audio/{self.ALICE_ONLY_YT}/lyrics/')
        self.assertEqual(resp.status_code, 404)
        self.assertNotIn(self.ALICE_SECRET, resp.content.decode())

    def test_bob_cannot_update_alice_lyrics(self):
        resp = self.client_for(self.bob).put(
            f'/api/audio/{self.ALICE_ONLY_YT}/lyrics/',
            {'plain_lyrics': 'HACKED'}, format='json',
        )
        self.assertEqual(resp.status_code, 404)
        # Alice's lyrics untouched.
        self.assertEqual(
            Lyrics.objects.get(audio=self.alice_only).plain_lyrics, self.ALICE_SECRET,
        )

    def test_bob_cannot_delete_alice_lyrics(self):
        resp = self.client_for(self.bob).delete(f'/api/audio/{self.ALICE_ONLY_YT}/lyrics/')
        self.assertEqual(resp.status_code, 404)
        self.assertTrue(Lyrics.objects.filter(audio=self.alice_only).exists())

    def test_bob_cannot_download_alice_lyrics(self):
        resp = self.client_for(self.bob).get(f'/api/audio/{self.ALICE_ONLY_YT}/lyrics/download/')
        self.assertEqual(resp.status_code, 404)
        self.assertNotIn(self.ALICE_SECRET, resp.content.decode())

    # --- shared youtube_id: each user reads ONLY their own, and no 500 ----------
    def test_shared_youtube_id_no_500_each_sees_own(self):
        alice_resp = self.client_for(self.alice).get(f'/api/audio/{self.SHARED_YT}/lyrics/')
        self.assertEqual(alice_resp.status_code, 200)
        self.assertIn(self.ALICE_SECRET, alice_resp.content.decode())
        self.assertNotIn(self.BOB_SECRET, alice_resp.content.decode())

        bob_resp = self.client_for(self.bob).get(f'/api/audio/{self.SHARED_YT}/lyrics/')
        self.assertEqual(bob_resp.status_code, 200)
        self.assertIn(self.BOB_SECRET, bob_resp.content.decode())
        self.assertNotIn(self.ALICE_SECRET, bob_resp.content.decode())

    # --- positive control -------------------------------------------------------
    def test_owner_reads_own_lyrics(self):
        resp = self.client_for(self.alice).get(f'/api/audio/{self.ALICE_ONLY_YT}/lyrics/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn(self.ALICE_SECRET, resp.content.decode())

    # --- stats endpoint must return 200 (regression for the `downloaded` FieldError)
    def test_lyrics_stats_ok(self):
        resp = self.client_for(self.alice).get('/api/audio/lyrics/stats/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('coverage_percentage', resp.data)
