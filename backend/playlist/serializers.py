"""Playlist serializers"""

from rest_framework import serializers
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
    progress_percent = serializers.SerializerMethodField()
    status_display = serializers.CharField(source='get_sync_status_display', read_only=True)

    class Meta:
        model = Playlist
        fields = '__all__'
        read_only_fields = ['owner', 'created_date', 'last_updated', 'last_refresh']

    def get_item_count(self, obj):
        return obj.items.count()
    
    def get_progress_percent(self, obj):
        """Calculate download progress percentage"""
        if obj.item_count == 0:
            return 0
        return int((obj.downloaded_count / obj.item_count) * 100)


class PlaylistItemSerializer(serializers.ModelSerializer):
    """Playlist item serializer"""

    class Meta:
        model = PlaylistItem
        fields = '__all__'
        read_only_fields = ['added_date']
