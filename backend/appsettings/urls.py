"""App settings URL patterns"""

from django.urls import path
from appsettings.views import AppConfigView, BackupView, RestoreView

urlpatterns = [
    path('config/', AppConfigView.as_view(), name='app-config'),
    path('backup/', BackupView.as_view(), name='backup'),
    path('restore/', RestoreView.as_view(), name='restore'),
]
