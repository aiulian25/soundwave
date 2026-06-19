"""APP-08: login lockout is keyed on (client IP + username) and the client IP is
resolved safely, so an attacker cannot lock a victim out, nor spoof their IP to
evade the lockout/throttle.

Run: python manage.py test common.tests --settings=config.settings_test
"""

from django.test import TestCase, Client, RequestFactory, override_settings
from django.core.cache import cache

from user.models import Account
from common.rate_limiter import get_client_ip, MAX_LOGIN_ATTEMPTS


class LoginLockoutKeyingTests(TestCase):
    ATTACKER_IP = '203.0.113.50'
    VICTIM_IP = '198.51.100.20'

    def setUp(self):
        cache.clear()  # locmem cache persists across tests; isolate lockout state
        self.password = 'Victim-Strong_2026!'
        self.user = Account.objects.create_user('lockout_user', 'lo@test.local', self.password)
        self.client = Client()

    def _login(self, password, ip):
        return self.client.post(
            '/api/user/login/',
            {'username': 'lockout_user', 'password': password},
            content_type='application/json',
            REMOTE_ADDR=ip,
        )

    def test_attacker_ip_lockout_does_not_block_victim_from_other_ip(self):
        # Attacker hammers the victim's username from their own IP until locked.
        for _ in range(MAX_LOGIN_ATTEMPTS):
            self._login('wrong-password', self.ATTACKER_IP)
        self.assertEqual(self._login('wrong-password', self.ATTACKER_IP).status_code, 429)

        # The victim, from a DIFFERENT IP, is NOT locked out and can log in.
        resp = self._login(self.password, self.VICTIM_IP)
        self.assertEqual(resp.status_code, 200)

    def test_generic_error_no_user_enumeration(self):
        # Wrong password for a real user and a non-existent user both return the
        # same generic 401 (no username enumeration).
        cache.clear()
        real = self.client.post('/api/user/login/', {'username': 'lockout_user', 'password': 'nope'},
                                content_type='application/json', REMOTE_ADDR='192.0.2.10')
        fake = self.client.post('/api/user/login/', {'username': 'ghost_user', 'password': 'nope'},
                                content_type='application/json', REMOTE_ADDR='192.0.2.11')
        self.assertEqual(real.status_code, 401)
        self.assertEqual(fake.status_code, 401)


class ClientIpResolutionTests(TestCase):
    def setUp(self):
        self.rf = RequestFactory()

    def _req(self, remote_addr, xff=None):
        headers = {'REMOTE_ADDR': remote_addr}
        if xff is not None:
            headers['HTTP_X_FORWARDED_FOR'] = xff
        return self.rf.get('/', **headers)

    @override_settings(NUM_PROXIES=None)
    def test_default_uses_remote_addr_without_xff(self):
        self.assertEqual(get_client_ip(self._req('10.0.0.9')), '10.0.0.9')

    @override_settings(NUM_PROXIES=0)
    def test_zero_proxies_ignores_xff(self):
        # Spoofed XFF must be ignored entirely.
        ip = get_client_ip(self._req('10.0.0.9', xff='1.1.1.1, 2.2.2.2'))
        self.assertEqual(ip, '10.0.0.9')

    @override_settings(NUM_PROXIES=1)
    def test_one_proxy_uses_rightmost_real_client(self):
        # XFF = "spoofed, real_client" — our single trusted proxy appended the real
        # client on the right; the spoofed left entry must be ignored.
        ip = get_client_ip(self._req('10.0.0.1', xff='6.6.6.6, 203.0.113.7'))
        self.assertEqual(ip, '203.0.113.7')
