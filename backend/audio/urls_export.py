"""Export job URLs.

Deliberately outside /api/audio/ and /api/playlist/: the service worker keeps those responses
offline, and a large ZIP must not end up in Cache Storage.
"""

from django.urls import path

from audio.views_export import ExportJobDetailView, ExportJobDownloadView, ExportJobListView

urlpatterns = [
    path('', ExportJobListView.as_view(), name='export-job-list'),
    path('<uuid:job_id>/', ExportJobDetailView.as_view(), name='export-job-detail'),
    path('<uuid:job_id>/download/', ExportJobDownloadView.as_view(), name='export-job-download'),
]
