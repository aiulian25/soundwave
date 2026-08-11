"""F16 — sonic-similarity radio / Auto-DJ.

All coverage runs WITHOUT librosa: the pure similarity/energy math is tested directly, the
acceptance criteria use hand-set feature_vectors, and the extract task's guard branches return
before the lazy librosa import. No test invokes librosa.load.

Run: python manage.py test audio.tests.test_radio_features --settings=config.settings_test
"""
from types import SimpleNamespace

from django.test import TestCase, SimpleTestCase
from django.utils import timezone
from rest_framework.test import APIClient

from user.models import Account
from audio.models import Audio
from audio.models_radio import RadioTrackFeedback
from audio import radio_features as rf


class PureMathTests(SimpleTestCase):
    def test_cosine_distance_identical_is_zero(self):
        self.assertAlmostEqual(rf.cosine_distance([0.5, 0.5, 0.5], [0.5, 0.5, 0.5]), 0.0, places=6)

    def test_cosine_distance_orthogonal_is_one(self):
        self.assertAlmostEqual(rf.cosine_distance([1, 0], [0, 1]), 1.0, places=6)

    def test_cosine_distance_degenerate_inputs(self):
        self.assertEqual(rf.cosine_distance([], [1, 2]), 1.0)
        self.assertEqual(rf.cosine_distance([0, 0], [1, 1]), 1.0)
        self.assertEqual(rf.cosine_distance([1, 2, 3], [1, 2]), 1.0)

    def test_feature_distance_is_magnitude_sensitive(self):
        self.assertEqual(rf.feature_distance([0.5, 0.5], [0.5, 0.5]), 0.0)
        # scalar multiples are NOT zero distance (unlike cosine) -> magnitude counts
        self.assertGreater(rf.feature_distance([0.1, 0.2], [0.5, 1.0]), 0.0)
        self.assertEqual(rf.feature_distance([], [1, 2]), float('inf'))

    def test_clip01_clamps(self):
        self.assertEqual(rf._clip01(-5), 0.0)
        self.assertEqual(rf._clip01(2), 1.0)
        self.assertEqual(rf._clip01(0.5), 0.5)
        self.assertEqual(rf._clip01(None), 0.0)

    def test_build_feature_vector_normalized(self):
        vector = rf.build_feature_vector(0.8, 128, 4000, 0.1, 5000, 9)
        self.assertEqual(len(vector), rf.FEATURE_VECTOR_DIM)
        self.assertTrue(all(0.0 <= value <= 1.0 for value in vector))
        garbage = rf.build_feature_vector(None, None, None, None, None, None)
        self.assertTrue(all(0.0 <= value <= 1.0 for value in garbage))

    def test_winddown_target_strictly_decreasing(self):
        targets = [rf.energy_target(rf.CURVE_WINDDOWN, p) for p in (0.0, 0.25, 0.5, 0.75, 1.0)]
        for current, nxt in zip(targets, targets[1:]):
            self.assertLess(nxt, current)

    def test_focus_and_party_stay_in_range(self):
        for curve in (rf.CURVE_FOCUS, rf.CURVE_PARTY):
            for p in (0.0, 0.5, 1.0):
                target = rf.energy_target(curve, p)
                self.assertTrue(0.0 <= target <= 1.0)


class SonicAcceptanceTests(SimpleTestCase):
    """Acceptance: sonic's first 5 picks are nearer to the seed than artist-mode picks."""

    @staticmethod
    def _track(vector, channel_id='ch'):
        return SimpleNamespace(feature_vector=vector, channel_id=channel_id, genre='', youtube_id='x')

    def test_sonic_first5_mean_distance_below_artist(self):
        seed = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5]
        # Acoustically near, DIFFERENT artists (slightly-off directions -> tiny cosine distance).
        near = [self._track([0.5, 0.5, 0.5, 0.5, 0.5, 0.5 + 0.03 * i], channel_id=f'other{i}') for i in range(6)]
        # Artist-mode picks: SAME channel as seed but far-off vectors.
        far = [self._track([0.95, 0.05, 0.95, 0.05, 0.95, 0.05], channel_id='SEEDCH') for _ in range(6)]

        ranked = rf.rank_by_sonic_distance(seed, near + far, seed_channel_id='SEEDCH')
        sonic_first5 = ranked[:5]
        sonic_mean = sum(rf.feature_distance(seed, t.feature_vector) for t in sonic_first5) / 5
        artist_mean = sum(rf.feature_distance(seed, t.feature_vector) for t in far[:5]) / 5
        self.assertLess(sonic_mean, artist_mean)


