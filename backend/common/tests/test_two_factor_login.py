"""Signing in with two-factor enabled: the password alone is never enough.

Run: python manage.py test common.tests.test_two_factor_login --settings=config.settings_test
"""
import pyotp
from django.conf import settings
from django.core.cache import cache
from django.test import Client, TestCase

from common.rate_limiter import MAX_LOGIN_ATTEMPTS
from user.models import Account
from user.two_factor import encrypt_secret, generate_backup_codes, generate_totp_secret, hash_backup_codes

LOGIN_URL = '/api/user/login/'
ACCOUNT_URL = '/api/user/account/'
USERNAME = 'two_factor_u'
PASSWORD = 'Twofactorpw_2026!'
WRONG_CODE = '000000'


class TwoFactorLoginTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.secret = generate_totp_secret()
        self.backup_codes = generate_backup_codes()
        self.user = Account.objects.create_user(USERNAME, 'two_factor_u@test.local', PASSWORD)
        self.user.two_factor_enabled = True
        self.user.two_factor_secret = encrypt_secret(self.secret)
        self.user.backup_codes = hash_backup_codes(self.backup_codes)
        self.user.save()
        self.client = Client()

    def _login(self, **extra):
        return self.client.post(
            LOGIN_URL, {'username': USERNAME, 'password': PASSWORD, **extra}, content_type='application/json',
        )

    def _is_signed_in(self):
        return settings.SESSION_COOKIE_NAME in self.client.cookies and self.client.get(ACCOUNT_URL).status_code == 200

    def test_the_password_alone_asks_for_a_code_and_signs_nobody_in(self):
        response = self._login()

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['requires_2fa'])
        self.assertNotIn('user', response.json())
        self.assertFalse(self._is_signed_in())

    def test_the_current_code_signs_in(self):
        response = self._login(two_factor_code=pyotp.TOTP(self.secret).now())

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['user']['username'], USERNAME)
        self.assertTrue(self._is_signed_in())

    def test_a_wrong_code_is_refused(self):
        response = self._login(two_factor_code=WRONG_CODE)

        self.assertEqual(response.status_code, 401)
        self.assertFalse(self._is_signed_in())

    def test_wrong_codes_count_towards_the_lockout_like_wrong_passwords(self):
        statuses = [self._login(two_factor_code=WRONG_CODE).status_code for _attempt in range(MAX_LOGIN_ATTEMPTS)]

        locked_out_with_the_right_code = self._login(two_factor_code=pyotp.TOTP(self.secret).now())

        self.assertEqual(statuses[-1], 429)
        self.assertEqual(locked_out_with_the_right_code.status_code, 429)
        self.assertFalse(self._is_signed_in())

    def test_a_backup_code_signs_in_once_and_only_once(self):
        backup_code = self.backup_codes[0]

        first = self._login(two_factor_code=backup_code)
        self.client = Client()
        second = self._login(two_factor_code=backup_code)

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 401)
        self.user.refresh_from_db()
        self.assertEqual(len(self.user.backup_codes), len(self.backup_codes) - 1)

    def test_a_code_cannot_stand_in_for_the_password(self):
        response = self.client.post(
            LOGIN_URL,
            {'username': USERNAME, 'password': 'not-the-password', 'two_factor_code': pyotp.TOTP(self.secret).now()},
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 401)
        self.assertFalse(self._is_signed_in())
