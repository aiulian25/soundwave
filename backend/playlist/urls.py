"""Playlist URL patterns"""

from django.urls import path, include
from playlist.views import PlaylistListView, PlaylistDetailView, PlaylistItemsView, TrackPlaylistsView

urlpatterns = [
    # Playlist download management - must come BEFORE catch-all patterns
    path('downloads/', include('playlist.urls_download')),
    # Smart playlists
    path('smart/', include('playlist.urls_smart')),
    # Find playlists containing a track - must come before catch-all
    path('containing/<str:youtube_id>/', TrackPlaylistsView.as_view(), name='track-playlists'),
    # Main playlist endpoints
    path('', PlaylistListView.as_view(), name='playlist-list'),
    path('<str:playlist_id>/', PlaylistDetailView.as_view(), name='playlist-detail'),
    path('<str:playlist_id>/items/', PlaylistItemsView.as_view(), name='playlist-items'),
]
