"""APP-10: email-change verification — new address only applies after the signed
confirmation link is followed.

Run: python manage.py test common.tests --settings=config.settings_test
"""

import re

from django.test import TestCase, override_settings
from django.core import mail
from rest_framework.test import APIClient

from user.models import Account

LOCMEM = 'django.core.mail.backends.locmem.EmailBackend'


@override_settings(EMAIL_VERIFICATION_REQUIRED=True, EMAIL_BACKEND=LOCMEM,
                   DEFAULT_FROM_EMAIL='SoundWave <no-reply@test>', SW_HOST='http://localhost:8889')
class EmailChangeVerificationTests(TestCase):
    def setUp(self):
        mail.outbox = []
        self.password = 'Owner-Strong_2026!'
        self.user = Account.objects.create_user('mailer', 'old@test.local', self.password)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _request_change(self, new_email='new@test.local'):
        return self.client.patch('/api/user/profile/', {
            'email': new_email,
            'current_password': self.password,
            'language': 'en',
        }, format='json')

    def _token_from_outbox(self):
        match = re.search(r'token=([\w:\-\.]+)', mail.outbox[-1].body)
        return match.group(1) if match else None

    def test_change_request_sets_pending_and_sends_email(self):
        resp = self._request_change('new@test.local')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json().get('code'), 'email_confirmation_sent')
        self.user.refresh_from_db()
        # Email NOT changed yet; pending recorded; one email sent to the NEW address.
        self.assertEqual(self.user.email, 'old@test.local')
        self.assertEqual(self.user.pending_email, 'new@test.local')
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ['new@test.local'])

    def test_confirm_applies_change(self):
        self._request_change('new@test.local')
        token = self._token_from_outbox()
        self.assertIsNotNone(token)
        resp = APIClient().post('/api/user/email/confirm/', {'token': token}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json().get('code'), 'confirmed')
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, 'new@test.local')
        self.assertIsNone(self.user.pending_email)

    def test_invalid_token_rejected(self):
        self._request_change('new@test.local')
        resp = APIClient().post('/api/user/email/confirm/', {'token': 'garbage.token'}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json().get('code'), 'invalid')
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, 'old@test.local')

    def test_token_is_single_use(self):
        self._request_change('new@test.local')
        token = self._token_from_outbox()
        APIClient().post('/api/user/email/confirm/', {'token': token}, format='json')
        # Re-using the same link after the change is committed must fail.
        resp = APIClient().post('/api/user/email/confirm/', {'token': token}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_confirm_rejected_if_email_taken_meanwhile(self):
        # Request a free address, then someone else grabs it before confirmation.
        self._request_change('contested@test.local')
        token = self._token_from_outbox()
        Account.objects.create_user('squatter', 'contested@test.local', 'Squatter_2026!aa')
        resp = APIClient().post('/api/user/email/confirm/', {'token': token}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json().get('code'), 'email_taken')


@override_settings(EMAIL_VERIFICATION_REQUIRED=False)
class EmailChangeLegacyTests(TestCase):
    def setUp(self):
        self.password = 'Owner-Strong_2026!'
        self.user = Account.objects.create_user('legacy', 'old2@test.local', self.password)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_change_applies_immediately_without_verification(self):
        resp = self.client.patch('/api/user/profile/', {
            'email': 'imm@test.local', 'current_password': self.password,
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, 'imm@test.local')
