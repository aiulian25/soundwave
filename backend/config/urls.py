"""URL Configuration for SoundWave"""

from django.contrib import admin
from django.urls import include, path, re_path
from django.conf import settings
from django.conf.urls.static import static
from django.views.generic import TemplateView
from django.views.static import serve
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from common.streaming import serve_media_with_range
import os

urlpatterns = [
    path("api/", include("common.urls")),
    path("api/audio/", include("audio.urls")),
    path("api/channel/", include("channel.urls")),
    path("api/playlist/", include("playlist.urls")),
    path("api/download/", include("download.urls")),
    path("api/task/", include("task.urls")),
    path("api/appsettings/", include("appsettings.urls")),
    path("api/stats/", include("stats.urls")),
    path("api/user/", include("user.urls")),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path(
        "api/docs/",
        SpectacularSwaggerView.as_view(url_name="schema"),
        name="swagger-ui",
    ),
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
    re_path(r'^img/(?P<path>.*)$', serve, {'document_root': frontend_dist / 'img'}),
    re_path(r'^avatars/(?P<path>.*)$', serve, {'document_root': frontend_dist / 'avatars'}),
]

# Serve React frontend - catch all routes (must be LAST)
urlpatterns += [
    re_path(r'^(?!api/|admin/|static/|media/|assets/).*$', 
            TemplateView.as_view(template_name='index.html'), 
            name='frontend'),
]
