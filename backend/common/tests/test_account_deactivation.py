"""SW-003: a suspended or deleted account loses every credential at once, including the
paths that do not go through ordinary API authentication (/media/ and API keys).

Run: python manage.py test common.tests.test_account_deactivation --settings=config.settings_test
"""
import os
from datetime import timedelta

from django.conf import settings
from django.test import Client, TestCase
from django.utils import timezone
from rest_framework.authtoken.models import Token

from audio.models import Audio
from audio.views import artwork_ticket_path
from common.streaming import make_media_ticket
from user.models import Account, APIKey

MEDIA_FILE = 'deactivation-test.m4a'
MEDIA_URL = f'/media/{MEDIA_FILE}'
ACCOUNT_URL = '/api/user/account/'
WIDGET_URL = '/api/stats/widget/'
ARTWORK_YOUTUBE_ID = 'vid_deact01'
ARTWORK_URL = f'/api/audio/{ARTWORK_YOUTUBE_ID}/artwork/'
OWNER_PASSWORD = 'Owner-Strong_2026!'
ALLOWED = (200, 206)


class CredentialMatrixTestCase(TestCase):
    def setUp(self):
        os.makedirs(settings.MEDIA_ROOT, exist_ok=True)
        self.media_path = os.path.join(settings.MEDIA_ROOT, MEDIA_FILE)
        with open(self.media_path, 'wb') as media_file:
            media_file.write(b'synthetic media bytes')
        self.addCleanup(os.remove, self.media_path)

        self.owner = Account.objects.create_user('deact_owner', 'deact@test.local', OWNER_PASSWORD)
        self.admin = Account.objects.create_superuser('deact_admin', 'deact_admin@test.local', OWNER_PASSWORD)
        Audio.objects.create(
            owner=self.owner, youtube_id=ARTWORK_YOUTUBE_ID, title='T', channel_id='UC', channel_name='C',
            duration=1, file_path=MEDIA_FILE, file_size=1, published_date=timezone.now(),
        )
        self.token_key = Token.objects.create(user=self.owner).key
        self.api_key, self.raw_api_key = APIKey.create_for_user(self.owner)

        self.session = Client()
        self.session.force_login(self.owner)
        self.admin_client = Client()
        self.admin_client.force_login(self.admin)

    def toggle_active(self):
        response = self.admin_client.post(f'/api/user/admin/users/{self.owner.pk}/toggle_active/')
        self.assertEqual(response.status_code, 200, response.content)

    def attempts(self):
        """Every way this account can reach something, as label -> status code."""
        anonymous = Client()
        token_header = {'HTTP_AUTHORIZATION': f'Token {self.token_key}'}
        api_key_header = {'HTTP_AUTHORIZATION': f'ApiKey {self.raw_api_key}'}
        ticket = make_media_ticket(self.owner, MEDIA_FILE)
        artwork_ticket = make_media_ticket(self.owner, artwork_ticket_path(ARTWORK_YOUTUBE_ID))
        return {
            'session on API': self.session.get(ACCOUNT_URL).status_code,
            'session on media': self.session.get(MEDIA_URL).status_code,
            'token on API': anonymous.get(ACCOUNT_URL, **token_header).status_code,
            'token on media': anonymous.get(MEDIA_URL, **token_header).status_code,
            'ticket on media': anonymous.get(MEDIA_URL, {'t': ticket}).status_code,
            'ticket on artwork': anonymous.get(ARTWORK_URL, {'t': artwork_ticket}).status_code,
            'API key header on widget': anonymous.get(WIDGET_URL, **api_key_header).status_code,
            'API key query on widget': anonymous.get(WIDGET_URL, {'key': self.raw_api_key}).status_code,
            'API key on artwork': anonymous.get(ARTWORK_URL, **api_key_header).status_code,
        }

    def assert_all_refused(self):
        for label, status_code in self.attempts().items():
            with self.subTest(label):
                self.assertIn(status_code, (401, 403), f'{label} got {status_code}')

    def assert_all_allowed(self):
        for label, status_code in self.attempts().items():
            with self.subTest(label):
                # Artwork has no image on this track, so reaching it means "No artwork", not 401.
                expected = (404,) if 'artwork' in label else ALLOWED
                self.assertIn(status_code, expected, f'{label} got {status_code}')


