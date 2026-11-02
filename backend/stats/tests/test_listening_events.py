"""SW-016: one play is one event, however many times it is delivered.

Run: python manage.py test stats --settings=config.settings_test
"""
import threading
import unittest
import uuid
from datetime import timedelta

from django.db import connection, connections
from django.test import TestCase, TransactionTestCase
from django.utils import timezone
from rest_framework.test import APIClient

from audio.models import Audio, AudioProgress
from stats.models import ListeningHistory
from user.models import Account

RECORD_URL = '/api/stats/record/'


def _track(owner, youtube_id='LISTEN_1'):
    return Audio.objects.create(
        owner=owner, youtube_id=youtube_id, title='A Track', channel_id='UC', channel_name='Chan',
        duration=180, file_path=f'{youtube_id}.m4a', file_size=1, published_date=timezone.now(),
    )


def _event(**fields):
    return {'youtube_id': 'LISTEN_1', 'duration_listened': 20, 'completed': False, **fields}


class ListeningEventTests(TestCase):
    def setUp(self):
        self.owner = Account.objects.create_user('listen_u', 'listen_u@test.local', 'Listenpw_2026!')
        self.track = _track(self.owner)
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def _post(self, **fields):
        return self.client.post(RECORD_URL, _event(**fields), format='json')

    def _play_count(self):
        self.track.refresh_from_db()
        return self.track.play_count

    def test_retry_of_one_event_counts_once(self):
        event_id = str(uuid.uuid4())

        first = self._post(event_id=event_id)
        retry = self._post(event_id=event_id)

        self.assertEqual((first.status_code, retry.status_code), (201, 200))
        self.assertEqual(first.data['id'], retry.data['id'])
        self.assertEqual(ListeningHistory.objects.count(), 1)
        self.assertEqual(self._play_count(), 1)

    def test_two_real_plays_count_twice(self):
        self._post(event_id=str(uuid.uuid4()))
        self._post(event_id=str(uuid.uuid4()))

        self.assertEqual(ListeningHistory.objects.count(), 2)
        self.assertEqual(self._play_count(), 2)

    def test_event_ids_belong_to_one_account(self):
        stranger = Account.objects.create_user('listen_s', 'listen_s@test.local', 'Listenpw_2026!')
        _track(stranger)
        event_id = str(uuid.uuid4())
        client = APIClient()
        client.force_authenticate(stranger)

        self._post(event_id=event_id)
        response = client.post(RECORD_URL, _event(event_id=event_id), format='json')

        self.assertEqual(response.status_code, 201)
        self.assertEqual(ListeningHistory.objects.filter(event_id=event_id).count(), 2)

    def test_older_clients_without_an_id_still_record(self):
        self.assertEqual(self._post().status_code, 201)
        self.assertEqual(self._post().status_code, 201)

        self.assertEqual(self._play_count(), 2)

    def test_offline_play_keeps_its_time_and_received_time_is_separate(self):
        three_days_ago = timezone.now() - timedelta(days=3)

        self._post(event_id=str(uuid.uuid4()), occurred_at=three_days_ago.isoformat())

        entry = ListeningHistory.objects.get()
        self.assertEqual(entry.listened_at, three_days_ago)
        self.assertGreater(entry.received_at, three_days_ago + timedelta(days=2))

    def test_a_clock_ahead_cannot_record_the_future(self):
        self._post(occurred_at=(timezone.now() + timedelta(days=30)).isoformat())

        self.assertLessEqual(ListeningHistory.objects.get().listened_at, timezone.now())

    def test_late_delivery_does_not_move_last_played_backwards(self):
        recent = timezone.now() - timedelta(hours=1)
        self._post(occurred_at=recent.isoformat())
        self._post(occurred_at=(recent - timedelta(days=3)).isoformat())

        self.track.refresh_from_db()
        self.assertEqual(self.track.last_played, recent)

    def test_first_delivery_sets_last_played_when_there_was_none(self):
        moment = timezone.now() - timedelta(days=1)

        self._post(occurred_at=moment.isoformat())

        self.track.refresh_from_db()
        self.assertEqual(self.track.last_played, moment)

    def test_invalid_events_are_rejected_without_counting(self):
        cases = [
            {'duration_listened': 'long'},
            {'duration_listened': -1},
            {'duration_listened': 10 ** 7},
            {'event_id': 'not-a-uuid'},
            {'occurred_at': 'yesterday'},
            {'completed': 'perhaps'},
        ]
        for fields in cases:
            with self.subTest(fields=fields):
                self.assertEqual(self._post(**fields).status_code, 400)
        self.assertEqual(self._play_count(), 0)
        self.assertEqual(ListeningHistory.objects.count(), 0)

    def test_unknown_track_is_not_found(self):
        self.assertEqual(self._post(youtube_id='NOPE').status_code, 404)

    def test_another_accounts_track_cannot_be_recorded(self):
        stranger = Account.objects.create_user('listen_x', 'listen_x@test.local', 'Listenpw_2026!')
        other = _track(stranger, 'THEIRS')

        self.assertEqual(self._post(youtube_id='THEIRS').status_code, 404)
        other.refresh_from_db()
        self.assertEqual(other.play_count, 0)

    def test_saving_progress_never_counts_a_play(self):
        url = f'/api/audio/{self.track.youtube_id}/progress/'

        self.assertEqual(self.client.post(url, {'position': 5}, format='json').status_code, 200)
        self.assertEqual(self.client.post(url, {'position': 180, 'completed': True}, format='json').status_code, 200)

        self.assertEqual(self._play_count(), 0)
        self.assertTrue(AudioProgress.objects.get(audio=self.track).completed)

    def test_a_repeated_event_does_not_rerun_achievements(self):
        event_id = str(uuid.uuid4())
        self._post(event_id=event_id)

        retry = self._post(event_id=event_id)

        self.assertNotIn('new_achievements', retry.data)


@unittest.skipUnless(connection.vendor == 'postgresql', 'needs real concurrent transactions')
class ConcurrentDeliveryTests(TransactionTestCase):
    def test_simultaneous_retries_count_once(self):
        owner = Account.objects.create_user('race_u', 'race_u@test.local', 'Racepw_2026!')
        track = _track(owner)
        event_id = str(uuid.uuid4())
        start = threading.Barrier(4)
        statuses = []

        def deliver():
            client = APIClient()
            client.force_authenticate(owner)
            start.wait(timeout=10)
            try:
                statuses.append(client.post(RECORD_URL, _event(event_id=event_id), format='json').status_code)
            finally:
                connections.close_all()

        threads = [threading.Thread(target=deliver) for _ in range(4)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=30)

        track.refresh_from_db()
        self.assertEqual(sorted(statuses), [200, 200, 200, 201])
        self.assertEqual(ListeningHistory.objects.filter(event_id=event_id).count(), 1)
        self.assertEqual(track.play_count, 1)
