"""BOLA / multi-tenant isolation regression tests (APP-04).

Codifies the manual Phase-2 check from SECURITY_ASSESSMENT.md: two low-privilege
users must not be able to read or mutate each other's objects, list endpoints must
not leak another tenant's items, admin endpoints must reject non-admins, and a
non-admin must not be able to escalate their own privileges.

Run: python manage.py test --settings=config.settings_test
"""

from django.test import TestCase
from rest_framework.test import APIClient

from user.models import Account, APIKey
from download.models import DownloadQueue
from playlist.models import Playlist
from channel.models import Channel


class BolaIsolationTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.alice = Account.objects.create_user('alice', 'alice@test.local', 'Alicepw_2026!')
        cls.bob = Account.objects.create_user('bob', 'bob@test.local', 'Bobpw_2026!')

        # Resources owned by alice, each tagged with a unique token we can search for.
        cls.alice_key, _raw = APIKey.create_for_user(cls.alice, name='alice-key')
        cls.alice_download = DownloadQueue.objects.create(
            owner=cls.alice, url='https://www.youtube.com/watch?v=ALICEONLY01', status='pending',
        )
        cls.alice_playlist = Playlist.objects.create(
            owner=cls.alice, playlist_id='PL_ALICE_ONLY', title='Alice Playlist',
        )
        cls.alice_channel = Channel.objects.create(
            owner=cls.alice, channel_id='UC_ALICE_ONLY', channel_name='Alice Channel', subscribed=True,
        )

    def client_for(self, user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    # --- authentication baseline -------------------------------------------------
    def test_anonymous_is_denied(self):
        resp = APIClient().get('/api/audio/')
        self.assertIn(resp.status_code, (401, 403))

    # --- object-level BOLA (the core check) -------------------------------------
    def test_bob_cannot_read_alice_api_key(self):
        resp = self.client_for(self.bob).get(f'/api/user/api-keys/{self.alice_key.id}/')
        self.assertEqual(resp.status_code, 404)

    def test_bob_cannot_delete_alice_api_key(self):
        resp = self.client_for(self.bob).delete(f'/api/user/api-keys/{self.alice_key.id}/')
        self.assertEqual(resp.status_code, 404)
        self.assertTrue(APIKey.objects.filter(id=self.alice_key.id).exists())

    # --- list endpoints must not leak another tenant's items --------------------
    def test_list_endpoints_do_not_leak_across_tenants(self):
        bob = self.client_for(self.bob)
        leaks = {
            '/api/user/api-keys/': self.alice_key.key_prefix,
            '/api/download/?filter=pending': 'ALICEONLY01',
            '/api/playlist/': 'PL_ALICE_ONLY',
            '/api/channel/': 'UC_ALICE_ONLY',
        }
        for path, token in leaks.items():
            resp = bob.get(path)
            self.assertEqual(resp.status_code, 200, f'{path} -> {resp.status_code}')
            self.assertNotIn(token, resp.content.decode(), f"{path} leaked alice's data to bob")

    def test_owner_sees_their_own_items(self):
        # Positive control: filtering isn't just returning empty for everyone.
        resp = self.client_for(self.alice).get('/api/playlist/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('PL_ALICE_ONLY', resp.content.decode())

    # --- admin surface + privilege escalation -----------------------------------
    def test_non_admin_cannot_list_users(self):
        resp = self.client_for(self.bob).get('/api/user/admin/users/')
        self.assertEqual(resp.status_code, 403)

    def test_non_admin_cannot_self_escalate(self):
        resp = self.client_for(self.bob).patch(
            f'/api/user/admin/users/{self.bob.id}/',
            {'is_admin': True, 'is_superuser': True},
            format='json',
        )
        self.assertEqual(resp.status_code, 403)
        self.bob.refresh_from_db()
        self.assertFalse(self.bob.is_admin)
        self.assertFalse(self.bob.is_superuser)
