"""Playlist serializers"""

from rest_framework import serializers
from audio.serializers import AudioSerializer
from download.models import DownloadQueue, outstanding_counts
from playlist.models import Playlist, PlaylistItem
import re


class PlaylistSubscribeSerializer(serializers.Serializer):
    """Playlist subscription from URL"""
    url = serializers.URLField(required=True, help_text="YouTube playlist URL")

    def validate_url(self, value):
        """Extract playlist ID from URL"""
        # Match YouTube playlist URL patterns
        patterns = [
            r'[?&]list=([a-zA-Z0-9_-]+)',
            r'playlist\?list=([a-zA-Z0-9_-]+)',
        ]
        
        for pattern in patterns:
            match = re.search(pattern, value)
            if match:
                return match.group(1)
        
        # If it's just a playlist ID
        if len(value) >= 13 and value.startswith(('PL', 'UU', 'LL', 'RD')):
            return value
            
        raise serializers.ValidationError("Invalid YouTube playlist URL")


class PlaylistSerializer(serializers.ModelSerializer):
    """Playlist serializer"""
    item_count = serializers.SerializerMethodField()
    remote_total = serializers.IntegerField(read_only=True)
    local_available = serializers.IntegerField(source='downloaded_count', read_only=True)
    progress_percent = serializers.SerializerMethodField()
    status_display = serializers.CharField(source='get_sync_status_display', read_only=True)

    class Meta:
        model = Playlist
        exclude = ['remote_video_ids']
        read_only_fields = ['owner', 'created_date', 'last_updated', 'last_refresh', 'remote_unavailable_count']

    def get_item_count(self, obj):
        return obj.items.count()
    
    def get_progress_percent(self, obj):
        """Share of the tracks that can still be fetched that are playable locally"""
        obtainable = obj.item_count - obj.remote_unavailable_count
        if obtainable <= 0:
            return 0
        return min(100, int((obj.downloaded_count / obtainable) * 100))

    def to_representation(self, instance):
        queue_rows = DownloadQueue.objects.filter(owner_id=instance.owner_id, youtube_id__in=instance.remote_video_ids)
        return {
            **super().to_representation(instance),
            'thumbnail_url': instance.artwork_url,
            **outstanding_counts(queue_rows),
        }


class PlaylistTrackSerializer(serializers.ModelSerializer):
    """One row of a playlist as its page shows it: the place in the list and the track itself"""
    audio = AudioSerializer(read_only=True)

    class Meta:
        model = PlaylistItem
        fields = ['id', 'position', 'added_date', 'audio']


class PlaylistItemSerializer(serializers.ModelSerializer):
    """Playlist item serializer"""

    class Meta:
        model = PlaylistItem
        fields = '__all__'
        read_only_fields = ['added_date']
