"""APP-06: the OpenAPI schema and Swagger UI must be admin-only, not public.

Run: python manage.py test common.tests --settings=config.settings_test
"""

import tempfile
from pathlib import Path

from django.contrib.auth.models import AnonymousUser
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient, APIRequestFactory

from audio.serializers_artwork import ArtworkSerializer

from user.models import Account


class SchemaDocsAccessTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = Account.objects.create_user('docs_user', 'du@test.local', 'Pw_2026!aA')
        cls.admin = Account.objects.create_superuser('docs_admin', 'da@test.local', 'Pw_2026!aA')

    def test_schema_denied_anonymous(self):
        resp = APIClient().get('/api/schema/')
        self.assertIn(resp.status_code, (401, 403))

    def test_schema_denied_non_admin(self):
        client = APIClient()
        client.force_authenticate(user=self.user)
        resp = client.get('/api/schema/')
        self.assertEqual(resp.status_code, 403)

    def test_schema_allowed_for_admin(self):
        client = APIClient()
        client.force_authenticate(user=self.admin)
        resp = client.get('/api/schema/')
        self.assertEqual(resp.status_code, 200)

    def test_schema_and_docs_views_are_admin_gated(self):
        # SERVE_PERMISSIONS is applied to BOTH the schema and Swagger UI views.
        # Assert via permission introspection (avoids rendering the Swagger HTML
        # template, which trips a Python 3.14-only test-client bug; the HTTP-level
        # 403/200 behaviour is covered by the schema tests above and runs in CI).
        from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
        from common.permissions import CanManageUsers
        for view_cls in (SpectacularAPIView, SpectacularSwaggerView):
            perms = view_cls().get_permissions()
            self.assertTrue(
                any(isinstance(p, CanManageUsers) for p in perms),
                f'{view_cls.__name__} is not gated by CanManageUsers',
            )


class SchemaGenerationTests(TestCase):
    """Without a signed-in user (the `spectacular` command, `check --deploy`) generation used to raise."""

    def test_the_schema_is_generated_with_nobody_signed_in(self):
        with tempfile.TemporaryDirectory() as folder:
            schema_file = Path(folder) / 'schema.yml'

            call_command('spectacular', '--file', str(schema_file))

            schema = schema_file.read_text()
        self.assertIn('/api/audio/api/artwork/', schema)
        self.assertIn('/api/playlist/', schema)

    def test_artwork_offers_nothing_to_attach_to_when_nobody_is_signed_in(self):
        owner = Account.objects.create_user('schema_owner', 'so@test.local', 'Pw_2026!aA')
        owner.channels.create(channel_id='UC_SCHEMA', channel_name='Owned', subscribed=True)
        request = APIRequestFactory().get('/api/audio/api/artwork/')
        request.user = AnonymousUser()

        fields = ArtworkSerializer(context={'request': request}).fields

        self.assertFalse(fields['audio'].queryset.exists())
        self.assertFalse(fields['channel'].queryset.exists())

    def test_a_signed_in_user_is_still_offered_only_their_own(self):
        owner = Account.objects.create_user('schema_owner', 'so@test.local', 'Pw_2026!aA')
        stranger = Account.objects.create_user('schema_stranger', 'ss@test.local', 'Pw_2026!aA')
        owned = owner.channels.create(channel_id='UC_SCHEMA', channel_name='Owned', subscribed=True)
        stranger.channels.create(channel_id='UC_OTHER', channel_name='Theirs', subscribed=True)
        request = APIRequestFactory().get('/api/audio/api/artwork/')
        request.user = owner

        fields = ArtworkSerializer(context={'request': request}).fields

        self.assertEqual(list(fields['channel'].queryset), [owned])
