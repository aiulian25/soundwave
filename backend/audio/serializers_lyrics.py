"""Serializers for lyrics"""
from rest_framework import serializers
from audio.models_lyrics import Lyrics, LyricsCache


class LyricsSerializer(serializers.ModelSerializer):
    """Serializer for Lyrics model"""
    
    audio_id = serializers.CharField(source='audio.youtube_id', read_only=True)
    audio_title = serializers.CharField(source='audio.title', read_only=True)
    has_lyrics = serializers.BooleanField(read_only=True)
    is_synced = serializers.BooleanField(read_only=True)
    display_lyrics = serializers.CharField(source='get_display_lyrics', read_only=True)
    
    class Meta:
        model = Lyrics
        fields = [
            'audio_id',
            'audio_title',
            'synced_lyrics',
            'plain_lyrics',
            'is_instrumental',
            'source',
            'language',
            'fetched_date',
            'fetch_attempted',
            'fetch_attempts',
            'last_error',
            'has_lyrics',
            'is_synced',
            'display_lyrics',
        ]
        read_only_fields = [
            'audio_id',
            'audio_title',
            'fetched_date',
            'fetch_attempted',
            'fetch_attempts',
            'last_error',
            'has_lyrics',
            'is_synced',
            'display_lyrics',
        ]


class LyricsUpdateSerializer(serializers.Serializer):
    """Serializer for manually updating lyrics"""
    
    synced_lyrics = serializers.CharField(required=False, allow_blank=True)
    plain_lyrics = serializers.CharField(required=False, allow_blank=True)
    is_instrumental = serializers.BooleanField(required=False, default=False)
    language = serializers.CharField(required=False, allow_blank=True, max_length=10)


class LyricsFetchSerializer(serializers.Serializer):
    """Serializer for fetching lyrics"""
    
    force = serializers.BooleanField(default=False, required=False)


class LyricsCacheSerializer(serializers.ModelSerializer):
    """Serializer for LyricsCache model"""
    
    class Meta:
        model = LyricsCache
        fields = [
            'id',
            'title',
            'artist_name',
            'album_name',
            'duration',
            'synced_lyrics',
            'plain_lyrics',
            'is_instrumental',
            'language',
            'source',
            'cached_date',
            'last_accessed',
            'access_count',
            'not_found',
        ]
        read_only_fields = [
            'id',
            'cached_date',
            'last_accessed',
            'access_count',
        ]
