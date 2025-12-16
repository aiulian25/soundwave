"""Playlist URL patterns"""

from django.urls import path, include
from playlist.views import PlaylistListView, PlaylistDetailView

urlpatterns = [
    # Playlist download management - must come BEFORE catch-all patterns
    path('downloads/', include('playlist.urls_download')),
    # Main playlist endpoints
    path('', PlaylistListView.as_view(), name='playlist-list'),
    path('<str:playlist_id>/', PlaylistDetailView.as_view(), name='playlist-detail'),
]
