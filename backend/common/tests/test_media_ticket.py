"""Tests for the signed, short-lived media ticket (APP-05).

Verifies that media URLs use an expiring signature, that stolen/expired/mismatched
tickets stop working, and that the old long-lived ?token= query auth is gone.

Run: python manage.py test common.tests --settings=config.settings_test
"""

import os

from django.conf import settings
from django.test import TestCase, Client, override_settings
from django.utils import timezone
from rest_framework.authtoken.models import Token

from user.models import Account
from audio.models import Audio
from common.streaming import make_media_ticket, resolve_media_ticket, user_can_access_media


def make_audio(owner, file_path, youtube_id='vid0001'):
    return Audio.objects.create(
        owner=owner, youtube_id=youtube_id, title='T', channel_id='UC', channel_name='C',
        duration=10, file_path=file_path, file_size=100, published_date=timezone.now(),
    )


class MediaTicketUnitTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = Account.objects.create_user('mt_user', 'mt@test.local', 'Pw_2026!aA')

    def test_roundtrip_valid(self):
        ticket = make_media_ticket(self.user, 'chan/song-abc.m4a')
        user, err = resolve_media_ticket('chan/song-abc.m4a', ticket)
        self.assertIsNone(err)
        self.assertEqual(user.pk, self.user.pk)

    def test_wrong_path_rejected(self):
        ticket = make_media_ticket(self.user, 'chan/song-abc.m4a')
        user, err = resolve_media_ticket('chan/other-song.m4a', ticket)
        self.assertIsNone(user)
        self.assertIsNotNone(err)

    def test_tampered_ticket_rejected(self):
        ticket = make_media_ticket(self.user, 'a.m4a') + 'tamper'
        user, err = resolve_media_ticket('a.m4a', ticket)
        self.assertIsNone(user)

    @override_settings(MEDIA_TICKET_TTL=-1)
    def test_expired_ticket_rejected(self):
        ticket = make_media_ticket(self.user, 'a.m4a')
        user, err = resolve_media_ticket('a.m4a', ticket)
        self.assertIsNone(user)
        self.assertEqual(err, 'Media link expired')


class MediaServeAuthTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = Account.objects.create_user('mt2', 'mt2@test.local', 'Pw_2026!aA')

    def setUp(self):
        self.client = Client()

    def test_valid_ticket_streams_existing_file(self):
        os.makedirs(settings.MEDIA_ROOT, exist_ok=True)
        fpath = os.path.join(settings.MEDIA_ROOT, 'play.m4a')
        with open(fpath, 'wb') as fh:
            fh.write(b'\x00\x01\x02soundwave-test')
        make_audio(self.user, 'play.m4a')  # ownership (APP-05) so access is allowed
        try:
            ticket = make_media_ticket(self.user, 'play.m4a')
            resp = self.client.get('/media/play.m4a', {'t': ticket})
            self.assertIn(resp.status_code, (200, 206))
            # APP-11: the media response must not carry a wildcard ACAO.
            self.assertNotEqual(resp.headers.get('Access-Control-Allow-Origin'), '*')
        finally:
            os.remove(fpath)


    def test_legacy_token_query_param_rejected(self):
        # The old ?token=<long-lived DRF token> must no longer authenticate.
        token = Token.objects.create(user=self.user)
        resp = self.client.get('/media/missing.m4a', {'token': token.key})
        self.assertEqual(resp.status_code, 403)

    def test_no_auth_rejected(self):
        resp = self.client.get('/media/missing.m4a')
        self.assertEqual(resp.status_code, 403)

    @override_settings(MEDIA_TICKET_TTL=-1)
    def test_expired_ticket_serve_rejected(self):
        ticket = make_media_ticket(self.user, 'missing.m4a')
        resp = self.client.get('/media/missing.m4a', {'t': ticket})
        self.assertEqual(resp.status_code, 403)


class MediaOwnershipTests(TestCase):
    """APP-05 media-IDOR: a user can only stream media they own."""

    @classmethod
    def setUpTestData(cls):
        cls.alice = Account.objects.create_user('mo_alice', 'a@test.local', 'Pw_2026!aa')
        cls.bob = Account.objects.create_user('mo_bob', 'b@test.local', 'Pw_2026!bb')
        cls.admin = Account.objects.create_superuser('mo_admin', 'ad@test.local', 'Pw_2026!cc')
        cls.path = 'alicechan/song-xyz.m4a'
        make_audio(cls.alice, cls.path)

    def test_owner_authorized(self):
        self.assertTrue(user_can_access_media(self.alice, self.path))

    def test_non_owner_denied(self):
        self.assertFalse(user_can_access_media(self.bob, self.path))

    def test_admin_authorized(self):
        self.assertTrue(user_can_access_media(self.admin, self.path))

    def test_owner_streams_via_http(self):
        # End-to-end through the media view, using a (path-bound) ticket for auth.
        os.makedirs(os.path.join(settings.MEDIA_ROOT, 'alicechan'), exist_ok=True)
        full = os.path.join(settings.MEDIA_ROOT, self.path)
        with open(full, 'wb') as fh:
            fh.write(b'audio-bytes-xyz')
        try:
            ticket = make_media_ticket(self.alice, self.path)
            resp = Client().get('/media/' + self.path, {'t': ticket})
            self.assertIn(resp.status_code, (200, 206))
        finally:
            os.remove(full)
