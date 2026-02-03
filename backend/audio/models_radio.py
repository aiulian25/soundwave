"""Smart Radio / Auto-DJ models for endless personalized playback"""

from django.db import models
from django.contrib.auth import get_user_model
from django.utils import timezone
from datetime import timedelta

User = get_user_model()


class RadioSession(models.Model):
    """
    Tracks an active radio session for a user.
    Only one active session per user at a time.
    """
    RADIO_MODE_CHOICES = [
        ('track', 'Based on Track'),      # Radio based on a seed track
        ('artist', 'Based on Artist'),    # Radio based on an artist/channel
        ('favorites', 'Favorites Mix'),   # Mix of user's favorite tracks
        ('discovery', 'Discovery Mode'),  # Explore less-played tracks
        ('recent', 'Recently Added'),     # Focus on new additions
    ]
    
    user = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        related_name='radio_session',
        primary_key=True,
    )
    
    # Radio configuration
    mode = models.CharField(max_length=20, choices=RADIO_MODE_CHOICES, default='track')
    
    # Seed information (what the radio is based on)
    seed_youtube_id = models.CharField(max_length=50, blank=True, help_text="YouTube ID of the seed track")
    seed_channel_id = models.CharField(max_length=50, blank=True, help_text="Channel ID for artist-based radio")
    seed_title = models.CharField(max_length=500, blank=True, help_text="Title of seed track for display")
    seed_artist = models.CharField(max_length=200, blank=True, help_text="Artist/channel name for display")
    
    # Current state
    is_active = models.BooleanField(default=True)
    current_youtube_id = models.CharField(max_length=50, blank=True, help_text="Currently playing track")
    
    # History tracking (to avoid repeats)
    played_youtube_ids = models.JSONField(default=list, help_text="List of recently played YouTube IDs")
    skipped_youtube_ids = models.JSONField(default=list, help_text="List of skipped YouTube IDs")
    
    # Learning data
    liked_channels = models.JSONField(default=list, help_text="Channels the user engages with positively")
    disliked_channels = models.JSONField(default=list, help_text="Channels the user skips frequently")
    
    # Settings
    max_history_size = models.IntegerField(default=50, help_text="Max tracks to remember for non-repeat")
    variety_level = models.IntegerField(default=50, help_text="0-100, higher = more variety, lower = stick to similar")
    
    # Timestamps
    started_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        verbose_name = "Radio Session"
        verbose_name_plural = "Radio Sessions"
    
    def __str__(self):
        return f"{self.user.username}'s radio ({self.mode}) - {'Active' if self.is_active else 'Stopped'}"
    
    def add_to_history(self, youtube_id: str, was_skipped: bool = False):
        """Add a track to the play/skip history"""
        if was_skipped:
            if youtube_id not in self.skipped_youtube_ids:
                self.skipped_youtube_ids.append(youtube_id)
                # Keep skip history smaller (recent skips matter most)
                if len(self.skipped_youtube_ids) > 30:
                    self.skipped_youtube_ids = self.skipped_youtube_ids[-30:]
        else:
            if youtube_id not in self.played_youtube_ids:
                self.played_youtube_ids.append(youtube_id)
                # Trim history to max size
                if len(self.played_youtube_ids) > self.max_history_size:
                    self.played_youtube_ids = self.played_youtube_ids[-self.max_history_size:]
        
        self.current_youtube_id = youtube_id
        self.save(update_fields=['played_youtube_ids', 'skipped_youtube_ids', 'current_youtube_id', 'updated_at'])
    
    def learn_from_channel(self, channel_id: str, positive: bool):
        """Learn channel preferences from user behavior"""
        if positive:
            if channel_id not in self.liked_channels:
                self.liked_channels.append(channel_id)
                if len(self.liked_channels) > 20:
                    self.liked_channels = self.liked_channels[-20:]
            # Remove from disliked if it was there
            if channel_id in self.disliked_channels:
                self.disliked_channels.remove(channel_id)
        else:
            if channel_id not in self.disliked_channels:
                self.disliked_channels.append(channel_id)
                if len(self.disliked_channels) > 20:
                    self.disliked_channels = self.disliked_channels[-20:]
        
        self.save(update_fields=['liked_channels', 'disliked_channels', 'updated_at'])
    
    def get_excluded_ids(self):
        """Get all IDs that should be excluded from next track selection"""
        excluded = set(self.played_youtube_ids[-20:])  # Recent plays
        excluded.update(self.skipped_youtube_ids[-10:])  # Recent skips
        if self.current_youtube_id:
            excluded.add(self.current_youtube_id)
        if self.seed_youtube_id:
            excluded.add(self.seed_youtube_id)
        return excluded
    
    def reset(self):
        """Reset the radio session (start fresh)"""
        self.played_youtube_ids = []
        self.skipped_youtube_ids = []
        self.current_youtube_id = ''
        self.save()


class RadioTrackFeedback(models.Model):
    """
    Stores feedback on tracks played during radio sessions.
    Used for improving recommendations over time.
    """
    FEEDBACK_CHOICES = [
        ('played', 'Played through'),        # User listened to most/all of track
        ('skipped', 'Skipped'),              # User skipped early
        ('liked', 'Liked'),                  # User explicitly liked (favorited)
        ('repeated', 'Repeated'),            # User played again
    ]
    
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='radio_feedback')
    youtube_id = models.CharField(max_length=50, db_index=True)
    channel_id = models.CharField(max_length=50, db_index=True)
    
    feedback_type = models.CharField(max_length=20, choices=FEEDBACK_CHOICES)
    
    # Context - what was playing when this feedback was given
    seed_youtube_id = models.CharField(max_length=50, blank=True)
    radio_mode = models.CharField(max_length=20, blank=True)
    
    # Timing
    listen_duration = models.IntegerField(default=0, help_text="How long user listened before skip/end")
    track_duration = models.IntegerField(default=0, help_text="Total track duration")
    
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', 'youtube_id']),
            models.Index(fields=['user', 'channel_id']),
            models.Index(fields=['user', '-created_at']),
        ]
    
    def __str__(self):
        return f"{self.user.username} - {self.feedback_type} - {self.youtube_id}"
    
    @property
    def listen_percentage(self):
        """What percentage of the track was listened to"""
        if self.track_duration == 0:
            return 0
        return min(100, int((self.listen_duration / self.track_duration) * 100))
