"""Common views"""

from urllib.parse import urlparse
from django.conf import settings
from django.http import HttpResponse, JsonResponse
from django.views.decorators.http import require_GET
from rest_framework.permissions import IsAdminUser, IsAuthenticated
from rest_framework.views import APIView
from common.authentication import CsrfExemptSessionAuthentication, CsrfExemptTokenAuthentication


@require_GET
def ping(request):
    """Unauthenticated health check endpoint for Docker HEALTHCHECK."""
    return JsonResponse({"status": "ok"})


def _get_public_base_url(request):
    """Resolve the canonical public base URL from SW_HOST with request fallback."""
    sw_host = (getattr(settings, 'SW_HOST', '') or '').strip()
    if sw_host:
        parsed = urlparse(sw_host)
        if parsed.scheme in {'http', 'https'} and parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}".rstrip('/')

    return request.build_absolute_uri('/').rstrip('/')


@require_GET
def sitemap_xml(request):
    """Return a dynamic sitemap that matches the deployed host."""
    base_url = _get_public_base_url(request)
    routes = [
        ('/', 'daily', '1.0'),
        ('/search', 'daily', '0.8'),
        ('/library', 'daily', '0.8'),
        ('/favorites', 'daily', '0.7'),
        ('/local-files', 'weekly', '0.7'),
        ('/settings', 'monthly', '0.5'),
    ]

    url_entries = []
    for route, changefreq, priority in routes:
        url_entries.append(
            "  <url>\n"
            f"    <loc>{base_url}{route}</loc>\n"
            f"    <changefreq>{changefreq}</changefreq>\n"
            f"    <priority>{priority}</priority>\n"
            "  </url>"
        )

    xml = (
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
        "<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n"
        + "\n".join(url_entries)
        + "\n</urlset>\n"
    )

    response = HttpResponse(xml, content_type='application/xml; charset=utf-8')
    response['Cache-Control'] = 'public, max-age=3600'
    return response


@require_GET
def robots_txt(request):
    """Return robots.txt with a sitemap URL matching the deployed host."""
    base_url = _get_public_base_url(request)
    content = (
        "User-agent: *\n"
        "Allow: /\n\n"
        "# Disallow admin and API endpoints\n"
        "Disallow: /api/\n"
        "Disallow: /admin/\n\n"
        "# Sitemap\n"
        f"Sitemap: {base_url}/sitemap.xml\n"
    )

    response = HttpResponse(content, content_type='text/plain; charset=utf-8')
    response['Cache-Control'] = 'public, max-age=3600'
    return response


class ApiBaseView(APIView):
    """Base API view - TubeArchivist pattern"""
    authentication_classes = [CsrfExemptSessionAuthentication, CsrfExemptTokenAuthentication]
    permission_classes = [IsAuthenticated]


class AdminOnly(IsAdminUser):
    """Admin only permission"""
    pass


class AdminWriteOnly(IsAuthenticated):
    """Allow all authenticated users to read and write their own data"""

    def has_permission(self, request, view):
        # All authenticated users can perform any action
        # Data isolation is enforced at the view/queryset level via owner field
        return request.user and request.user.is_authenticated
