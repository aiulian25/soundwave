"""Stats URL patterns"""

from django.urls import path
from stats.views import (
    AudioStatsView,
    ChannelStatsView,
    DownloadStatsView,
    ListeningInsightsView,
    RecordListeningView,
    ListeningHistoryView,
    OnThisDayView,
    AchievementsView,
    StreakView,
    YearlyWrappedView,
    HomepageDataView,
    WidgetStatsView,
    TubeArchivistDownloadView,
    TubeArchivistVideoView,
    TubeArchivistChannelView,
    TubeArchivistPlaylistView,
)

urlpatterns = [
    path('audio/', AudioStatsView.as_view(), name='audio-stats'),
    path('channel/', ChannelStatsView.as_view(), name='channel-stats'),
    path('download/', DownloadStatsView.as_view(), name='download-stats'),
    path('insights/', ListeningInsightsView.as_view(), name='listening-insights'),
    path('record/', RecordListeningView.as_view(), name='record-listening'),
    path('history/', ListeningHistoryView.as_view(), name='listening-history'),
    path('on-this-day/', OnThisDayView.as_view(), name='on-this-day'),
    path('achievements/', AchievementsView.as_view(), name='achievements'),
    path('streak/', StreakView.as_view(), name='streak'),
    path('wrapped/', YearlyWrappedView.as_view(), name='yearly-wrapped'),
    path('homepage/', HomepageDataView.as_view(), name='homepage-data'),
    # Widget API (combined endpoint)
    path('widget/', WidgetStatsView.as_view(), name='widget-stats'),
    # TubeArchivist-compatible individual endpoints (for Homepage dashboard widget)
    # These match the exact endpoints that the TubeArchivist widget expects
    path('download', TubeArchivistDownloadView.as_view(), name='ta-download-stats'),
    path('video', TubeArchivistVideoView.as_view(), name='ta-video-stats'),
    path('channel', TubeArchivistChannelView.as_view(), name='ta-channel-stats'),
    path('playlist', TubeArchivistPlaylistView.as_view(), name='ta-playlist-stats'),
]
