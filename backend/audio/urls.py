"""Audio URL patterns"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from audio.views import (
    AudioListView,
    AudioDetailView,
    AudioPlayerView,
    AudioProgressView,
    AudioDownloadView,
    AudioExportView,
    MetadataSearchView,
    MetadataApplyView,
    MetadataAutoFetchView,
    ArtworkProxyView,
)
from audio.views_lyrics import LyricsViewSet, LyricsCacheViewSet, LyricsDownloadView, LyricsUploadView
from audio.views_recommendations import AudioRecommendationsView, AudioSimilarTracksView

# Create router for ViewSets
router = DefaultRouter()
router.register(r'lyrics', LyricsViewSet, basename='lyrics')
router.register(r'lyrics-cache', LyricsCacheViewSet, basename='lyrics-cache')

urlpatterns = [
    # YouTube audio endpoints (specific paths first)
    path('list/', AudioListView.as_view(), name='audio-list'),
    path('<str:youtube_id>/player/', AudioPlayerView.as_view(), name='audio-player'),
    path('<str:youtube_id>/progress/', AudioProgressView.as_view(), name='audio-progress'),
    path('<str:youtube_id>/download/', AudioDownloadView.as_view(), name='audio-download'),
    path('<str:youtube_id>/export/', AudioExportView.as_view(), name='audio-export'),
    path('<str:youtube_id>/artwork/', ArtworkProxyView.as_view(), name='audio-artwork'),
    path('<str:youtube_id>/recommendations/', AudioRecommendationsView.as_view(), name='audio-recommendations'),
    path('<str:youtube_id>/similar/', AudioSimilarTracksView.as_view(), name='audio-similar'),
    # Metadata endpoints
    path('<str:youtube_id>/metadata/search/', MetadataSearchView.as_view(), name='audio-metadata-search'),
    path('<str:youtube_id>/metadata/apply/', MetadataApplyView.as_view(), name='audio-metadata-apply'),
    path('<str:youtube_id>/metadata/auto/', MetadataAutoFetchView.as_view(), name='audio-metadata-auto'),
    # Lyrics endpoints - specific paths first, then generic
    path('<str:youtube_id>/lyrics/fetch/', LyricsViewSet.as_view({
        'post': 'fetch',
    }), name='audio-lyrics-fetch'),
    path('<str:youtube_id>/lyrics/suggestions/', LyricsViewSet.as_view({
        'get': 'suggestions',
    }), name='audio-lyrics-suggestions'),
    path('<str:youtube_id>/lyrics/apply/', LyricsViewSet.as_view({
        'post': 'apply_suggestion',
    }), name='audio-lyrics-apply'),
    path('<str:youtube_id>/lyrics/upload/', LyricsUploadView.as_view(), name='audio-lyrics-upload'),
    path('<str:youtube_id>/lyrics/download/', LyricsDownloadView.as_view(), name='audio-lyrics-download'),
    path('<str:youtube_id>/lyrics/', LyricsViewSet.as_view({
        'get': 'retrieve',
        'put': 'update_lyrics',
        'patch': 'update_lyrics',
        'delete': 'delete_lyrics',
    }), name='audio-lyrics'),
    path('<str:youtube_id>/', AudioDetailView.as_view(), name='audio-detail'),
    
    # Include sub-apps LAST (they have root patterns that catch everything)
    # Local audio endpoints
    path('', include('audio.urls_local')),
    # Quick Sync endpoints
    path('', include('audio.urls_quick_sync')),
    # Artwork and metadata endpoints
    path('api/', include('audio.urls_artwork')),
    # Include router URLs for batch operations
    path('', include(router.urls)),
]
