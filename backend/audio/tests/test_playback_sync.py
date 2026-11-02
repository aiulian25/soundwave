"""SW-011: the sync preference is real, and resuming restores the actual saved queue.

Run: python manage.py test audio.tests.test_playback_sync --settings=config.settings_test
"""
import random

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from audio.models import Audio
from audio.models_playback_sync import PlaybackSession
from audio.serializers_playback_sync import MAX_QUEUE_IDS
from user.models import Account, UserConfig

SYNC_URL = '/api/playback-sync/'
QUEUE_URL = '/api/playback-sync/queue/'
CONFIG_URL = '/api/user/config/'
QUEUE_SIZE = 100


class PlaybackSyncTestCase(TestCase):
    def setUp(self):
        self.alice = Account.objects.create_user('alice_sync', 'alice_sync@test.local', 'Alicepw_2026!')
        self.bob = Account.objects.create_user('bob_sync', 'bob_sync@test.local', 'Bobpw_2026!')
        self.client = APIClient()
        self.client.force_authenticate(self.alice)

    def make_audio(self, owner, youtube_id):
        return Audio.objects.create(
            owner=owner, youtube_id=youtube_id, title=youtube_id, channel_id='UC', channel_name='C', duration=1,
            file_path=f'{youtube_id}.m4a', file_size=1, published_date=timezone.now(),
        )

    def make_library(self, total=QUEUE_SIZE):
        return [self.make_audio(self.alice, f'TRACK_{index:03d}').youtube_id for index in range(total)]

    def save_session(self, queue, index, current=None):
        return PlaybackSession.objects.create(
            user=self.alice, youtube_id=current or queue[index], queue_youtube_ids=queue, queue_index=index,
        )

    def restored(self):
        response = self.client.get(QUEUE_URL)
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        body['ids'] = [track['youtube_id'] for track in body['data']]
        return body


class PreferenceTests(PlaybackSyncTestCase):
    def test_defaults_to_enabled(self):
        self.assertIs(self.client.get(CONFIG_URL).json()['playback_sync_enabled'], True)

    def test_disabling_persists(self):
        response = self.client.post(CONFIG_URL, {'playback_sync_enabled': False}, format='json')
        self.assertIs(response.json()['config']['playback_sync_enabled'], False)
        self.assertIs(self.client.get(CONFIG_URL).json()['playback_sync_enabled'], False)

    def test_a_non_boolean_is_refused(self):
        response = self.client.post(CONFIG_URL, {'playback_sync_enabled': 'sometimes'}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_preferences_are_per_account(self):
        self.client.post(CONFIG_URL, {'playback_sync_enabled': False}, format='json')
        other = APIClient()
        other.force_authenticate(self.bob)
        self.assertIs(other.get(CONFIG_URL).json()['playback_sync_enabled'], True)


class WriteGateTests(PlaybackSyncTestCase):
    def sync(self):
        return self.client.post(SYNC_URL, {'youtube_id': 'TRACK_000', 'position': 5}, format='json')

    def test_a_write_is_accepted_by_default_with_no_config_row(self):
        self.make_library(1)
        self.assertFalse(UserConfig.objects.filter(user=self.alice).exists())
        self.assertEqual(self.sync().status_code, 200)
        self.assertTrue(PlaybackSession.objects.filter(user=self.alice).exists())

    def test_a_stale_client_cannot_write_after_opting_out(self):
        self.make_library(1)
        UserConfig.objects.create(user=self.alice, playback_sync_enabled=False)
        self.assertEqual(self.sync().status_code, 409)
        self.assertFalse(PlaybackSession.objects.filter(user=self.alice).exists())

    def test_the_queue_size_is_bounded(self):
        self.make_library(1)
        body = {'youtube_id': 'TRACK_000', 'position': 0, 'queue_youtube_ids': ['x'] * (MAX_QUEUE_IDS + 1)}
        self.assertEqual(self.client.post(SYNC_URL, body, format='json').status_code, 400)

    def test_the_last_write_wins(self):
        self.make_library(2)
        for youtube_id, device in (('TRACK_000', 'phone'), ('TRACK_001', 'laptop')):
            self.client.post(SYNC_URL, {'youtube_id': youtube_id, 'position': 1, 'device_id': device}, format='json')
        session = PlaybackSession.objects.get(user=self.alice)
        self.assertEqual((session.youtube_id, session.device_id), ('TRACK_001', 'laptop'))


class QueueRestoreTests(PlaybackSyncTestCase):
    def test_a_shuffled_queue_of_100_returns_in_its_saved_order(self):
        library = self.make_library()
        shuffled = random.Random(7).sample(library, len(library))
        self.save_session(shuffled, 73)
        body = self.restored()
        self.assertEqual(body['ids'], shuffled)
        self.assertEqual((body['index'], body['missing']), (73, 0))

    def test_deleted_tracks_are_omitted_and_the_index_follows_the_current_track(self):
        queue = self.make_library(6)
        self.save_session(queue, 4)
        Audio.objects.filter(owner=self.alice, youtube_id__in=[queue[0], queue[2], queue[5]]).delete()
        body = self.restored()
        self.assertEqual(body['ids'], [queue[1], queue[3], queue[4]])
        self.assertEqual((body['index'], body['missing']), (2, 3))
        self.assertEqual(body['ids'][body['index']], queue[4])

    def test_another_owners_tracks_never_appear(self):
        queue = self.make_library(2)
        self.make_audio(self.bob, 'BOB_ONLY_01')
        self.save_session([queue[0], 'BOB_ONLY_01', queue[1]], 0)
        body = self.restored()
        self.assertEqual(body['ids'], queue)
        self.assertEqual(body['missing'], 1)

    def test_a_track_queued_twice_keeps_both_places(self):
        first, second = self.make_library(2)
        self.save_session([first, second, first], 2)
        body = self.restored()
        self.assertEqual(body['ids'], [first, second, first])
        self.assertEqual(body['index'], 2)

    def test_current_track_outside_the_saved_queue_has_no_index(self):
        first, second, other = self.make_library(3)
        self.save_session([first, second], 0, current=other)
        self.assertIsNone(self.restored()['index'])

    def test_a_saved_index_past_the_end_finds_the_current_track(self):
        first, second = self.make_library(2)
        self.save_session([first, second], 9, current=second)
        self.assertEqual(self.restored()['index'], 1)

    def test_no_session_is_a_404(self):
        self.assertEqual(self.client.get(QUEUE_URL).status_code, 404)

    def test_needs_authentication(self):
        self.assertIn(APIClient().get(QUEUE_URL).status_code, (401, 403))

    def test_each_account_gets_its_own_session(self):
        queue = self.make_library(1)
        self.save_session(queue, 0)
        other = APIClient()
        other.force_authenticate(self.bob)
        self.assertEqual(other.get(QUEUE_URL).status_code, 404)
