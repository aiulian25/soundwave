"""Playlist models"""

from django.db import models
from django.contrib.auth import get_user_model
from audio.models import Audio

User = get_user_model()


class Playlist(models.Model):
    """Playlist model"""
    PLAYLIST_TYPE_CHOICES = [
        ('youtube', 'YouTube Playlist'),
        ('custom', 'Custom Playlist'),
    ]

    # User isolation
    owner = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='playlists',
        help_text="User who owns this playlist"
    )
    
    playlist_id = models.CharField(max_length=100, db_index=True)
    title = models.CharField(max_length=500)
    description = models.TextField(blank=True)
    playlist_type = models.CharField(max_length=20, choices=PLAYLIST_TYPE_CHOICES, default='youtube')
    channel_id = models.CharField(max_length=50, blank=True)
    channel_name = models.CharField(max_length=200, blank=True)
    subscribed = models.BooleanField(default=False)
    thumbnail_url = models.URLField(max_length=500, blank=True)
    created_date = models.DateTimeField(auto_now_add=True)
    last_updated = models.DateTimeField(auto_now=True)
    
    # Status tracking (inspired by TubeArchivist)
    active = models.BooleanField(default=True, help_text="Playlist is active and available")
    last_refresh = models.DateTimeField(null=True, blank=True, help_text="Last time playlist metadata was refreshed")
    sync_status = models.CharField(
        max_length=20,
        choices=[
            ('pending', 'Pending'),
            ('syncing', 'Syncing'),
            ('success', 'Success'),
            ('failed', 'Failed'),
            ('stale', 'Stale'),
        ],
        default='pending',
        help_text="Current sync status"
    )
    error_message = models.TextField(blank=True, help_text="Last error message if sync failed")
    item_count = models.IntegerField(default=0, help_text="Total items in playlist")
    downloaded_count = models.IntegerField(default=0, help_text="Downloaded items count")
    
    # Download settings
    auto_download = models.BooleanField(default=False, help_text="Auto-download new items in this playlist")

    class Meta:
        ordering = ['-created_date']
        unique_together = ('owner', 'playlist_id')  # Each user can subscribe once per playlist
        indexes = [
            models.Index(fields=['owner', 'playlist_id']),
            models.Index(fields=['owner', 'subscribed']),
        ]

    def __str__(self):
        return f"{self.owner.username} - {self.title}"


class PlaylistItem(models.Model):
    """Playlist item (audio file in playlist)"""
    playlist = models.ForeignKey(Playlist, on_delete=models.CASCADE, related_name='items')
    audio = models.ForeignKey(Audio, on_delete=models.CASCADE, related_name='playlist_items')
    position = models.IntegerField(default=0)
    added_date = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('playlist', 'audio')
        ordering = ['position']

    def __str__(self):
        return f"{self.playlist.title} - {self.audio.title}"
