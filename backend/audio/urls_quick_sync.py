"""URL configuration for Quick Sync"""
from django.urls import path
from audio.views_quick_sync import (
    QuickSyncStatusView,
    QuickSyncPreferencesView,
    QuickSyncTestView,
    QuickSyncQualityPresetsView,
)

urlpatterns = [
    path('quick-sync/status/', QuickSyncStatusView.as_view(), name='quick-sync-status'),
    path('quick-sync/preferences/', QuickSyncPreferencesView.as_view(), name='quick-sync-preferences'),
    path('quick-sync/test/', QuickSyncTestView.as_view(), name='quick-sync-test'),
    path('quick-sync/presets/', QuickSyncQualityPresetsView.as_view(), name='quick-sync-presets'),
]
