"""Channel URL patterns"""

from django.urls import path
from channel.views import ChannelListView, ChannelDetailView

urlpatterns = [
    path('', ChannelListView.as_view(), name='channel-list'),
    path('<str:channel_id>/', ChannelDetailView.as_view(), name='channel-detail'),
]
