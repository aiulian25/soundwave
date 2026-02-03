"""Smart Playlist URL patterns"""

from django.urls import path
from playlist.views_smart import (
    SmartPlaylistListView,
    SmartPlaylistDetailView,
    SmartPlaylistTracksView,
    SmartPlaylistRulesView,
    SmartPlaylistChoicesView,
    SmartPlaylistPreviewView,
)

urlpatterns = [
    # Smart playlist CRUD
    path('', SmartPlaylistListView.as_view(), name='smart-playlist-list'),
    path('choices/', SmartPlaylistChoicesView.as_view(), name='smart-playlist-choices'),
    path('preview/', SmartPlaylistPreviewView.as_view(), name='smart-playlist-preview'),
    path('<int:playlist_id>/', SmartPlaylistDetailView.as_view(), name='smart-playlist-detail'),
    path('<int:playlist_id>/tracks/', SmartPlaylistTracksView.as_view(), name='smart-playlist-tracks'),
    path('<int:playlist_id>/rules/', SmartPlaylistRulesView.as_view(), name='smart-playlist-rules'),
]
