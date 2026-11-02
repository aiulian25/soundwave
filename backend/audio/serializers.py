"""Audio serializers"""

from rest_framework import serializers
from audio.export import EXPORT_QUALITIES, SUPPORTED_EXPORT_FORMATS
from audio.models import Audio, AudioProgress

EXPORT_OPTIONS_ERROR = 'Invalid export options. Formats: mp3, flac. Qualities: high, medium, low, original.'


class ExportOptionsSerializer(serializers.Serializer):
    """What one export was asked to produce."""
    format = serializers.CharField(default='mp3')
    quality = serializers.ChoiceField(choices=EXPORT_QUALITIES, default='high')
    embed_lyrics = serializers.BooleanField(default=True)
    embed_artwork = serializers.BooleanField(default=True)
    artwork_url = serializers.CharField(required=False, allow_blank=True, default='')

    def validate_format(self, value):
        normalized = value.lower()
        if normalized not in SUPPORTED_EXPORT_FORMATS:
            raise serializers.ValidationError(EXPORT_OPTIONS_ERROR)
        return normalized


class AudioSerializer(serializers.ModelSerializer):
    """Audio file serializer"""

    class Meta:
        model = Audio
        fields = [
            'id', 'youtube_id', 'title', 'description', 'channel_id',
            'channel_name', 'duration', 'file_path', 'file_size',
            'thumbnail_url', 'published_date', 'downloaded_date',
            'view_count', 'like_count', 'audio_format', 'bitrate',
            'chapters', 'loudness_lufs',
            'play_count', 'last_played', 'is_favorite',
            # Enhanced metadata fields
            'artist', 'album', 'year', 'genre', 'track_number',
            'cover_art_url', 'musicbrainz_id', 'metadata_source', 'metadata_updated'
        ]
        read_only_fields = ['id', 'downloaded_date', 'play_count', 'last_played', 'chapters', 'loudness_lufs']


class AudioListSerializer(serializers.Serializer):
    """Audio list response"""
    data = AudioSerializer(many=True)
    paginate = serializers.BooleanField(default=True)


class AudioProgressSerializer(serializers.ModelSerializer):
    """Audio progress serializer"""

    class Meta:
        model = AudioProgress
        fields = ['id', 'audio', 'position', 'completed', 'last_updated']
        read_only_fields = ['id', 'last_updated']


class AudioProgressUpdateSerializer(serializers.Serializer):
    """Update audio progress"""
    position = serializers.IntegerField(min_value=0)
    completed = serializers.BooleanField(default=False)


class AudioListQuerySerializer(serializers.Serializer):
    """Query parameters for audio list"""
    channel = serializers.CharField(required=False)
    playlist = serializers.CharField(required=False)
    status = serializers.ChoiceField(
        choices=['played', 'unplayed', 'continue'],
        required=False
    )
    sort = serializers.ChoiceField(
        choices=['published', 'downloaded', 'views', 'likes', 'duration'],
        default='published'
    )
    order = serializers.ChoiceField(
        choices=['asc', 'desc'],
        default='desc'
    )


class PlayerSerializer(serializers.Serializer):
    """Audio player data"""
    audio = AudioSerializer()
    progress = AudioProgressSerializer(required=False)
    stream_url = serializers.URLField()
