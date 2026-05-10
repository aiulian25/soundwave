"""URL Configuration for SoundWave"""

from django.contrib import admin
from django.urls import include, path, re_path
from django.conf import settings
from django.conf.urls.static import static
from django.views.generic import TemplateView
from django.views.static import serve
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from common.streaming import serve_media_with_range
from common.views import robots_txt, sitemap_xml
import os

api_urlpatterns = [
    path("", include("common.urls")),
    path("audio/", include("audio.urls")),
    path("playback-sync/", include("audio.urls_playback_sync")),
    path("radio/", include("audio.urls_radio")),
    path("channel/", include("channel.urls")),
    path("playlist/", include("playlist.urls")),
    path("download/", include("download.urls")),
    path("task/", include("task.urls")),
    path("appsettings/", include("appsettings.urls")),
    path("stats/", include("stats.urls")),
    path("user/", include("user.urls")),
    path("schema/", SpectacularAPIView.as_view(), name="schema"),
    path("docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
]

urlpatterns = [
    path("api/", include(api_urlpatterns)),
    path("api/v1/", include(api_urlpatterns)),
    path('robots.txt', robots_txt, name='robots-txt'),
    path('sitemap.xml', sitemap_xml, name='sitemap-xml'),
    path("admin/", admin.site.urls),
]

# Serve static files
urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)

# Serve media files (audio files) with Range request support for seeking
if settings.MEDIA_URL and settings.MEDIA_ROOT:
    urlpatterns += [
        re_path(
            r'^media/(?P<path>.*)$',
            serve_media_with_range,
            {'document_root': settings.MEDIA_ROOT},
        ),
    ]

# Serve PWA files from frontend/dist
frontend_dist = settings.BASE_DIR.parent / 'frontend' / 'dist'
urlpatterns += [
    path('manifest.json', serve, {'path': 'manifest.json', 'document_root': frontend_dist}),
    path('service-worker.js', serve, {'path': 'service-worker.js', 'document_root': frontend_dist}),
    path('offline.html', serve, {'path': 'offline.html', 'document_root': frontend_dist}),
    path('jsmediatags.min.js', serve, {'path': 'jsmediatags.min.js', 'document_root': frontend_dist}),
    re_path(r'^img/(?P<path>.*)$', serve, {'document_root': frontend_dist / 'img'}),
    re_path(r'^avatars/(?P<path>.*)$', serve, {'document_root': frontend_dist / 'avatars'}),
    re_path(r'^locales/(?P<path>.*)$', serve, {'document_root': frontend_dist / 'locales'}),
    re_path(r'^assets/(?P<path>.*)$', serve, {'document_root': frontend_dist / 'assets'}),
]

# Serve React frontend - catch all routes (must be LAST)
urlpatterns += [
    re_path(r'^(?!api/|admin/|static/|media/|assets/|locales/).*$', 
            TemplateView.as_view(template_name='index.html'), 
            name='frontend'),
]
