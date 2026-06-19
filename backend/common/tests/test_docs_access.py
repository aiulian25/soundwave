"""APP-06: the OpenAPI schema and Swagger UI must be admin-only, not public.

Run: python manage.py test common.tests --settings=config.settings_test
"""

from django.test import TestCase
from rest_framework.test import APIClient

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
