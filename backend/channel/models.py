"""Channel models"""

from django.db import models
from django.contrib.auth import get_user_model

User = get_user_model()


class Channel(models.Model):
    """YouTube channel model"""
    # User isolation
    owner = models.ForeignKey(
        User, 
        on_delete=models.CASCADE, 
        related_name='channels',
        help_text="User who owns this channel subscription"
    )
    youtube_account = models.ForeignKey(
        'user.UserYouTubeAccount',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='channels',
        help_text="YouTube account used to subscribe to this channel"
    )
    
    channel_id = models.CharField(max_length=50, db_index=True)
    channel_name = models.CharField(max_length=200)
    channel_description = models.TextField(blank=True)
    channel_thumbnail = models.URLField(max_length=500, blank=True)
    subscribed = models.BooleanField(default=True)
    subscriber_count = models.IntegerField(default=0)
    video_count = models.IntegerField(default=0)
    last_refreshed = models.DateTimeField(auto_now=True)
    created_date = models.DateTimeField(auto_now_add=True)
    
    # Status tracking
    active = models.BooleanField(default=True, help_text="Channel is active and available")
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
    downloaded_count = models.IntegerField(default=0, help_text="Downloaded videos count")
    
    # Download settings per channel
    auto_download = models.BooleanField(default=True, help_text="Auto-download new videos from this channel")
    download_quality = models.CharField(
        max_length=20,
        default='auto',
        choices=[('auto', 'Auto'), ('low', 'Low'), ('medium', 'Medium'), ('high', 'High'), ('ultra', 'Ultra')]
    )

    class Meta:
        ordering = ['channel_name']
        unique_together = ('owner', 'channel_id')  # Each user can subscribe once per channel
        indexes = [
            models.Index(fields=['owner', 'channel_id']),
            models.Index(fields=['owner', 'subscribed']),
        ]

    def __str__(self):
        return f"{self.owner.username} - {self.channel_name}"
