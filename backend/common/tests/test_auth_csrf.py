"""CSRF enforcement across the two authentication modes (CODE_REVIEW_REPORT Step 18).

`CsrfExemptSessionAuthentication` used to skip the CSRF check whenever an Authorization
header was merely PRESENT -- a cookie-authenticated request can carry one too, so any
cross-site form that set a junk header would have been exempted. Cookie auth now always
enforces CSRF, and token auth is listed first so header clients never reach session auth.

The SPA is unaffected: it sends no Authorization header at all (cookie + X-CSRFToken only),
and widget/API clients send the header with no cookie. The two modes never overlap.

Run: python manage.py test common.tests --settings=config.settings_test
"""
from django.test import TestCase, Client
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
