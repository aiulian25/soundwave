"""Stats serializers"""

from rest_framework import serializers


class AudioStatsSerializer(serializers.Serializer):
    """Audio statistics"""
    total_count = serializers.IntegerField()
    total_duration = serializers.IntegerField(help_text="Total duration in seconds")
    total_size = serializers.IntegerField(help_text="Total size in bytes")
    total_plays = serializers.IntegerField()


class ChannelStatsSerializer(serializers.Serializer):
    """Channel statistics"""
    total_channels = serializers.IntegerField()
    subscribed_channels = serializers.IntegerField()


class DownloadStatsSerializer(serializers.Serializer):
    """Download statistics"""
    pending = serializers.IntegerField()
    completed = serializers.IntegerField()
    failed = serializers.IntegerField()
