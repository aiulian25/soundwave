"""Audio models"""

import os
from pathlib import Path
from django.db import models
from django.contrib.auth import get_user_model
from django.conf import settings

User = get_user_model()


class Audio(models.Model):
    """Audio file model"""
    # User isolation
    owner = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='audio_files',
        help_text="User who owns this audio file"
    )
    
    youtube_id = models.CharField(max_length=50, db_index=True)
    title = models.CharField(max_length=500)
    description = models.TextField(blank=True)
    channel_id = models.CharField(max_length=50, db_index=True)
    channel_name = models.CharField(max_length=200)
    duration = models.IntegerField(help_text="Duration in seconds")
    file_path = models.CharField(max_length=500)
    file_size = models.BigIntegerField(help_text="File size in bytes")
    thumbnail_url = models.URLField(max_length=500, blank=True)
    published_date = models.DateTimeField()
    downloaded_date = models.DateTimeField(auto_now_add=True)
    view_count = models.IntegerField(default=0)
    like_count = models.IntegerField(default=0)
    audio_format = models.CharField(max_length=20, default='m4a')
    bitrate = models.IntegerField(null=True, blank=True, help_text="Bitrate in kbps")
    
    # Playback tracking
    play_count = models.IntegerField(default=0)
    last_played = models.DateTimeField(null=True, blank=True)
    
    # Favorites
    is_favorite = models.BooleanField(default=False)
    
    class Meta:
        ordering = ['-published_date']
        unique_together = ('owner', 'youtube_id')  # Each user can have one copy of each video
        indexes = [
            models.Index(fields=['owner', 'youtube_id']),
            models.Index(fields=['owner', 'channel_id']),
            models.Index(fields=['owner', '-published_date']),
            models.Index(fields=['owner', 'is_favorite']),
        ]

    def __str__(self):
        return f"{self.owner.username} - {self.title}"
    
    @property
    def downloaded(self):
        """Check if audio file has been downloaded"""
        return bool(self.file_path)
    
    @property
    def has_lyrics(self):
        """Check if audio has lyrics"""
        return hasattr(self, 'lyrics') and self.lyrics.has_lyrics
    
    def delete(self, *args, **kwargs):
        """Override delete to remove audio file from filesystem"""
        if self.file_path:
            # Construct full path to the audio file
            full_path = Path(settings.MEDIA_ROOT) / self.file_path
            try:
                if full_path.exists():
                    full_path.unlink()  # Delete the file
            except (OSError, IOError) as e:
                # Log error but continue with database deletion
                print(f"Warning: Could not delete audio file {full_path}: {e}")
        
        # Delete from database
        super().delete(*args, **kwargs)


class Channel(models.Model):
    """YouTube channel model"""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='audio_channels')
    channel_id = models.CharField(max_length=100)
    channel_name = models.CharField(max_length=255)
    channel_description = models.TextField(blank=True)
    channel_thumbnail = models.URLField(blank=True)
    subscribed = models.BooleanField(default=False)
    subscriber_count = models.IntegerField(default=0)
    video_count = models.IntegerField(default=0)
    last_updated = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('user', 'channel_id')
        indexes = [
            models.Index(fields=['user', 'channel_id']),
            models.Index(fields=['user', 'subscribed']),
        ]

    def __str__(self):
        return f"{self.channel_name} ({self.user.username})"


class AudioProgress(models.Model):
    """Track user progress on audio files"""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='audio_progress')
    audio = models.ForeignKey(Audio, on_delete=models.CASCADE, related_name='user_progress')
    position = models.IntegerField(default=0, help_text="Current position in seconds")
    completed = models.BooleanField(default=False)
    last_updated = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('user', 'audio')
        indexes = [
            models.Index(fields=['user', 'audio']),
        ]

    def __str__(self):
        return f"{self.user.username} - {self.audio.title}"
