"""Channel serializers"""

from rest_framework import serializers
from channel.models import Channel
import re


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


class ChannelSerializer(serializers.ModelSerializer):
    """Channel serializer"""
    status_display = serializers.CharField(source='get_sync_status_display', read_only=True)
    progress_percent = serializers.SerializerMethodField()

    class Meta:
        model = Channel
        fields = '__all__'
        read_only_fields = ['created_date', 'last_refreshed']
    
    def get_progress_percent(self, obj):
        """Calculate download progress percentage"""
        if obj.video_count == 0:
            return 0
        return int((obj.downloaded_count / obj.video_count) * 100)


class ChannelListSerializer(serializers.Serializer):
    """Channel list response"""
    data = ChannelSerializer(many=True)
    paginate = serializers.BooleanField(default=True)
