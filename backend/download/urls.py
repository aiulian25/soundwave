"""Download URL patterns"""

from django.urls import path
from download.views import (
    DownloadListView,
    RetryFailedView,
    IgnoreFailedView,
    DownloadStatusView,
)

urlpatterns = [
    path('', DownloadListView.as_view(), name='download-list'),
    path('retry/', RetryFailedView.as_view(), name='download-retry'),
    path('ignore/', IgnoreFailedView.as_view(), name='download-ignore'),
    path('status/', DownloadStatusView.as_view(), name='download-status'),
]
