"""App settings URL patterns"""

from django.urls import path
from appsettings.views import AppConfigView, BackupView

urlpatterns = [
    path('config/', AppConfigView.as_view(), name='app-config'),
    path('backup/', BackupView.as_view(), name='backup'),
]
