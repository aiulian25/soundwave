"""Stats serializers"""

from rest_framework import serializers
from stats.models import ListeningHistory, Achievement


class AudioStatsSerializer(serializers.Serializer):
    """Audio statistics"""
    total_count = serializers.IntegerField()
    total_duration = serializers.IntegerField(help_text="Total duration in seconds")
    total_size = serializers.IntegerField(help_text="Total size in bytes")
    total_plays = serializers.IntegerField()


class ChannelStatsSerializer(serializers.Serializer):
    """Channel statistics"""
    total_channels = serializers.IntegerField()
    subscribed_channels = serializers.IntegerField()


class DownloadStatsSerializer(serializers.Serializer):
    """Download statistics"""
    pending = serializers.IntegerField()
    completed = serializers.IntegerField()
    failed = serializers.IntegerField()


class AchievementSerializer(serializers.ModelSerializer):
    """Achievement serializer"""
    name = serializers.SerializerMethodField()
    icon = serializers.SerializerMethodField()
    description = serializers.SerializerMethodField()
    
    class Meta:
        model = Achievement
        fields = ['id', 'achievement_type', 'name', 'icon', 'description', 'unlocked_at', 'context', 'seen']
    
    def get_name(self, obj):
        details = Achievement.get_achievement_details()
        return details.get(obj.achievement_type, {}).get('name', obj.achievement_type)
    
    def get_icon(self, obj):
        details = Achievement.get_achievement_details()
        return details.get(obj.achievement_type, {}).get('icon', '🏆')
    
    def get_description(self, obj):
        details = Achievement.get_achievement_details()
        return details.get(obj.achievement_type, {}).get('description', '')


class AchievementProgressSerializer(serializers.Serializer):
    """Achievement progress serializer"""
    type = serializers.CharField()
    name = serializers.CharField()
    icon = serializers.CharField()
    description = serializers.CharField()
    threshold = serializers.IntegerField()
    current = serializers.FloatField()
    progress = serializers.IntegerField()
    unlocked = serializers.BooleanField()


class ListeningHistorySerializer(serializers.ModelSerializer):
    """Listening history entry"""
    audio_id = serializers.IntegerField(source='audio.id')
    youtube_id = serializers.CharField(source='audio.youtube_id')
    thumbnail_url = serializers.CharField(source='audio.thumbnail_url', allow_blank=True)
    
    class Meta:
        model = ListeningHistory
        fields = [
            'id', 'audio_id', 'youtube_id', 'title', 'artist', 
            'channel_name', 'genre', 'thumbnail_url',
            'listened_at', 'duration_listened', 'completed'
        ]


class TopArtistSerializer(serializers.Serializer):
    """Top artists statistics"""
    artist = serializers.CharField()
    play_count = serializers.IntegerField()
    total_duration = serializers.IntegerField(help_text="Total listening time in seconds")


class TopChannelSerializer(serializers.Serializer):
    """Top channels statistics"""
    channel_name = serializers.CharField()
    play_count = serializers.IntegerField()
    total_duration = serializers.IntegerField(help_text="Total listening time in seconds")


class TopTrackSerializer(serializers.Serializer):
    """Top tracks statistics"""
    title = serializers.CharField()
    artist = serializers.CharField()
    youtube_id = serializers.CharField()
    thumbnail_url = serializers.CharField(allow_blank=True)
    play_count = serializers.IntegerField()
    total_duration = serializers.IntegerField(help_text="Total listening time in seconds")


class ListeningTimeDistributionSerializer(serializers.Serializer):
    """Listening time by hour of day"""
    hour = serializers.IntegerField()
    play_count = serializers.IntegerField()
    total_duration = serializers.IntegerField()


class DailyListeningSerializer(serializers.Serializer):
    """Daily listening statistics"""
    date = serializers.DateField()
    play_count = serializers.IntegerField()
    total_duration = serializers.IntegerField()


class GenreDistributionSerializer(serializers.Serializer):
    """Genre distribution statistics"""
    genre = serializers.CharField()
    play_count = serializers.IntegerField()
    total_duration = serializers.IntegerField()


class ListeningInsightsSerializer(serializers.Serializer):
    """Complete listening insights/analytics"""
    # Summary stats
    total_listening_time = serializers.IntegerField(help_text="Total seconds listened")
    total_tracks_played = serializers.IntegerField()
    total_unique_tracks = serializers.IntegerField()
    total_unique_artists = serializers.IntegerField()
    avg_daily_listening = serializers.IntegerField(help_text="Average daily listening in seconds")
    favorite_hour = serializers.IntegerField(help_text="Most active hour (0-23)", allow_null=True)
    favorite_day = serializers.CharField(help_text="Most active day of week", allow_blank=True)
    longest_streak = serializers.IntegerField(help_text="Longest consecutive days streak")
    current_streak = serializers.IntegerField(help_text="Current consecutive days streak")
    
    # Detailed stats
    top_artists = TopArtistSerializer(many=True)
    top_channels = TopChannelSerializer(many=True)
    top_tracks = TopTrackSerializer(many=True)
    listening_by_hour = ListeningTimeDistributionSerializer(many=True)
    daily_listening = DailyListeningSerializer(many=True)
    genre_distribution = GenreDistributionSerializer(many=True)
    recent_history = ListeningHistorySerializer(many=True)


class YearlyWrappedSerializer(serializers.Serializer):
    """Yearly Wrapped summary - Spotify-style year in review"""
    year = serializers.IntegerField()
    
    # Top stats
    total_minutes_listened = serializers.IntegerField()
    total_tracks_played = serializers.IntegerField()
    total_unique_tracks = serializers.IntegerField()
    total_unique_artists = serializers.IntegerField()
    total_unique_channels = serializers.IntegerField()
    
    # Streaks
    longest_streak = serializers.IntegerField()
    total_listening_days = serializers.IntegerField()
    
    # Rankings
    top_artist = serializers.DictField(allow_null=True)
    top_channel = serializers.DictField(allow_null=True)
    top_track = serializers.DictField(allow_null=True)
    top_5_artists = TopArtistSerializer(many=True)
    top_5_tracks = TopTrackSerializer(many=True)
    
    # Fun facts
    listening_personality = serializers.CharField()
    peak_month = serializers.CharField()
    peak_day_of_week = serializers.CharField()
    peak_hour = serializers.IntegerField(allow_null=True)
    
    # Monthly breakdown
    monthly_minutes = serializers.ListField(child=serializers.DictField())
    
    # Achievements unlocked this year
    achievements_unlocked = serializers.IntegerField()
