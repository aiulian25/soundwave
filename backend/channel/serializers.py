"""Channel serializers"""

from rest_framework import serializers
from channel.models import Channel
from download.models import DownloadQueue, outstanding_counts
import re


# Allowed per-channel sync depths (0 = entire channel history). The allow-list bounds
# how many videos a single sync can request, preventing an oversized YouTube fetch.
ALLOWED_SYNC_DEPTHS = (0, 25, 50, 100, 200)


class ChannelSubscribeSerializer(serializers.Serializer):
    """Channel subscription from URL"""
    url = serializers.URLField(required=True, help_text="YouTube channel URL")

    def validate_url(self, value):
        """Extract channel ID from URL"""
        # Match various YouTube channel URL patterns
        patterns = [
            r'youtube\.com/channel/(UC[\w-]+)',
            r'youtube\.com/@([\w-]+)',
            r'youtube\.com/c/([\w-]+)',
            r'youtube\.com/user/([\w-]+)',
        ]
        
        for pattern in patterns:
            match = re.search(pattern, value)
            if match:
                return match.group(1)
        
        # If it's just a channel ID
        if value.startswith('UC') and len(value) == 24:
            return value
            
        raise serializers.ValidationError("Invalid YouTube channel URL")


class ChannelSyncDepthSerializer(serializers.Serializer):
    """Validate a per-channel sync-depth update (0 = all history)."""
    sync_depth = serializers.IntegerField(min_value=0)

    def validate_sync_depth(self, value):
        if value not in ALLOWED_SYNC_DEPTHS:
            raise serializers.ValidationError(
                f"sync_depth must be one of {ALLOWED_SYNC_DEPTHS}"
            )
        return value


class ChannelSerializer(serializers.ModelSerializer):
    """Channel serializer"""
    status_display = serializers.CharField(source='get_sync_status_display', read_only=True)
    remote_total = serializers.IntegerField(source='video_count', read_only=True)
    local_available = serializers.IntegerField(source='downloaded_count', read_only=True)
    progress_percent = serializers.SerializerMethodField()

    class Meta:
        model = Channel
        fields = '__all__'
        read_only_fields = ['created_date', 'last_refreshed']
    
    def get_progress_percent(self, obj):
        """Share of the videos this channel's sync depth reaches that are playable locally"""
        reachable = min(obj.video_count, obj.sync_depth) if obj.sync_depth else obj.video_count
        if reachable <= 0:
            return 0
        return min(100, int((obj.downloaded_count / reachable) * 100))

    def to_representation(self, instance):
        queue_rows = DownloadQueue.objects.filter(owner_id=instance.owner_id, channel_name=instance.channel_name)
        return {**super().to_representation(instance), **outstanding_counts(queue_rows)}


class ChannelListSerializer(serializers.Serializer):
    """Channel list response"""
    data = ChannelSerializer(many=True)
    paginate = serializers.BooleanField(default=True)
