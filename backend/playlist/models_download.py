"""Models for playlist download management"""

from django.db import models
from django.contrib.auth import get_user_model
from playlist.models import Playlist

User = get_user_model()


class PlaylistDownload(models.Model):
    """Track playlist download for offline playback"""
    
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('downloading', 'Downloading'),
        ('completed', 'Completed'),
        ('failed', 'Failed'),
        ('paused', 'Paused'),
    ]
    
    playlist = models.ForeignKey(
        Playlist,
        on_delete=models.CASCADE,
        related_name='downloads'
    )
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='playlist_downloads'
    )
    
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    
    # Progress tracking
    total_items = models.IntegerField(default=0)
    downloaded_items = models.IntegerField(default=0)
    failed_items = models.IntegerField(default=0)
    
    # Size tracking
    total_size_bytes = models.BigIntegerField(default=0, help_text="Total size in bytes")
    downloaded_size_bytes = models.BigIntegerField(default=0, help_text="Downloaded size in bytes")
    
    # Download settings
    quality = models.CharField(
        max_length=20,
        default='medium',
        choices=[('low', 'Low'), ('medium', 'Medium'), ('high', 'High'), ('ultra', 'Ultra')]
    )
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    
    # Error tracking
    error_message = models.TextField(blank=True)
    
    # Download location
    download_path = models.CharField(max_length=500, blank=True, help_text="Path to downloaded files")
    
    class Meta:
        ordering = ['-created_at']
        unique_together = ('playlist', 'user')
        indexes = [
            models.Index(fields=['user', 'status']),
            models.Index(fields=['playlist', 'status']),
        ]
    
    def __str__(self):
        return f"{self.user.username} - {self.playlist.title} ({self.status})"
    
    @property
    def progress_percent(self):
        """Calculate download progress percentage"""
        if self.total_items == 0:
            return 0
        return (self.downloaded_items / self.total_items) * 100
    
    @property
    def is_complete(self):
        """Check if download is complete"""
        return self.status == 'completed'
    
    @property
    def can_resume(self):
        """Check if download can be resumed"""
        return self.status in ['paused', 'failed']


class PlaylistDownloadItem(models.Model):
    """Track individual audio items in playlist download"""
    
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('downloading', 'Downloading'),
        ('completed', 'Completed'),
        ('failed', 'Failed'),
        ('skipped', 'Skipped'),
    ]
    
    download = models.ForeignKey(
        PlaylistDownload,
        on_delete=models.CASCADE,
        related_name='items'
    )
    audio = models.ForeignKey(
        'audio.Audio',
        on_delete=models.CASCADE,
        related_name='playlist_download_items'
    )
    
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    position = models.IntegerField(default=0)
    
    # Progress tracking
    file_size_bytes = models.BigIntegerField(default=0)
    downloaded_bytes = models.BigIntegerField(default=0)
    
    # Timestamps
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    
    # Error tracking
    error_message = models.TextField(blank=True)
    retry_count = models.IntegerField(default=0)
    
    class Meta:
        ordering = ['position']
        unique_together = ('download', 'audio')
    
    def __str__(self):
        return f"{self.download.playlist.title} - {self.audio.title} ({self.status})"
    
    @property
    def progress_percent(self):
        """Calculate item download progress"""
        if self.file_size_bytes == 0:
            return 0
        return (self.downloaded_bytes / self.file_size_bytes) * 100
