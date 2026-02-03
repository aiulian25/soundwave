"""Playback sync models for cross-device playback continuity"""

from django.db import models
from django.contrib.auth import get_user_model
from django.utils import timezone

User = get_user_model()


class PlaybackSession(models.Model):
    """
    Stores the user's current playback state for cross-device sync.
    Only one active session per user - always overwrites on update.
    """
    user = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        related_name='playback_session',
        primary_key=True,
        help_text="User who owns this playback session"
    )
    
    # Current track info
    youtube_id = models.CharField(
        max_length=50,
        db_index=True,
        help_text="YouTube ID of the currently playing track"
    )
    
    # Playback position
    position = models.FloatField(
        default=0,
        help_text="Current playback position in seconds"
    )
    
    # Track duration for reference
    duration = models.IntegerField(
        default=0,
        help_text="Total track duration in seconds"
    )
    
    # Playback state
    is_playing = models.BooleanField(
        default=False,
        help_text="Whether playback was active when last synced"
    )
    
    # Volume and settings
    volume = models.IntegerField(
        default=100,
        help_text="Volume level (0-100)"
    )
    
    # Queue info (optional - for restoring queue context)
    queue_youtube_ids = models.JSONField(
        default=list,
        blank=True,
        help_text="List of YouTube IDs in the current queue"
    )
    queue_index = models.IntegerField(
        default=0,
        help_text="Current position in the queue"
    )
    
    # Device info
    device_id = models.CharField(
        max_length=100,
        blank=True,
        help_text="Identifier of the device that last synced"
    )
    device_name = models.CharField(
        max_length=200,
        blank=True,
        help_text="Name/type of the device that last synced"
    )
    
    # Timestamps
    updated_at = models.DateTimeField(
        auto_now=True,
        help_text="When the session was last updated"
    )
    
    class Meta:
        verbose_name = "Playback Session"
        verbose_name_plural = "Playback Sessions"
    
    def __str__(self):
        return f"{self.user.username}'s playback session - {self.youtube_id} at {self.position:.1f}s"
    
    @property
    def is_stale(self):
        """Check if session is older than 30 days"""
        return (timezone.now() - self.updated_at).days > 30
    
    @property
    def seconds_since_update(self):
        """Get seconds since last update"""
        return (timezone.now() - self.updated_at).total_seconds()
