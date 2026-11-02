"""Serializers for lyrics"""
from rest_framework import serializers
from audio.models_lyrics import Lyrics, LyricsCache, REVISION_LENGTH


YOUTUBE_ID_MAX_LENGTH = 50
MAX_LYRICS_BATCH_SIZE = 100
MAX_LRC_CHARACTERS = 1024 * 1024
MAX_MISSING_LYRICS_LIMIT = 200
DEFAULT_MISSING_LYRICS_LIMIT = 50
MAX_CACHE_RETENTION_DAYS = 3650
DEFAULT_CACHE_RETENTION_DAYS = 30


class LyricsSerializer(serializers.ModelSerializer):
    """Serializer for Lyrics model"""
    
    audio_id = serializers.CharField(source='audio.youtube_id', read_only=True)
    audio_title = serializers.CharField(source='audio.title', read_only=True)
    revision = serializers.CharField(read_only=True)
    has_lyrics = serializers.BooleanField(read_only=True)
    is_synced = serializers.BooleanField(read_only=True)
    display_lyrics = serializers.CharField(source='get_display_lyrics', read_only=True)
    
    class Meta:
        model = Lyrics
        fields = [
            'audio_id',
            'audio_title',
            'synced_lyrics',
            'original_synced_lyrics',
            'revision',
            'plain_lyrics',
            'is_instrumental',
            'source',
            'uploaded_filename',
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
            'original_synced_lyrics',
            'revision',
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


class LyricsTimingSerializer(serializers.Serializer):
    """New timing for a track's lyrics, and the revision it was edited from"""
    
    synced_lyrics = serializers.CharField(max_length=MAX_LRC_CHARACTERS, trim_whitespace=False)
    base_revision = serializers.CharField(max_length=REVISION_LENGTH)


class LRCUploadSerializer(serializers.Serializer):
    """Serializer for LRC file upload"""
    
    lrc_file = serializers.FileField(required=True)
    
    def validate_lrc_file(self, value):
        """Validate the uploaded LRC file"""
        # Check file extension
        if not value.name.lower().endswith('.lrc'):
            raise serializers.ValidationError("File must have .lrc extension")
        
        # Check file size (max 1MB)
        if value.size > 1024 * 1024:
            raise serializers.ValidationError("LRC file must be smaller than 1MB")
        
        # Read and validate content
        try:
            content = value.read().decode('utf-8')
            value.seek(0)  # Reset file pointer
            
            # Check if it contains valid LRC timestamps
            import re
            from audio.lyrics_service import LRC_TIMESTAMP_PATTERN
            if not re.search(LRC_TIMESTAMP_PATTERN, content):
                raise serializers.ValidationError(
                    "Invalid LRC file: no valid timestamps found. "
                    "LRC files must contain timestamps in format [mm:ss] or [mm:ss.xx]"
                )
            
            return value
        except UnicodeDecodeError:
            raise serializers.ValidationError("LRC file must be UTF-8 encoded")


class LyricsBatchSerializer(serializers.Serializer):
    """Tracks to fetch lyrics for, bounded because each one costs provider requests"""
    
    youtube_ids = serializers.ListField(
        child=serializers.CharField(max_length=YOUTUBE_ID_MAX_LENGTH),
        allow_empty=False,
        max_length=MAX_LYRICS_BATCH_SIZE,
    )


class LyricsMissingFetchSerializer(serializers.Serializer):
    """How many of the requester's tracks without lyrics to process"""
    
    limit = serializers.IntegerField(
        min_value=1, max_value=MAX_MISSING_LYRICS_LIMIT, default=DEFAULT_MISSING_LYRICS_LIMIT
    )


class LyricsCacheCleanupSerializer(serializers.Serializer):
    """Retention for cache cleanup; at least a day, so a request cannot empty the cache"""
    
    days_old = serializers.IntegerField(
        min_value=1, max_value=MAX_CACHE_RETENTION_DAYS, default=DEFAULT_CACHE_RETENTION_DAYS
    )


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
