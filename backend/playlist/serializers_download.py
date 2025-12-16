"""Serializers for playlist download"""

from rest_framework import serializers
from playlist.models_download import PlaylistDownload, PlaylistDownloadItem
from playlist.serializers import PlaylistSerializer


class PlaylistDownloadItemSerializer(serializers.ModelSerializer):
    """Serializer for playlist download items"""
    audio_title = serializers.CharField(source='audio.title', read_only=True)
    audio_duration = serializers.IntegerField(source='audio.duration', read_only=True)
    progress_percent = serializers.FloatField(read_only=True)
    
    class Meta:
        model = PlaylistDownloadItem
        fields = [
            'id',
            'audio',
            'audio_title',
            'audio_duration',
            'status',
            'position',
            'file_size_bytes',
            'downloaded_bytes',
            'progress_percent',
            'started_at',
            'completed_at',
            'error_message',
            'retry_count',
        ]
        read_only_fields = [
            'id',
            'status',
            'file_size_bytes',
            'downloaded_bytes',
            'started_at',
            'completed_at',
            'error_message',
            'retry_count',
        ]


class PlaylistDownloadSerializer(serializers.ModelSerializer):
    """Serializer for playlist downloads"""
    playlist_data = PlaylistSerializer(source='playlist', read_only=True)
    progress_percent = serializers.FloatField(read_only=True)
    is_complete = serializers.BooleanField(read_only=True)
    can_resume = serializers.BooleanField(read_only=True)
    items = PlaylistDownloadItemSerializer(many=True, read_only=True)
    
    class Meta:
        model = PlaylistDownload
        fields = [
            'id',
            'playlist',
            'playlist_data',
            'status',
            'total_items',
            'downloaded_items',
            'failed_items',
            'progress_percent',
            'total_size_bytes',
            'downloaded_size_bytes',
            'quality',
            'created_at',
            'started_at',
            'completed_at',
            'error_message',
            'download_path',
            'is_complete',
            'can_resume',
            'items',
        ]
        read_only_fields = [
            'id',
            'status',
            'total_items',
            'downloaded_items',
            'failed_items',
            'total_size_bytes',
            'downloaded_size_bytes',
            'created_at',
            'started_at',
            'completed_at',
            'error_message',
            'download_path',
        ]


class PlaylistDownloadCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating playlist download"""
    
    class Meta:
        model = PlaylistDownload
        fields = ['playlist', 'quality']
    
    def validate_playlist(self, value):
        """Validate user owns the playlist"""
        request = self.context.get('request')
        if request and hasattr(value, 'owner'):
            if value.owner != request.user:
                raise serializers.ValidationError("You can only download your own playlists")
        return value
    
    def create(self, validated_data):
        """Set user from request"""
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            validated_data['user'] = request.user
        return super().create(validated_data)
