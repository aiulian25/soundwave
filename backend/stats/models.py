"""Stats models"""

from django.db import models
from django.contrib.auth import get_user_model
from django.utils import timezone

User = get_user_model()


class ListeningHistory(models.Model):
    """Track individual listening events for analytics"""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='listening_history')
    audio = models.ForeignKey('audio.Audio', on_delete=models.CASCADE, related_name='listening_events')
    
    # Track info at time of listen (denormalized for historical accuracy)
    artist = models.CharField(max_length=255, blank=True)
    title = models.CharField(max_length=500)
    channel_name = models.CharField(max_length=200)
    genre = models.CharField(max_length=100, blank=True, default='')
    
    # Listening details
    event_id = models.UUIDField(
        null=True, blank=True,
        help_text="Client-chosen identity of one play, so a retry counts once. Empty on older rows",
    )
    listened_at = models.DateTimeField(default=timezone.now, help_text="When the listening happened")
    received_at = models.DateTimeField(
        auto_now_add=True, null=True,
        help_text="When the server learned of it. Empty on older rows",
    )
    duration_listened = models.IntegerField(default=0, help_text="Duration listened in seconds")
    completed = models.BooleanField(default=False, help_text="Whether the track was fully played")
    
    class Meta:
        ordering = ['-listened_at']
        indexes = [
            models.Index(fields=['user', '-listened_at']),
            models.Index(fields=['user', 'artist']),
            models.Index(fields=['user', 'channel_name']),
            models.Index(fields=['user', 'genre']),
        ]
        constraints = [
            models.UniqueConstraint(fields=['user', 'event_id'], name='unique_listening_event_per_user'),
        ]
        verbose_name_plural = 'Listening history'
    
    def __str__(self):
        return f"{self.user.username} - {self.title} @ {self.listened_at}"


