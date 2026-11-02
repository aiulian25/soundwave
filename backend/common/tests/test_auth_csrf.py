"""CSRF enforcement across the two authentication modes (CODE_REVIEW_REPORT Step 18).

`CsrfExemptSessionAuthentication` used to skip the CSRF check whenever an Authorization
header was merely PRESENT -- a cookie-authenticated request can carry one too, so any
cross-site form that set a junk header would have been exempted. Cookie auth now always
enforces CSRF, and token auth is listed first so header clients never reach session auth.

The SPA is unaffected: it sends no Authorization header at all (cookie + X-CSRFToken only),
and widget/API clients send the header with no cookie. The two modes never overlap.

Run: python manage.py test common.tests --settings=config.settings_test
"""
from django.conf import settings
from django.core.cache import cache
from django.test import Client, TestCase, override_settings
from rest_framework.authtoken.models import Token

from user.models import Account

# Any ApiBaseView POST endpoint exercises the shared authentication_classes.
CSRF_PROTECTED_ENDPOINT = '/api/radio/stop/'
CSRF_COOKIE_ENDPOINT = '/api/user/csrf/'


class CookieAuthCsrfTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = Account.objects.create_user('csrf_u', 'csrf@test.local', 'Csrfpw_2026!')

    def test_session_post_without_a_csrf_token_is_rejected(self):
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.user)

        response = client.post(CSRF_PROTECTED_ENDPOINT, {}, content_type='application/json')

        self.assertEqual(response.status_code, 403)

    def test_a_junk_authorization_header_does_not_exempt_a_cookie_request(self):
        """The regression this step closed: header presence alone used to skip the check."""
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.user)

        response = client.post(
            CSRF_PROTECTED_ENDPOINT, {}, content_type='application/json',
            HTTP_AUTHORIZATION='Token not-a-real-token',
        )

        self.assertNotEqual(response.status_code, 200)

    def test_session_post_with_a_csrf_token_is_accepted(self):
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.user)
        client.get(CSRF_COOKIE_ENDPOINT)  # @ensure_csrf_cookie — seeds the cookie the SPA reads
        csrf_token = client.cookies['csrftoken'].value

        response = client.post(
            CSRF_PROTECTED_ENDPOINT, {}, content_type='application/json',
            HTTP_X_CSRFTOKEN=csrf_token,
        )

        self.assertEqual(response.status_code, 200)


class TokenAuthCsrfTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = Account.objects.create_user('token_u', 'token@test.local', 'Tokenpw_2026!')
        cls.token = Token.objects.create(user=cls.user)

    def test_token_post_without_a_cookie_or_csrf_token_is_accepted(self):
        client = Client(enforce_csrf_checks=True)

        response = client.post(
            CSRF_PROTECTED_ENDPOINT, {}, content_type='application/json',
            HTTP_AUTHORIZATION=f'Token {self.token.key}',
        )

        self.assertEqual(response.status_code, 200)

    def test_an_invalid_token_is_rejected_rather_than_falling_through(self):
        client = Client(enforce_csrf_checks=True)

        response = client.post(
            CSRF_PROTECTED_ENDPOINT, {}, content_type='application/json',
            HTTP_AUTHORIZATION='Token deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        )

        self.assertEqual(response.status_code, 401)

    def test_anonymous_post_is_rejected(self):
        response = Client().post(CSRF_PROTECTED_ENDPOINT, {}, content_type='application/json')

        self.assertIn(response.status_code, (401, 403))


class LoginFromAnotherSiteTests(TestCase):
    """A hostile page's form could otherwise log the browser into the attacker's account."""

    LOGIN_ENDPOINT = '/api/user/login/'
    USERNAME = 'origin_u'
    PASSWORD = 'Originpw_2026!'

    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        Account.objects.create_user(self.USERNAME, 'origin@test.local', self.PASSWORD)

    def _login(self, **headers):
        client = Client()
        response = client.post(
            self.LOGIN_ENDPOINT, {'username': self.USERNAME, 'password': self.PASSWORD}, **headers,
        )
        return response, client

    def test_another_sites_form_is_refused_and_sets_no_session(self):
        for origin in ('https://evil.example', 'null', 'http://testserver.evil.example'):
            with self.subTest(origin):
                response, client = self._login(HTTP_ORIGIN=origin)

                self.assertEqual(response.status_code, 403)
                self.assertNotIn(settings.SESSION_COOKIE_NAME, client.cookies)

    def test_the_app_itself_can_log_in_over_either_scheme(self):
        for origin in ('http://testserver', 'https://testserver'):
            with self.subTest(origin):
                response, client = self._login(HTTP_ORIGIN=origin)

                self.assertEqual(response.status_code, 200)
                self.assertIn(settings.SESSION_COOKIE_NAME, client.cookies)

    @override_settings(PASSKEY_ALLOWED_ORIGINS=['https://music.example'])
    def test_a_configured_public_address_can_log_in(self):
        response, _client = self._login(HTTP_ORIGIN='https://music.example')

        self.assertEqual(response.status_code, 200)

    def test_clients_that_send_no_origin_are_unaffected(self):
        response, _client = self._login()

        self.assertEqual(response.status_code, 200)
