"""Serializers for playback sync"""

from rest_framework import serializers
from audio.models_playback_sync import PlaybackSession
from audio.models import Audio


class PlaybackSessionSerializer(serializers.ModelSerializer):
    """Serializer for playback session data"""
    
    # Include audio details for the current track
    audio_details = serializers.SerializerMethodField()
    seconds_since_update = serializers.ReadOnlyField()
    
    class Meta:
        model = PlaybackSession
        fields = [
            'youtube_id',
            'position',
            'duration',
            'is_playing',
            'volume',
            'queue_youtube_ids',
            'queue_index',
            'device_id',
            'device_name',
            'updated_at',
            'seconds_since_update',
            'audio_details',
        ]
        read_only_fields = ['updated_at', 'seconds_since_update', 'audio_details']
    
    def get_audio_details(self, obj):
        """Get details of the currently playing track"""
        try:
            audio = Audio.objects.get(
                youtube_id=obj.youtube_id,
                owner=obj.user
            )
            return {
                'id': audio.id,
                'youtube_id': audio.youtube_id,
                'title': audio.title,
                'channel_name': audio.channel_name,
                'artist': audio.artist or audio.channel_name,
                'album': audio.album,
                'duration': audio.duration,
                'thumbnail_url': audio.thumbnail_url,
                'cover_art_url': audio.cover_art_url,
            }
        except Audio.DoesNotExist:
            return None


class PlaybackSyncUpdateSerializer(serializers.Serializer):
    """Serializer for updating playback sync state"""
    
    youtube_id = serializers.CharField(max_length=50)
    position = serializers.FloatField(min_value=0)
    duration = serializers.IntegerField(min_value=0, required=False, default=0)
    is_playing = serializers.BooleanField(required=False, default=False)
    volume = serializers.IntegerField(min_value=0, max_value=100, required=False, default=100)
    queue_youtube_ids = serializers.ListField(
        child=serializers.CharField(max_length=50),
        required=False,
        default=list
    )
    queue_index = serializers.IntegerField(min_value=0, required=False, default=0)
    device_id = serializers.CharField(max_length=100, required=False, allow_blank=True)
    device_name = serializers.CharField(max_length=200, required=False, allow_blank=True)
