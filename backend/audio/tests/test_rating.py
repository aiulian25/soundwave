"""FEAT-111: a track carries its owner's stars, set through one checked action.

Run: python manage.py test audio.tests.test_rating --settings=config.settings_test
"""
from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from audio.models import HIGHEST_RATING, UNRATED, Audio
from user.models import Account

SET_RATING = 'set_rating'


class TrackRatingTests(TestCase):
    def setUp(self):
        self.alice = Account.objects.create_user('alice_rate', 'alice_rate@test.local', 'Alicepw_2026!')
        self.bob = Account.objects.create_user('bob_rate', 'bob_rate@test.local', 'Bobpw_2026!')
        self.client = APIClient()
        self.client.force_authenticate(self.alice)
        self.track = self.make_audio(self.alice)

    def make_audio(self, owner, **fields):
        return Audio.objects.create(
            owner=owner, youtube_id='RATED_TRACK', title='T', channel_id='UC', channel_name='C', duration=1,
            file_path='t.m4a', file_size=1, published_date=timezone.now(), **fields,
        )

    def rate(self, **body):
        return self.client.post('/api/audio/RATED_TRACK/', {'action': SET_RATING, **body}, format='json')

    def stored_rating(self, track=None):
        return Audio.objects.get(pk=(track or self.track).pk).rating

    def test_new_track_is_unrated(self):
        self.assertEqual(self.client.get('/api/audio/RATED_TRACK/').data['rating'], UNRATED)

    def test_rating_is_stored_and_returned_everywhere_the_track_is(self):
        response = self.rate(rating=4)

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data, {'rating': 4})
        self.assertEqual(self.stored_rating(), 4)
        self.assertEqual(self.client.get('/api/audio/RATED_TRACK/').data['rating'], 4)
        self.assertEqual(self.client.get('/api/audio/list/').json()['data'][0]['rating'], 4)

    def test_rating_can_be_changed_and_taken_away(self):
        self.rate(rating=HIGHEST_RATING)
        self.rate(rating=2)
        self.assertEqual(self.stored_rating(), 2)

        self.rate(rating=UNRATED)
        self.assertEqual(self.stored_rating(), UNRATED)

    def test_anything_but_zero_to_five_whole_stars_is_refused_and_changes_nothing(self):
        self.rate(rating=3)
        for body in ({'rating': HIGHEST_RATING + 1}, {'rating': -1}, {'rating': 'many'}, {'rating': 2.5},
                     {'rating': None}, {}):
            with self.subTest(body=body):
                self.assertEqual(self.rate(**body).status_code, 400)
                self.assertEqual(self.stored_rating(), 3)

    def test_rating_leaves_the_rest_of_the_track_alone(self):
        Audio.objects.filter(pk=self.track.pk).update(is_favorite=True, play_count=7)

        self.rate(rating=5)

        self.track.refresh_from_db()
        self.assertEqual((self.track.is_favorite, self.track.play_count, self.track.rating), (True, 7, 5))

    def test_each_account_rates_its_own_copy(self):
        bobs_copy = self.make_audio(self.bob, rating=1)

        self.rate(rating=5)

        self.assertEqual(self.stored_rating(), 5)
        self.assertEqual(self.stored_rating(bobs_copy), 1)

    def test_track_of_another_account_cannot_be_rated(self):
        self.track.delete()
        bobs_copy = self.make_audio(self.bob, rating=1)

        self.assertEqual(self.rate(rating=5).status_code, 404)
        self.assertEqual(self.stored_rating(bobs_copy), 1)

    def test_signing_in_is_required(self):
        self.client.force_authenticate(None)

        self.assertIn(self.rate(rating=5).status_code, (401, 403))
        self.assertEqual(self.stored_rating(), UNRATED)

    def test_database_refuses_more_than_five_stars_from_any_path(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            Audio.objects.filter(pk=self.track.pk).update(rating=HIGHEST_RATING + 1)
