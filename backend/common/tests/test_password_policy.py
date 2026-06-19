"""APP-07: Django password validators enforced on change and admin-create,
with stable codes for SPA localization.

Run: python manage.py test common.tests --settings=config.settings_test
"""

from django.test import TestCase
from rest_framework.test import APIClient

from user.models import Account
from user.password_policy import check_password_strength


class PasswordPolicyHelperTests(TestCase):
    def test_common_password_rejected(self):
        messages, codes = check_password_strength('password')
        self.assertIn('password_too_common', codes)

    def test_short_password_rejected(self):
        messages, codes = check_password_strength('a1B!')
        self.assertIn('password_too_short', codes)

    def test_entirely_numeric_rejected(self):
        messages, codes = check_password_strength('918273645')
        self.assertIn('password_entirely_numeric', codes)

    def test_strong_password_accepted(self):
        messages, codes = check_password_strength('Tr0ub4dour-ZX9q')
        self.assertIsNone(codes)


class ChangePasswordValidationTests(TestCase):
    def setUp(self):
        self.user = Account.objects.create_user('pp_user', 'pp@test.local', 'Initial-Pw_2026!')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_weak_new_password_rejected_with_code(self):
        resp = self.client.post('/api/user/change-password/', {
            'current_password': 'Initial-Pw_2026!',
            'new_password': 'password1',  # too common
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('password_too_common', resp.json().get('password_codes', []))
        # Password must be unchanged.
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('Initial-Pw_2026!'))

    def test_strong_new_password_accepted(self):
        resp = self.client.post('/api/user/change-password/', {
            'current_password': 'Initial-Pw_2026!',
            'new_password': 'Zephyr9-Quokka_42x',
        }, format='json')
        self.assertEqual(resp.status_code, 200)


class AdminCreateValidationTests(TestCase):
    def setUp(self):
        self.admin = Account.objects.create_superuser('pp_admin', 'ppa@test.local', 'Admin-Pw_2026!')
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def test_admin_create_weak_password_rejected(self):
        resp = self.client.post('/api/user/admin/users/', {
            'username': 'weakling',
            'email': 'weak@test.local',
            'password': 'password1',
            'password_confirm': 'password1',
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('password_too_common', resp.json().get('password_codes', []))
        self.assertFalse(Account.objects.filter(username='weakling').exists())

    def test_admin_create_strong_password_accepted(self):
        resp = self.client.post('/api/user/admin/users/', {
            'username': 'stronguser',
            'email': 'strong@test.local',
            'password': 'Zephyr9-Quokka_42x',
            'password_confirm': 'Zephyr9-Quokka_42x',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertTrue(Account.objects.filter(username='stronguser').exists())
