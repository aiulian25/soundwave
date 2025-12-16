"""URL configuration for playlist downloads"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from playlist.views_download import PlaylistDownloadViewSet

router = DefaultRouter()
router.register(r'downloads', PlaylistDownloadViewSet, basename='playlist-downloads')

urlpatterns = [
    path('', include(router.urls)),
]
