"""URL configuration for artwork and metadata"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from audio.views_artwork import (
    ArtworkViewSet,
    MusicMetadataViewSet,
    ArtistInfoViewSet,
    AudioArtworkViewSet,
    ChannelArtworkViewSet,
)

router = DefaultRouter()
router.register(r'artwork', ArtworkViewSet, basename='artwork')
router.register(r'metadata', MusicMetadataViewSet, basename='metadata')
router.register(r'artist-info', ArtistInfoViewSet, basename='artist-info')
router.register(r'audio-artwork', AudioArtworkViewSet, basename='audio-artwork')
router.register(r'channel-artwork', ChannelArtworkViewSet, basename='channel-artwork')

urlpatterns = [
    path('', include(router.urls)),
]
