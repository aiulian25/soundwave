"""Stats URL patterns"""

from django.urls import path
from stats.views import AudioStatsView, ChannelStatsView, DownloadStatsView

urlpatterns = [
    path('audio/', AudioStatsView.as_view(), name='audio-stats'),
    path('channel/', ChannelStatsView.as_view(), name='channel-stats'),
    path('download/', DownloadStatsView.as_view(), name='download-stats'),
]
