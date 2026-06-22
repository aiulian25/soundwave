"""Common URL patterns"""

from django.urls import path
from common.views import ping, AppVersionView

urlpatterns = [
    path('ping/', ping, name='ping'),
    path('version/', AppVersionView.as_view(), name='app-version'),
]
