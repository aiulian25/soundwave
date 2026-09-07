"""Sonic radio degradation tests (CODE_REVIEW_REPORT Step 6).

Before this change, a sonic seed with no `feature_vector` made
`_get_sonic_mode_candidates` return an empty candidate list, so `_get_next_track` fell
through to `base_qs.order_by('?')` and served "Random from library" under a Sonic label --
i.e. unrelated genres for every track predating the F16 feature extraction.

It now degrades to the metadata heuristics (`_get_track_mode_candidates`) and the start
endpoint reports `features_ready` so the SPA can explain why.

Run: python manage.py test audio --settings=config.settings_test
"""
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from audio.models import Audio
from user.models import Account

RANDOM_FALLBACK_REASON = 'Random from library'
SHARED_TITLE_KEYWORD = 'Thunderstorm'
FEATURE_VECTOR = [0.5, 0.4, 0.3, 0.2, 0.6, 0.5, 0.5]


def _make_audio(owner, youtube_id, title, channel_id='UC_sonic', feature_vector=None, energy=None):
    return Audio.objects.create(
        owner=owner,
        youtube_id=youtube_id,
        title=title,
        channel_id=channel_id,
        channel_name='Sonic Test Channel',
        duration=180,
        file_path=f'Sonic Test Channel/{youtube_id}.m4a',
        file_size=1024,
        published_date=timezone.now(),
        feature_vector=feature_vector or [],
        energy=energy,
    )


class SonicFallbackTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = Account.objects.create_user('sonic_u', 'sonic_u@test.local', 'Sonicpw_2026!')
        # Seed deliberately has NO feature_vector.
        cls.seed = _make_audio(cls.user, 'SONIC_SEED', f'{SHARED_TITLE_KEYWORD} Opening')
        # Metadata-similar neighbours: same channel, shared keyword, same duration.
        for index in range(3):
            _make_audio(cls.user, f'SONIC_NEAR_{index}', f'{SHARED_TITLE_KEYWORD} Part {index}')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def start_sonic(self, seed_youtube_id='SONIC_SEED'):
        return self.client.post(
            '/api/radio/start/',
            {'mode': 'sonic', 'seed_youtube_id': seed_youtube_id, 'variety_level': 50},
            format='json',
        )

    # --- features_ready reporting ------------------------------------------
    def test_start_reports_features_not_ready_when_seed_has_no_vector(self):
        resp = self.start_sonic()
        self.assertEqual(resp.status_code, 200)
        self.assertIs(resp.json()['features_ready'], False)

    def test_start_reports_features_ready_when_seed_has_vector(self):
        self.seed.feature_vector = FEATURE_VECTOR
        self.seed.energy = 0.5
        self.seed.save(update_fields=['feature_vector', 'energy'])
        resp = self.start_sonic()
        self.assertEqual(resp.status_code, 200)
        self.assertIs(resp.json()['features_ready'], True)

    def test_non_sonic_mode_always_reports_features_ready(self):
        resp = self.client.post('/api/radio/start/', {'mode': 'favorites'}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertIs(resp.json()['features_ready'], True)

    # --- the actual degradation --------------------------------------------
    def test_sonic_without_features_never_serves_random_fallback(self):
        """The whole point: metadata similarity, not `order_by('?')`."""
        self.assertEqual(self.start_sonic().status_code, 200)
        resp = self.client.get('/api/radio/next/')
        self.assertEqual(resp.status_code, 200)
        reason = resp.json()['reason']
        self.assertNotEqual(reason, RANDOM_FALLBACK_REASON)

    def test_sonic_without_features_picks_a_metadata_neighbour(self):
        self.assertEqual(self.start_sonic().status_code, 200)
        resp = self.client.get('/api/radio/next/')
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['track']['youtube_id'].startswith('SONIC_NEAR_'))