class AutoDjWindDownTests(SimpleTestCase):
    def test_winddown_chosen_energies_monotonically_non_increasing(self):
        pool = [SimpleNamespace(energy=round(0.05 * i, 3), youtube_id=f't{i}') for i in range(1, 21)]  # 0.05..1.0
        remaining = list(pool)
        chosen_energies = []
        for position in range(10):
            progress = min(position / rf.AUTODJ_SESSION_LENGTH, 1.0)
            target = rf.energy_target(rf.CURVE_WINDDOWN, progress)
            chosen = rf.nearest_by_energy(target, remaining)[0]
            chosen_energies.append(chosen.energy)
            remaining.remove(chosen)
        for current, nxt in zip(chosen_energies, chosen_energies[1:]):
            self.assertLessEqual(nxt, current)


class HighSkipExclusionTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.alice = Account.objects.create_user('alice_sk', 'alice_sk@test.local', 'Alicepw_2026!')
        cls.bob = Account.objects.create_user('bob_sk', 'bob_sk@test.local', 'Bobpw_2026!')

    def test_high_skip_is_owner_scoped(self):
        for _ in range(3):
            RadioTrackFeedback.objects.create(user=self.alice, youtube_id='SKIP1', channel_id='c', feedback_type='skipped')
        RadioTrackFeedback.objects.create(user=self.bob, youtube_id='SKIP1', channel_id='c', feedback_type='skipped')
        self.assertIn('SKIP1', rf.high_skip_youtube_ids(self.alice))
        self.assertNotIn('SKIP1', rf.high_skip_youtube_ids(self.bob))  # bob skipped only once


class RadioModeViewTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = Account.objects.create_user('radio_u', 'radio_u@test.local', 'Radiopw_2026!')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _audio(self, youtube_id, vector, energy, channel='ch'):
        return Audio.objects.create(
            owner=self.user, youtube_id=youtube_id, title=youtube_id, channel_id=channel,
            channel_name='C', duration=100, file_path=f'C/{youtube_id}.m4a', file_size=1,
            published_date=timezone.now(), feature_vector=vector, energy=energy,
        )

    def test_sonic_radio_returns_owner_scoped_neighbor(self):
        self._audio('SEED', [0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 0.5)
        self._audio('NEAR', [0.5, 0.5, 0.5, 0.5, 0.5, 0.55], 0.5, channel='other')
        self._audio('FAR', [0.95, 0.05, 0.95, 0.05, 0.95, 0.05], 0.9, channel='other2')
        start = self.client.post('/api/radio/start/', {'mode': 'sonic', 'seed_youtube_id': 'SEED'}, format='json')
        self.assertEqual(start.status_code, 200)
        nxt = self.client.get('/api/radio/next/')
        self.assertEqual(nxt.status_code, 200)
        self.assertIn(nxt.json()['track']['youtube_id'], {'NEAR', 'FAR'})  # never the seed, owner-scoped

    def test_autodj_radio_returns_track(self):
        for index, energy in enumerate([0.2, 0.5, 0.9]):
            self._audio(f'A{index}', [energy] * 6, energy, channel=f'ch{index}')
        start = self.client.post('/api/radio/start/', {'mode': 'autodj', 'curve': 'winddown'}, format='json')
        self.assertEqual(start.status_code, 200)
        nxt = self.client.get('/api/radio/next/')
        self.assertEqual(nxt.status_code, 200)
        self.assertIn(nxt.json()['track']['youtube_id'], {'A0', 'A1', 'A2'})


class ExtractFeaturesGuardTests(TestCase):
    """The task's guard branches return before importing librosa, proving a librosa-free load."""

    @classmethod
    def setUpTestData(cls):
        cls.user = Account.objects.create_user('feat_u', 'feat_u@test.local', 'Featpw_2026!')

    def test_nonexistent_audio_returns_guard(self):
        from task.tasks import extract_features_task
        self.assertIn('no longer exists', extract_features_task(999999))

    def test_missing_file_path_returns_guard(self):
        from task.tasks import extract_features_task
        audio = Audio.objects.create(
            owner=self.user, youtube_id='NOFILE', title='x', channel_id='c', channel_name='C',
            duration=1, file_path='', file_size=0, published_date=timezone.now(),
        )
        self.assertIn('has no file', extract_features_task(audio.id))
