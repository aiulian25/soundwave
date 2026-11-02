"""Common URL patterns"""

from django.urls import path
from common.views import ping, AppVersionView, ReadinessView

urlpatterns = [
    path('ping/', ping, name='ping'),
    path('ready/', ReadinessView.as_view(), name='ready'),
    path('version/', AppVersionView.as_view(), name='app-version'),
]
