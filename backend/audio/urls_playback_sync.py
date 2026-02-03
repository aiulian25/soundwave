"""URL patterns for playback sync"""

from django.urls import path
from audio.views_playback_sync import PlaybackSyncView, PlaybackSyncStatusView

urlpatterns = [
    path('', PlaybackSyncView.as_view(), name='playback-sync'),
    path('status/', PlaybackSyncStatusView.as_view(), name='playback-sync-status'),
]
