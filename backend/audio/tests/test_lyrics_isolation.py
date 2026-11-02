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
from datetime import timedelta
from unittest import mock

from celery import current_app
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from user.models import Account
from audio.models import Audio
from audio.models_lyrics import Lyrics, LyricsCache
from audio.serializers_lyrics import MAX_LYRICS_BATCH_SIZE
from audio.tasks_lyrics import (
    auto_fetch_lyrics,
    fetch_lyrics_batch,
    fetch_lyrics_for_audio,
    fetch_missing_lyrics_for_owner,
    refetch_failed_lyrics,
)


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


PROVIDER_LYRICS = {
    'synced_lyrics': '',
    'plain_lyrics': 'synthetic provider words',
    'instrumental': False,
    'language': 'en',
    'not_found': False,
    'source': 'lrclib',
}
PROVIDER = 'audio.lyrics_service.LyricsService.fetch_lyrics'
CAPTIONS = 'audio.captions_service.fetch_captions_lrc'
MANUAL_WORDS = 'typed by the owner'


class LyricsJobTestCase(TestCase):
    """Task bodies run for real; only the outbound lyrics provider is replaced."""

    SHARED_YT = 'JOB_SHARED_01'

    def setUp(self):
        self.alice = Account.objects.create_user('alice_job', 'alice_job@test.local', 'Alicepw_2026!')
        self.bob = Account.objects.create_user('bob_job', 'bob_job@test.local', 'Bobpw_2026!')
        self.alice_audio = _make_audio(self.alice, self.SHARED_YT, 'Alice Copy')
        self.bob_audio = _make_audio(self.bob, self.SHARED_YT, 'Bob Copy')
        for active_patch in (
            mock.patch(PROVIDER, return_value=dict(PROVIDER_LYRICS)),
            mock.patch(CAPTIONS, return_value=None),
            mock.patch('time.sleep'),
        ):
            active_patch.start()
            self.addCleanup(active_patch.stop)

    def client_for(self, user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def lyrics_of(self, audio):
        return Lyrics.objects.filter(audio=audio).first()


class LyricsTaskOwnershipTests(LyricsJobTestCase):
    def test_two_owners_of_one_video_each_get_their_own_lyrics(self):
        first = fetch_lyrics_for_audio(self.alice_audio.pk, self.alice.pk)
        self.assertEqual(first['status'], 'success')
        self.assertTrue(self.lyrics_of(self.alice_audio).has_lyrics)
        self.assertIsNone(self.lyrics_of(self.bob_audio))

        second = fetch_lyrics_for_audio(self.bob_audio.pk, self.bob.pk)
        self.assertEqual(second['status'], 'success')
        self.assertTrue(self.lyrics_of(self.bob_audio).has_lyrics)

    def test_foreign_audio_id_cannot_touch_the_victim(self):
        result = fetch_lyrics_for_audio(self.bob_audio.pk, self.alice.pk)
        self.assertEqual(result['status'], 'skipped')
        self.assertIsNone(self.lyrics_of(self.bob_audio))

    def test_track_deleted_before_execution_is_a_no_op_without_recreation(self):
        audio_id = self.alice_audio.pk
        Audio.objects.filter(pk=audio_id).delete()
        self.assertEqual(fetch_lyrics_for_audio(audio_id, self.alice.pk)['status'], 'skipped')
        self.assertFalse(Lyrics.objects.filter(audio_id=audio_id).exists())

    def test_owner_deleted_before_execution_is_a_no_op(self):
        audio_id, owner_id = self.alice_audio.pk, self.alice.pk
        self.alice.delete()
        self.assertEqual(fetch_lyrics_for_audio(audio_id, owner_id)['status'], 'skipped')
        self.assertEqual(
            fetch_lyrics_batch([audio_id], owner_id), {'success': 0, 'failed': 0, 'skipped': 1}
        )

    def test_suspended_owner_is_skipped(self):
        Account.objects.filter(pk=self.alice.pk).update(is_active=False)
        self.assertEqual(fetch_lyrics_for_audio(self.alice_audio.pk, self.alice.pk)['status'], 'skipped')
        self.assertEqual(fetch_missing_lyrics_for_owner(self.alice.pk), {'status': 'no_work', 'message': mock.ANY})
        self.assertIsNone(self.lyrics_of(self.alice_audio))

    def test_scheduled_retry_skips_a_suspended_owner(self):
        retry_due = timezone.now() - timedelta(days=30)
        for audio in (self.alice_audio, self.bob_audio):
            Lyrics.objects.create(audio=audio, fetch_attempted=True, fetch_attempts=1)
        Lyrics.objects.update(fetched_date=retry_due)
        Account.objects.filter(pk=self.alice.pk).update(is_active=False)
        refetch_failed_lyrics(days_old=7)
        self.assertFalse(self.lyrics_of(self.alice_audio).has_lyrics)
        self.assertTrue(self.lyrics_of(self.bob_audio).has_lyrics)

    def test_batch_only_touches_the_named_owner(self):
        results = fetch_lyrics_batch([self.alice_audio.pk, self.bob_audio.pk], self.alice.pk)
        self.assertEqual(results, {'success': 1, 'failed': 0, 'skipped': 1})
        self.assertIsNone(self.lyrics_of(self.bob_audio))

    def test_owner_missing_job_leaves_other_owners_alone(self):
        fetch_missing_lyrics_for_owner(self.alice.pk)
        self.assertTrue(self.lyrics_of(self.alice_audio).has_lyrics)
        self.assertIsNone(self.lyrics_of(self.bob_audio))

    def test_scheduled_job_still_covers_every_active_owner(self):
        results = auto_fetch_lyrics(limit=10)
        self.assertEqual(results['success'], 2)
        self.assertTrue(self.lyrics_of(self.alice_audio).has_lyrics)
        self.assertTrue(self.lyrics_of(self.bob_audio).has_lyrics)

    def test_old_global_task_names_are_gone(self):
        current_app.loader.import_default_modules()
        self.assertNotIn('audio.fetch_lyrics_for_audio', current_app.tasks)
        self.assertNotIn('audio.fetch_lyrics_batch', current_app.tasks)
        self.assertIn('audio.fetch_lyrics_for_owned_audio', current_app.tasks)
        self.assertIn('audio.fetch_lyrics_batch_for_owner', current_app.tasks)
        self.assertIn('audio.fetch_missing_lyrics_for_owner', current_app.tasks)


class ExistingLyricsPrecedenceTests(LyricsJobTestCase):
    def setUp(self):
        super().setUp()
        Lyrics.objects.create(
            audio=self.alice_audio, plain_lyrics=MANUAL_WORDS, source='manual', fetch_attempted=True
        )

    def test_background_fetch_keeps_lyrics_set_by_hand(self):
        fetch_lyrics_for_audio(self.alice_audio.pk, self.alice.pk)
        auto_fetch_lyrics(limit=10)
        fetch_missing_lyrics_for_owner(self.alice.pk)
        fetch_lyrics_batch([self.alice_audio.pk], self.alice.pk)
        lyrics = self.lyrics_of(self.alice_audio)
        self.assertEqual((lyrics.plain_lyrics, lyrics.source), (MANUAL_WORDS, 'manual'))

    def test_background_fetch_keeps_a_track_marked_instrumental(self):
        Lyrics.objects.create(audio=self.bob_audio, is_instrumental=True, source='manual', fetch_attempted=True)
        fetch_lyrics_for_audio(self.bob_audio.pk, self.bob.pk)
        lyrics = self.lyrics_of(self.bob_audio)
        self.assertTrue(lyrics.is_instrumental)
        self.assertFalse(lyrics.has_lyrics)

    def test_explicit_force_still_replaces(self):
        fetch_lyrics_for_audio(self.alice_audio.pk, self.alice.pk, force=True)
        self.assertEqual(self.lyrics_of(self.alice_audio).plain_lyrics, PROVIDER_LYRICS['plain_lyrics'])

    def test_tracks_with_lyrics_do_not_use_up_the_scheduled_limit(self):
        Lyrics.objects.all().delete()
        first_in_line, waiting = Audio.objects.all()[:2]
        Lyrics.objects.create(audio=first_in_line, plain_lyrics=MANUAL_WORDS, fetch_attempted=True)
        auto_fetch_lyrics(limit=1)
        self.assertTrue(self.lyrics_of(waiting).has_lyrics)


class LyricsDispatchTests(LyricsJobTestCase):
    BATCH_URL = '/api/audio/lyrics/fetch_batch/'
    MISSING_URL = '/api/audio/lyrics/fetch_all_missing/'
    CLEANUP_URL = '/api/audio/lyrics-cache/cleanup/'

    def test_opening_lyrics_queues_the_requesters_own_row(self):
        with mock.patch('audio.views_lyrics.fetch_lyrics_for_audio.delay') as delay:
            response = self.client_for(self.bob).get(f'/api/audio/{self.SHARED_YT}/lyrics/')
        self.assertEqual(response.status_code, 200)
        delay.assert_called_once_with(self.bob_audio.pk, self.bob.pk)

    def test_opening_the_player_queues_the_requesters_own_row(self):
        with mock.patch('audio.tasks_lyrics.fetch_lyrics_for_audio.delay') as delay:
            response = self.client_for(self.bob).get(f'/api/audio/{self.SHARED_YT}/player/')
        self.assertEqual(response.status_code, 200)
        delay.assert_called_once_with(self.bob_audio.pk, self.bob.pk)

    def test_batch_drops_foreign_and_unknown_ids_alike(self):
        foreign = _make_audio(self.bob, 'JOB_BOB_ONLY1', 'Bob Only')
        with mock.patch('audio.views_lyrics.fetch_lyrics_batch.delay') as delay:
            response = self.client_for(self.alice).post(
                self.BATCH_URL,
                {'youtube_ids': [self.SHARED_YT, foreign.youtube_id, 'JOB_UNKNOWN_1']},
                format='json',
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['youtube_ids'], [self.SHARED_YT])
        delay.assert_called_once_with([self.alice_audio.pk], self.alice.pk)

    def test_batch_input_is_bounded(self):
        cases = {
            'too many': ['x'] * (MAX_LYRICS_BATCH_SIZE + 1),
            'empty': [],
            'not a list': 'JOB_SHARED_01',
            'oversized id': ['x' * 51],
        }
        with mock.patch('audio.views_lyrics.fetch_lyrics_batch.delay') as delay:
            for label, youtube_ids in cases.items():
                with self.subTest(label):
                    response = self.client_for(self.alice).post(
                        self.BATCH_URL, {'youtube_ids': youtube_ids}, format='json'
                    )
                    self.assertEqual(response.status_code, 400)
        delay.assert_not_called()

    def test_fetch_all_missing_is_scoped_and_bounded(self):
        with mock.patch('audio.views_lyrics.fetch_missing_lyrics_for_owner.delay') as delay:
            delay.return_value.id = 'synthetic-task-id'
            accepted = self.client_for(self.alice).post(self.MISSING_URL, {'limit': 5}, format='json')
            refused = [
                self.client_for(self.alice).post(self.MISSING_URL, {'limit': limit}, format='json')
                for limit in (0, 100000, 'many')
            ]
        self.assertEqual(accepted.status_code, 200)
        delay.assert_called_once_with(self.alice.pk, limit=5)
        self.assertEqual([response.status_code for response in refused], [400, 400, 400])

    def test_regular_user_cannot_clean_the_shared_cache(self):
        LyricsCache.objects.create(title='T', artist_name='A', duration=1, not_found=True)
        with mock.patch('audio.views_lyrics.cleanup_lyrics_cache.delay') as delay:
            response = self.client_for(self.alice).post(self.CLEANUP_URL, {'days_old': 1}, format='json')
        self.assertEqual(response.status_code, 403)
        delay.assert_not_called()

    def test_admin_cleans_the_cache_within_bounds(self):
        admin = Account.objects.create_superuser('admin_job', 'admin_job@test.local', 'Adminpw_2026!')
        with mock.patch('audio.views_lyrics.cleanup_lyrics_cache.delay') as delay:
            delay.return_value.id = 'synthetic-task-id'
            accepted = self.client_for(admin).post(self.CLEANUP_URL, {'days_old': 7}, format='json')
            refused = self.client_for(admin).post(self.CLEANUP_URL, {'days_old': 0}, format='json')
        self.assertEqual(accepted.status_code, 200)
        delay.assert_called_once_with(days_old=7)
        self.assertEqual(refused.status_code, 400)