class SuspensionTests(CredentialMatrixTestCase):
    def test_active_account_keeps_every_credential(self):
        self.assert_all_allowed()

    def test_suspension_refuses_every_credential(self):
        self.toggle_active()
        self.assert_all_refused()

    def test_suspension_through_the_edit_form_refuses_every_credential(self):
        response = self.admin_client.patch(
            f'/api/user/admin/users/{self.owner.pk}/', {'is_active': False}, content_type='application/json'
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assert_all_refused()

    def test_reactivation_restores_credentials(self):
        self.toggle_active()
        self.toggle_active()
        self.assertTrue(Token.objects.filter(key=self.token_key).exists())
        self.assert_all_allowed()

    def test_password_login_is_refused_while_suspended(self):
        self.toggle_active()
        response = Client().post(
            '/api/user/login/',
            {'username': self.owner.username, 'password': OWNER_PASSWORD},
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 401)

    def test_refused_api_key_does_not_count_as_used(self):
        self.toggle_active()
        self.assertIsNone(APIKey.validate_key(self.raw_api_key))
        self.api_key.refresh_from_db()
        self.assertIsNone(self.api_key.last_used)

    def test_refusal_does_not_reveal_the_account_is_suspended(self):
        self.toggle_active()
        refused = Client().get(WIDGET_URL, {'key': self.raw_api_key})
        unknown = Client().get(WIDGET_URL, {'key': 'not-a-real-key'})
        self.assertEqual(refused.status_code, unknown.status_code)
        self.assertEqual(refused.json(), unknown.json())


class DeletedAccountTests(CredentialMatrixTestCase):
    def test_deletion_refuses_every_credential(self):
        response = self.admin_client.delete(f'/api/user/admin/users/{self.owner.pk}/')
        self.assertEqual(response.status_code, 200, response.content)
        # Admin deletion removes the file with the sole owner; recreate it so a refusal
        # below can only come from authentication, never from a missing file.
        with open(self.media_path, 'wb') as media_file:
            media_file.write(b'synthetic media bytes')
        self.assert_all_refused()


class NeighbouringMediaBehaviourTests(CredentialMatrixTestCase):
    def test_suspending_one_account_leaves_others_working(self):
        other = Account.objects.create_user('deact_other', 'other@test.local', OWNER_PASSWORD)
        Audio.objects.create(
            owner=other, youtube_id=ARTWORK_YOUTUBE_ID, title='T', channel_id='UC', channel_name='C',
            duration=1, file_path=MEDIA_FILE, file_size=1, published_date=timezone.now(),
        )
        other_token = Token.objects.create(user=other).key
        self.toggle_active()
        response = Client().get(MEDIA_URL, HTTP_AUTHORIZATION=f'Token {other_token}')
        self.assertIn(response.status_code, ALLOWED)

    def test_active_token_still_cannot_read_another_owners_file(self):
        stranger = Account.objects.create_user('deact_stranger', 'stranger@test.local', OWNER_PASSWORD)
        stranger_token = Token.objects.create(user=stranger).key
        response = Client().get(MEDIA_URL, HTTP_AUTHORIZATION=f'Token {stranger_token}')
        self.assertEqual(response.status_code, 404, 'cross-tenant media is hidden, not forbidden')

    def test_expired_and_unknown_tokens_are_refused_on_media(self):
        Token.objects.filter(key=self.token_key).update(
            created=timezone.now() - timedelta(hours=settings.TOKEN_EXPIRY_HOURS + 1)
        )
        for token_key in (self.token_key, 'not-a-real-token'):
            with self.subTest(token_key):
                response = Client().get(MEDIA_URL, HTTP_AUTHORIZATION=f'Token {token_key}')
                self.assertIn(response.status_code, (401, 403))
