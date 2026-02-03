"""Serializers for Smart Radio / Auto-DJ"""

from rest_framework import serializers
from audio.models_radio import RadioSession, RadioTrackFeedback
from audio.models import Audio


class RadioSessionSerializer(serializers.ModelSerializer):
    """Serializer for radio session data"""
    
    seed_track = serializers.SerializerMethodField()
    tracks_played = serializers.SerializerMethodField()
    tracks_skipped = serializers.SerializerMethodField()
    
    class Meta:
        model = RadioSession
        fields = [
            'mode',
            'seed_youtube_id',
            'seed_channel_id',
            'seed_title',
            'seed_artist',
            'is_active',
            'current_youtube_id',
            'variety_level',
            'started_at',
            'updated_at',
            'seed_track',
            'tracks_played',
            'tracks_skipped',
        ]
        read_only_fields = ['started_at', 'updated_at', 'seed_track', 'tracks_played', 'tracks_skipped']
    
    def get_seed_track(self, obj):
        """Get details of the seed track"""
        if not obj.seed_youtube_id:
            return None
        try:
            audio = Audio.objects.get(youtube_id=obj.seed_youtube_id, owner=obj.user)
            return {
                'id': audio.id,
                'youtube_id': audio.youtube_id,
                'title': audio.title,
                'artist': audio.artist or audio.channel_name,
                'thumbnail_url': audio.thumbnail_url,
                'cover_art_url': audio.cover_art_url,
            }
        except Audio.DoesNotExist:
            return None
    
    def get_tracks_played(self, obj):
        return len(obj.played_youtube_ids)
    
    def get_tracks_skipped(self, obj):
        return len(obj.skipped_youtube_ids)


class StartRadioSerializer(serializers.Serializer):
    """Serializer for starting a new radio session"""
    
    mode = serializers.ChoiceField(
        choices=RadioSession.RADIO_MODE_CHOICES,
        default='track'
    )
    seed_youtube_id = serializers.CharField(max_length=50, required=False, allow_blank=True)
    seed_channel_id = serializers.CharField(max_length=50, required=False, allow_blank=True)
    variety_level = serializers.IntegerField(min_value=0, max_value=100, default=50)
    
    def validate(self, data):
        mode = data.get('mode', 'track')
        
        if mode == 'track' and not data.get('seed_youtube_id'):
            raise serializers.ValidationError({
                'seed_youtube_id': 'Required for track-based radio'
            })
        
        if mode == 'artist' and not data.get('seed_channel_id'):
            raise serializers.ValidationError({
                'seed_channel_id': 'Required for artist-based radio'
            })
        
        return data


class RadioFeedbackSerializer(serializers.Serializer):
    """Serializer for track feedback during radio playback"""
    
    youtube_id = serializers.CharField(max_length=50)
    feedback_type = serializers.ChoiceField(choices=RadioTrackFeedback.FEEDBACK_CHOICES)
    listen_duration = serializers.IntegerField(min_value=0, default=0)
    track_duration = serializers.IntegerField(min_value=0, default=0)


class RadioNextTrackResponseSerializer(serializers.Serializer):
    """Response serializer for the next track endpoint"""
    
    track = serializers.DictField()
    queue_position = serializers.IntegerField()
    total_played = serializers.IntegerField()
    radio_mode = serializers.CharField()
    seed_title = serializers.CharField()
    reason = serializers.CharField()  # Why this track was chosen