class Achievement(models.Model):
    """Track user achievements and milestones"""
    
    ACHIEVEMENT_TYPES = [
        # Listening milestones
        ('tracks_10', '🎵 First Steps'),
        ('tracks_50', '🎵 Music Explorer'),
        ('tracks_100', '🎵 Dedicated Listener'),
        ('tracks_500', '🎵 Music Enthusiast'),
        ('tracks_1000', '🎵 Audiophile'),
        ('tracks_5000', '🎵 Music Legend'),
        ('tracks_10000', '🎵 Sound Master'),
        
        # Time milestones (in hours)
        ('hours_1', '⏱️ First Hour'),
        ('hours_10', '⏱️ Getting Started'),
        ('hours_24', '⏱️ Full Day'),
        ('hours_100', '⏱️ Dedicated Fan'),
        ('hours_500', '⏱️ Time Traveler'),
        ('hours_1000', '⏱️ Marathon Listener'),
        
        # Streak achievements
        ('streak_3', '🔥 3-Day Streak'),
        ('streak_7', '🔥 Week Warrior'),
        ('streak_14', '🔥 Two Week Champion'),
        ('streak_30', '🔥 Monthly Master'),
        ('streak_60', '🔥 Two Month Hero'),
        ('streak_90', '🔥 Quarter King'),
        ('streak_180', '🔥 Half Year Legend'),
        ('streak_365', '🔥 Year-Long Dedication'),
        
        # Variety achievements
        ('artists_10', '🎤 Artist Explorer'),
        ('artists_50', '🎤 Genre Hopper'),
        ('artists_100', '🎤 Music Wanderer'),
        ('artists_500', '🎤 Eclectic Taste'),
        
        # Channel achievements  
        ('channels_5', '📺 Channel Surfer'),
        ('channels_25', '📺 Content Explorer'),
        ('channels_50', '📺 Curator'),
        ('channels_100', '📺 Library Builder'),
        
        # Special achievements
        ('night_owl', '🦉 Night Owl'),  # Listen after midnight
        ('early_bird', '🐦 Early Bird'),  # Listen before 6 AM
        ('weekend_warrior', '🎉 Weekend Warrior'),  # Heavy weekend listening
        ('genre_master', '🏆 Genre Master'),  # Listen to 10+ genres
        ('completionist', '✅ Completionist'),  # Complete 100 tracks fully
        ('collector', '💿 Collector'),  # 500+ tracks in library
        ('superfan', '⭐ Superfan'),  # 50+ plays of a single artist
    ]
    
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='achievements')
    achievement_type = models.CharField(max_length=50, choices=ACHIEVEMENT_TYPES)
    unlocked_at = models.DateTimeField(auto_now_add=True)
    
    # Extra context for the achievement
    context = models.JSONField(default=dict, blank=True, help_text="Additional context like the artist name for superfan")
    
    # Whether the user has seen/dismissed this achievement
    seen = models.BooleanField(default=False)
    
    class Meta:
        unique_together = ('user', 'achievement_type')
        ordering = ['-unlocked_at']
        indexes = [
            models.Index(fields=['user', '-unlocked_at']),
            models.Index(fields=['user', 'seen']),
        ]
    
    def __str__(self):
        return f"{self.user.username} - {self.get_achievement_type_display()}"
    
    @classmethod
    def get_achievement_details(cls):
        """Get details for all achievement types"""
        details = {
            'tracks_10': {'name': 'First Steps', 'icon': '🎵', 'description': 'Listen to 10 tracks', 'threshold': 10},
            'tracks_50': {'name': 'Music Explorer', 'icon': '🎵', 'description': 'Listen to 50 tracks', 'threshold': 50},
            'tracks_100': {'name': 'Dedicated Listener', 'icon': '🎵', 'description': 'Listen to 100 tracks', 'threshold': 100},
            'tracks_500': {'name': 'Music Enthusiast', 'icon': '🎵', 'description': 'Listen to 500 tracks', 'threshold': 500},
            'tracks_1000': {'name': 'Audiophile', 'icon': '🎵', 'description': 'Listen to 1,000 tracks', 'threshold': 1000},
            'tracks_5000': {'name': 'Music Legend', 'icon': '🎵', 'description': 'Listen to 5,000 tracks', 'threshold': 5000},
            'tracks_10000': {'name': 'Sound Master', 'icon': '🎵', 'description': 'Listen to 10,000 tracks', 'threshold': 10000},
            
            'hours_1': {'name': 'First Hour', 'icon': '⏱️', 'description': 'Listen for 1 hour', 'threshold': 1},
            'hours_10': {'name': 'Getting Started', 'icon': '⏱️', 'description': 'Listen for 10 hours', 'threshold': 10},
            'hours_24': {'name': 'Full Day', 'icon': '⏱️', 'description': 'Listen for 24 hours', 'threshold': 24},
            'hours_100': {'name': 'Dedicated Fan', 'icon': '⏱️', 'description': 'Listen for 100 hours', 'threshold': 100},
            'hours_500': {'name': 'Time Traveler', 'icon': '⏱️', 'description': 'Listen for 500 hours', 'threshold': 500},
            'hours_1000': {'name': 'Marathon Listener', 'icon': '⏱️', 'description': 'Listen for 1,000 hours', 'threshold': 1000},
            
            'streak_3': {'name': '3-Day Streak', 'icon': '🔥', 'description': 'Listen 3 days in a row', 'threshold': 3},
            'streak_7': {'name': 'Week Warrior', 'icon': '🔥', 'description': 'Listen 7 days in a row', 'threshold': 7},
            'streak_14': {'name': 'Two Week Champion', 'icon': '🔥', 'description': 'Listen 14 days in a row', 'threshold': 14},
            'streak_30': {'name': 'Monthly Master', 'icon': '🔥', 'description': 'Listen 30 days in a row', 'threshold': 30},
            'streak_60': {'name': 'Two Month Hero', 'icon': '🔥', 'description': 'Listen 60 days in a row', 'threshold': 60},
            'streak_90': {'name': 'Quarter King', 'icon': '🔥', 'description': 'Listen 90 days in a row', 'threshold': 90},
            'streak_180': {'name': 'Half Year Legend', 'icon': '🔥', 'description': 'Listen 180 days in a row', 'threshold': 180},
            'streak_365': {'name': 'Year-Long Dedication', 'icon': '🔥', 'description': 'Listen 365 days in a row', 'threshold': 365},
            
            'artists_10': {'name': 'Artist Explorer', 'icon': '🎤', 'description': 'Listen to 10 different artists', 'threshold': 10},
            'artists_50': {'name': 'Genre Hopper', 'icon': '🎤', 'description': 'Listen to 50 different artists', 'threshold': 50},
            'artists_100': {'name': 'Music Wanderer', 'icon': '🎤', 'description': 'Listen to 100 different artists', 'threshold': 100},
            'artists_500': {'name': 'Eclectic Taste', 'icon': '🎤', 'description': 'Listen to 500 different artists', 'threshold': 500},
            
            'channels_5': {'name': 'Channel Surfer', 'icon': '📺', 'description': 'Listen from 5 different channels', 'threshold': 5},
            'channels_25': {'name': 'Content Explorer', 'icon': '📺', 'description': 'Listen from 25 different channels', 'threshold': 25},
            'channels_50': {'name': 'Curator', 'icon': '📺', 'description': 'Listen from 50 different channels', 'threshold': 50},
            'channels_100': {'name': 'Library Builder', 'icon': '📺', 'description': 'Listen from 100 different channels', 'threshold': 100},
            
            'night_owl': {'name': 'Night Owl', 'icon': '🦉', 'description': 'Listen to music after midnight', 'threshold': 1},
            'early_bird': {'name': 'Early Bird', 'icon': '🐦', 'description': 'Listen to music before 6 AM', 'threshold': 1},
            'weekend_warrior': {'name': 'Weekend Warrior', 'icon': '🎉', 'description': 'Listen to 50+ tracks on a weekend', 'threshold': 50},
            'genre_master': {'name': 'Genre Master', 'icon': '🏆', 'description': 'Listen to 10+ different genres', 'threshold': 10},
            'completionist': {'name': 'Completionist', 'icon': '✅', 'description': 'Complete 100 tracks fully', 'threshold': 100},
            'collector': {'name': 'Collector', 'icon': '💿', 'description': 'Have 500+ tracks in your library', 'threshold': 500},
            'superfan': {'name': 'Superfan', 'icon': '⭐', 'description': 'Listen to 50+ plays of a single artist', 'threshold': 50},
        }
        return details


class ListeningStreak(models.Model):
    """Track daily listening for streak calculations"""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='listening_streaks')
    date = models.DateField()
    tracks_played = models.IntegerField(default=0)
    duration_listened = models.IntegerField(default=0, help_text="Total seconds listened that day")
    
    class Meta:
        unique_together = ('user', 'date')
        ordering = ['-date']
        indexes = [
            models.Index(fields=['user', '-date']),
        ]
    
    def __str__(self):
        return f"{self.user.username} - {self.date}: {self.tracks_played} tracks"
