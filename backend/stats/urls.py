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
]
