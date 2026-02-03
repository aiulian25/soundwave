"""URL patterns for Smart Radio / Auto-DJ"""

from django.urls import path
from audio.views_radio import (
    RadioStartView,
    RadioStopView,
    RadioStatusView,
    RadioNextTrackView,
    RadioSkipView,
    RadioLikeView,
    RadioSettingsView,
)

urlpatterns = [
    path('start/', RadioStartView.as_view(), name='radio-start'),
    path('stop/', RadioStopView.as_view(), name='radio-stop'),
    path('status/', RadioStatusView.as_view(), name='radio-status'),
    path('next/', RadioNextTrackView.as_view(), name='radio-next'),
    path('skip/', RadioSkipView.as_view(), name='radio-skip'),
    path('like/', RadioLikeView.as_view(), name='radio-like'),
    path('settings/', RadioSettingsView.as_view(), name='radio-settings'),
]
