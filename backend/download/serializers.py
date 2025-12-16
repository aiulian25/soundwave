"""Download serializers"""

from rest_framework import serializers
from download.models import DownloadQueue


class DownloadQueueSerializer(serializers.ModelSerializer):
    """Download queue serializer"""

    class Meta:
        model = DownloadQueue
        fields = '__all__'
        read_only_fields = ['added_date', 'started_date', 'completed_date']


class AddToDownloadSerializer(serializers.Serializer):
    """Add to download queue"""
    urls = serializers.ListField(
        child=serializers.URLField(),
        allow_empty=False
    )
    auto_start = serializers.BooleanField(default=False)
