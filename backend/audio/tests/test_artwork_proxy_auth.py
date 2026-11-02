"""ArtworkProxyView authorization regression tests.

Codifies CODE_REVIEW_REPORT Step 2: the proxy used to be `authentication_classes = []`
with an owner-less `get_object_or_404(Audio, youtube_id=...)`, which made it an anonymous
cross-tenant existence oracle (200 vs 404 revealed which YouTube IDs the instance held)
and an open relay to the allowlisted artwork hosts.

It is now authorized by a path-bound media ticket (`?t=`), an API key, or a session, and
the lookup is owner-scoped.

Run: python manage.py test audio --settings=config.settings_test
"""
from unittest import mock

import requests
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from audio.models import Audio
from audio.views import artwork_ticket_path
from common.safe_http import FetchedResponse, FetchRefused, REFUSED_TOO_LARGE
from common.streaming import make_media_ticket
from user.models import Account

ARTWORK_URL = 'https://i.ytimg.com/vi/ART_TEST_ID/hqdefault.jpg'
ARTWORK_PATH = '/api/audio/{youtube_id}/artwork/'
FETCH = 'common.safe_http.fetch_public_url'


def _fetched(content_type='image/jpeg'):
    return FetchedResponse(b'\xff\xd8\xff-image-bytes', content_type)


def _make_audio(owner, youtube_id):
    return Audio.objects.create(
        owner=owner,
        youtube_id=youtube_id,
        title=f'Track {youtube_id}',
        channel_id='UC_test',
        channel_name='Test Channel',
        duration=180,
        file_path=f'Test Channel/Track-{youtube_id}.m4a',
        file_size=1024,
        published_date=timezone.now(),
        thumbnail_url=ARTWORK_URL,
    )


class ArtworkProxyAuthTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.alice = Account.objects.create_user('alice_art', 'alice_art@test.local', 'Alicepw_2026!')
        cls.bob = Account.objects.create_user('bob_art', 'bob_art@test.local', 'Bobpw_2026!')
        cls.alice_audio = _make_audio(cls.alice, 'ART_ALICE_1')
        cls.other_audio = _make_audio(cls.alice, 'ART_ALICE_2')

    def setUp(self):
        self.client = APIClient()

    def url_for(self, youtube_id):
        return ARTWORK_PATH.format(youtube_id=youtube_id)

    def ticket_for(self, user, youtube_id):
        return make_media_ticket(user, artwork_ticket_path(youtube_id))

    # --- the oracle is closed -------------------------------------------------
    def test_anonymous_is_rejected(self):
        resp = self.client.get(self.url_for('ART_ALICE_1'))
        self.assertEqual(resp.status_code, 401)

    def test_anonymous_cannot_distinguish_existing_from_missing_track(self):
        """Both must be 401 — a 404-vs-401 split would leak which IDs exist."""
        existing = self.client.get(self.url_for('ART_ALICE_1')).status_code
        missing = self.client.get(self.url_for('NOPE_NOT_HERE')).status_code
        self.assertEqual(existing, 401)
        self.assertEqual(missing, 401)

    def test_cross_owner_session_is_404(self):
        self.client.force_authenticate(user=self.bob)
        resp = self.client.get(self.url_for('ART_ALICE_1'))
        self.assertEqual(resp.status_code, 404)

    # --- the legitimate paths still work --------------------------------------
    @mock.patch(FETCH)
    def test_valid_ticket_without_session_serves_image(self, fake_get):
        fake_get.return_value = _fetched()
        resp = self.client.get(
            self.url_for('ART_ALICE_1'), {'t': self.ticket_for(self.alice, 'ART_ALICE_1')}
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp['Content-Type'], 'image/jpeg')
        self.assertTrue(resp['Cache-Control'].startswith('private'))

    @mock.patch(FETCH)
    def test_owner_session_serves_image(self, fake_get):
        fake_get.return_value = _fetched()
        self.client.force_authenticate(user=self.alice)
        resp = self.client.get(self.url_for('ART_ALICE_1'))
        self.assertEqual(resp.status_code, 200)

    # --- the ticket is bound to one track -------------------------------------
    @mock.patch(FETCH)
    def test_ticket_for_another_track_is_rejected(self, fake_get):
        fake_get.return_value = _fetched()
        resp = self.client.get(
            self.url_for('ART_ALICE_1'), {'t': self.ticket_for(self.alice, 'ART_ALICE_2')}
        )
        self.assertEqual(resp.status_code, 401)
        fake_get.assert_not_called()

    @mock.patch(FETCH)
    def test_stream_ticket_cannot_be_replayed_as_artwork_ticket(self, fake_get):
        """A ticket minted for the media path must not unlock the artwork endpoint."""
        fake_get.return_value = _fetched()
        stream_ticket = make_media_ticket(self.alice, self.alice_audio.file_path)
        resp = self.client.get(self.url_for('ART_ALICE_1'), {'t': stream_ticket})
        self.assertEqual(resp.status_code, 401)
        fake_get.assert_not_called()

    # --- upstream response hardening ------------------------------------------
    @mock.patch(FETCH)
    def test_oversized_artwork_is_rejected(self, fake_get):
        fake_get.side_effect = FetchRefused(REFUSED_TOO_LARGE)
        self.client.force_authenticate(user=self.alice)
        resp = self.client.get(self.url_for('ART_ALICE_1'))
        self.assertEqual(resp.status_code, 502)

    @mock.patch(FETCH)
    def test_non_image_content_type_is_coerced(self, fake_get):
        fake_get.return_value = _fetched(content_type='text/html')
        self.client.force_authenticate(user=self.alice)
        resp = self.client.get(self.url_for('ART_ALICE_1'))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp['Content-Type'], 'image/jpeg')

    @mock.patch(FETCH)
    def test_refused_fetch_is_a_bad_gateway_without_details(self, fake_get):
        fake_get.side_effect = FetchRefused('internal_address')
        self.client.force_authenticate(user=self.alice)
        resp = self.client.get(self.url_for('ART_ALICE_1'))
        self.assertEqual(resp.status_code, 502)
        self.assertEqual(resp.json(), {'error': 'Failed to fetch artwork'})

    @mock.patch(FETCH)
    def test_network_failure_stays_a_server_error(self, fake_get):
        fake_get.side_effect = requests.ConnectionError('synthetic')
        self.client.force_authenticate(user=self.alice)
        resp = self.client.get(self.url_for('ART_ALICE_1'))
        self.assertEqual(resp.status_code, 500)
        self.assertEqual(resp.json(), {'error': 'Error fetching artwork'})
