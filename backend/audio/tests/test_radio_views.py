"""View-level tests for the radio next-track algorithm (CODE_REVIEW_REPORT Step 25).

The radio views are the most intricate backend logic in the app and had no coverage above
the pure-math helpers in test_radio_features.py -- which is how the "Random from library"
fallback masqueraded as Sonic mode for every pre-F16 track (Step 6).

What is locked in here:
  * a seed belonging to another user is not addressable (BOLA);
  * Sonic mode ranks by acoustic distance and says so;
  * Auto-DJ honours durable skip feedback, at session start as well as mid-session.

The degradation path for a seed with no feature_vector lives in test_radio_sonic_fallback.py.

Run: python manage.py test audio --settings=config.settings_test
"""
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from audio.models import Audio
from audio.models_radio import RadioTrackFeedback
from audio.radio_features import HIGH_SKIP_THRESHOLD
from user.models import Account

SONIC_REASON = 'Sonically similar'
RANDOM_FALLBACK_REASON = 'Random from library'

SEED_VECTOR = [0.50, 0.40, 0.30, 0.20, 0.60, 0.50, 0.50]
NEAR_VECTOR = [0.51, 0.41, 0.31, 0.21, 0.61, 0.51, 0.51]
FAR_VECTOR = [0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99]

SEED_ENERGY = 0.50
# variety_level 0 keeps the candidate window at its narrowest, so the assertions below are
# about the ranking itself rather than about how the weighted pick happened to land.
NO_VARIETY = 0


def make_audio(owner, youtube_id, title='Track', channel_id='UC_radio',
               feature_vector=None, energy=None):
    return Audio.objects.create(
        owner=owner,
        youtube_id=youtube_id,
        title=title,
        channel_id=channel_id,
        channel_name='Radio Test Channel',
        duration=180,
        file_path=f'Radio Test Channel/{youtube_id}.m4a',
        file_size=1024,
        published_date=timezone.now(),
        feature_vector=feature_vector or [],
        energy=energy,
    )


class RadioSeedOwnershipTests(TestCase):
    """A radio seed is addressed by youtube_id, so it needs the same owner scoping as the
    library itself -- otherwise it becomes an oracle for another account's track titles."""

    @classmethod
    def setUpTestData(cls):
        cls.user = Account.objects.create_user('radio_owner', 'ro@test.local', 'Radiopw_2026!')
        cls.other = Account.objects.create_user('radio_other', 'rx@test.local', 'Radiopw_2026!')
        cls.other_track = make_audio(cls.other, 'OTHER_SEED', 'Someone Elses Song')
        make_audio(cls.user, 'OWN_TRACK', 'My Song')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_track_mode_rejects_another_users_seed(self):
        response = self.client.post(
            '/api/radio/start/',
            {'mode': 'track', 'seed_youtube_id': 'OTHER_SEED'},
            format='json',
        )
        self.assertEqual(response.status_code, 404)

    def test_sonic_mode_rejects_another_users_seed(self):
        response = self.client.post(
            '/api/radio/start/',
            {'mode': 'sonic', 'seed_youtube_id': 'OTHER_SEED'},
            format='json',
        )
        self.assertEqual(response.status_code, 404)

    def test_rejection_leaks_nothing_about_the_other_users_track(self):
        response = self.client.post(
            '/api/radio/start/',
            {'mode': 'sonic', 'seed_youtube_id': 'OTHER_SEED'},
            format='json',
        )
        self.assertNotIn(self.other_track.title, response.content.decode())

    def test_unknown_seed_is_indistinguishable_from_another_users_seed(self):
        missing = self.client.post(
            '/api/radio/start/',
            {'mode': 'sonic', 'seed_youtube_id': 'NO_SUCH_ID'},
            format='json',
        )
        foreign = self.client.post(
            '/api/radio/start/',
            {'mode': 'sonic', 'seed_youtube_id': 'OTHER_SEED'},
            format='json',
        )
        self.assertEqual(missing.status_code, foreign.status_code)
        self.assertEqual(missing.json(), foreign.json())


class SonicNextTrackTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = Account.objects.create_user('sonic_v', 'sv@test.local', 'Radiopw_2026!')
        cls.seed = make_audio(
            cls.user, 'SEED', 'Seed', feature_vector=SEED_VECTOR, energy=SEED_ENERGY,
        )
        cls.near_ids = set()
        for index in range(3):
            near = make_audio(
                cls.user, f'NEAR_{index}', f'Near {index}',
                channel_id='UC_near', feature_vector=NEAR_VECTOR, energy=SEED_ENERGY,
            )
            cls.near_ids.add(near.youtube_id)
        cls.far = make_audio(
            cls.user, 'FAR', 'Far', channel_id='UC_far',
            feature_vector=FAR_VECTOR, energy=SEED_ENERGY,
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        start = self.client.post(
            '/api/radio/start/',
            {'mode': 'sonic', 'seed_youtube_id': 'SEED', 'variety_level': NO_VARIETY},
            format='json',
        )
        self.assertEqual(start.status_code, 200)
        self.assertTrue(start.json()['features_ready'])

    def test_next_track_is_an_acoustic_neighbour(self):
        response = self.client.get('/api/radio/next/')

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn(body['track']['youtube_id'], self.near_ids)
        self.assertEqual(body['reason'], SONIC_REASON)

    def test_the_acoustically_distant_track_is_not_reached_first(self):
        response = self.client.get('/api/radio/next/')

        self.assertNotEqual(response.json()['track']['youtube_id'], self.far.youtube_id)

    def test_a_sonic_session_never_reports_the_random_fallback(self):
        response = self.client.get('/api/radio/next/')

        self.assertNotEqual(response.json()['reason'], RANDOM_FALLBACK_REASON)


class AutoDjSkipFeedbackTests(TestCase):
    """Auto-DJ reads durable RadioTrackFeedback, not just the in-session skip list, so a track
    the user keeps skipping stays out of future sessions too."""

    # 'focus' targets ~0.45 at the start of a session and drifts to ~0.51; parking the
    # repeatedly-skipped track dead on that target means only the skip filter can keep it out.
    SKIPPED_ENERGY = 0.48
    NEIGHBOUR_ENERGIES = (0.47, 0.49, 0.50, 0.51, 0.52)

    @classmethod
    def setUpTestData(cls):
        cls.user = Account.objects.create_user('autodj_u', 'ad@test.local', 'Radiopw_2026!')
        cls.skipped = make_audio(cls.user, 'SKIPPED', 'Skipped Often', energy=cls.SKIPPED_ENERGY)
        for index, energy in enumerate(cls.NEIGHBOUR_ENERGIES):
            make_audio(cls.user, f'KEEP_{index}', f'Keeper {index}', energy=energy)

        for _ in range(HIGH_SKIP_THRESHOLD):
            RadioTrackFeedback.objects.create(
                user=cls.user,
                youtube_id='SKIPPED',
                channel_id='UC_radio',
                feedback_type='skipped',
                radio_mode='autodj',
            )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def start_autodj(self):
        response = self.client.post(
            '/api/radio/start/',
            {'mode': 'autodj', 'curve': 'focus', 'variety_level': NO_VARIETY},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        return response.json()

    def test_session_does_not_open_on_a_repeatedly_skipped_track(self):
        first_track = self.start_autodj()['first_track']

        self.assertIsNotNone(first_track)
        self.assertNotEqual(first_track['youtube_id'], 'SKIPPED')

    def test_next_track_excludes_a_repeatedly_skipped_track(self):
        self.start_autodj()

        # Fewer requests than there are keepers, so the pool never empties into the random
        # fallback -- which is deliberately unfiltered and would serve anything left.
        for _ in range(len(self.NEIGHBOUR_ENERGIES) - 2):
            response = self.client.get('/api/radio/next/')
            self.assertEqual(response.status_code, 200)
            self.assertNotEqual(response.json()['track']['youtube_id'], 'SKIPPED')

    def test_a_track_below_the_threshold_stays_eligible(self):
        RadioTrackFeedback.objects.filter(youtube_id='SKIPPED').first().delete()

        seen = set()
        self.start_autodj()
        for _ in range(len(self.NEIGHBOUR_ENERGIES)):
            response = self.client.get('/api/radio/next/')
            if response.status_code != 200:
                break
            seen.add(response.json()['track']['youtube_id'])

        self.assertIn('SKIPPED', seen)

    def test_another_users_skip_history_does_not_filter_this_users_radio(self):
        stranger = Account.objects.create_user('autodj_x', 'ax@test.local', 'Radiopw_2026!')
        for index, energy in enumerate(self.NEIGHBOUR_ENERGIES):
            make_audio(stranger, f'STRANGER_{index}', f'Stranger {index}', energy=energy)
        make_audio(stranger, 'SKIPPED', 'Skipped Often', energy=self.SKIPPED_ENERGY)

        stranger_client = APIClient()
        stranger_client.force_authenticate(user=stranger)
        stranger_client.post(
            '/api/radio/start/',
            {'mode': 'autodj', 'curve': 'focus', 'variety_level': NO_VARIETY},
            format='json',
        )

        seen = set()
        for _ in range(len(self.NEIGHBOUR_ENERGIES)):
            response = stranger_client.get('/api/radio/next/')
            if response.status_code != 200:
                break
            seen.add(response.json()['track']['youtube_id'])

        self.assertIn('SKIPPED', seen)
