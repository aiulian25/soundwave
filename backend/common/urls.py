"""Common URL patterns"""

from django.urls import path
from common.views import ping

urlpatterns = [
    path('ping/', ping, name='ping'),
]
