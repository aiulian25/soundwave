"""URL configuration for local audio files"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from audio.views_local import LocalAudioViewSet, LocalAudioPlaylistViewSet

router = DefaultRouter()
router.register(r'local-audio', LocalAudioViewSet, basename='local-audio')
router.register(r'local-playlists', LocalAudioPlaylistViewSet, basename='local-playlists')

urlpatterns = [
    path('', include(router.urls)),
]
