"""Download URL patterns"""

from django.urls import path
from download.views import DownloadListView

urlpatterns = [
    path('', DownloadListView.as_view(), name='download-list'),
]
