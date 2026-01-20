"""Stats URL patterns"""

from django.urls import path
from stats.views import (
    AudioStatsView,
    ChannelStatsView,
    DownloadStatsView,
    ListeningInsightsView,
    RecordListeningView,
    ListeningHistoryView,
)

urlpatterns = [
    path('audio/', AudioStatsView.as_view(), name='audio-stats'),
    path('channel/', ChannelStatsView.as_view(), name='channel-stats'),
    path('download/', DownloadStatsView.as_view(), name='download-stats'),
    path('insights/', ListeningInsightsView.as_view(), name='listening-insights'),
    path('record/', RecordListeningView.as_view(), name='record-listening'),
    path('history/', ListeningHistoryView.as_view(), name='listening-history'),
]
