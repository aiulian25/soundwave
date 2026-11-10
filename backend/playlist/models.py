"""Playlist models"""

from django.db import models
from django.contrib.auth import get_user_model
from audio.models import Audio
from audio.storage_service import count_files_on_disk

User = get_user_model()


ARTWORK_PATH_TEMPLATE = '/api/playlist/{playlist_id}/artwork/'


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
    item_count = models.IntegerField(
        default=0,
        help_text="YouTube: tracks in the last complete scan. Custom: tracks added",
    )
    downloaded_count = models.IntegerField(default=0, help_text="Member tracks whose file is on disk")
    remote_video_ids = models.JSONField(
        default=list,
        blank=True,
        help_text="Video ids of the last complete YouTube scan, in playlist order",
    )
    remote_unavailable_count = models.IntegerField(
        default=0,
        help_text="Deleted or private entries of the last complete scan with no local copy",
    )
    
    # Download settings
    auto_download = models.BooleanField(default=False, help_text="Auto-download new items in this playlist")

    class Meta:
        ordering = ['-created_date']
        unique_together = ('owner', 'playlist_id')  # Each user can subscribe once per playlist
        indexes = [
            models.Index(fields=['owner', 'playlist_id']),
            models.Index(fields=['owner', 'subscribed']),
        ]

    @property
    def artwork_url(self):
        """Where clients load the cover: always this server, never the host `thumbnail_url` names."""
        return ARTWORK_PATH_TEMPLATE.format(playlist_id=self.playlist_id) if self.thumbnail_url else ''

    def __str__(self):
        return f"{self.owner.username} - {self.title}"

    @property
    def remote_total(self):
        """Tracks YouTube lists for this playlist; custom playlists have no remote side."""
        if self.playlist_type == 'custom':
            return None
        return self.item_count

    def refresh_local_counts(self):
        tracks = Audio.objects.filter(playlist_items__playlist=self)
        self.downloaded_count = count_files_on_disk(tracks)
        changed_fields = ['downloaded_count']
        if self.playlist_type == 'custom':
            self.item_count = tracks.count()
            changed_fields.append('item_count')
        self.save(update_fields=changed_fields)


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
