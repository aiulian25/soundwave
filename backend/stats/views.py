"""Stats API views"""

from django.db.models import Sum, Count
from rest_framework.response import Response
from audio.models import Audio
from channel.models import Channel
from download.models import DownloadQueue
from stats.serializers import (
    AudioStatsSerializer,
    ChannelStatsSerializer,
    DownloadStatsSerializer,
)
from common.views import ApiBaseView


class AudioStatsView(ApiBaseView):
    """Audio statistics endpoint"""

    def get(self, request):
        """Get audio statistics"""
        stats = Audio.objects.aggregate(
            total_count=Count('id'),
            total_duration=Sum('duration'),
            total_size=Sum('file_size'),
            total_plays=Sum('play_count'),
        )

        # Handle None values
        stats = {k: v or 0 for k, v in stats.items()}

        serializer = AudioStatsSerializer(stats)
        return Response(serializer.data)


class ChannelStatsView(ApiBaseView):
    """Channel statistics endpoint"""

    def get(self, request):
        """Get channel statistics"""
        stats = {
            'total_channels': Channel.objects.count(),
            'subscribed_channels': Channel.objects.filter(subscribed=True).count(),
        }

        serializer = ChannelStatsSerializer(stats)
        return Response(serializer.data)


class DownloadStatsView(ApiBaseView):
    """Download statistics endpoint"""

    def get(self, request):
        """Get download statistics"""
        stats = {
            'pending': DownloadQueue.objects.filter(status='pending').count(),
            'completed': DownloadQueue.objects.filter(status='completed').count(),
            'failed': DownloadQueue.objects.filter(status='failed').count(),
        }

        serializer = DownloadStatsSerializer(stats)
        return Response(serializer.data)
