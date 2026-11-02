"""Download queue models"""

from django.db import models
from django.contrib.auth import get_user_model

User = get_user_model()


def outstanding_counts(queue_rows):
    """Split queue rows into work still running and work that failed."""
    by_status = dict(queue_rows.order_by().values_list('status').annotate(models.Count('id')))
    return {
        'pending': by_status.get('pending', 0) + by_status.get('downloading', 0),
        'failed': by_status.get('failed', 0),
    }


class DownloadQueue(models.Model):
    """Download queue model"""
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('downloading', 'Downloading'),
        ('completed', 'Completed'),
        ('failed', 'Failed'),
        ('ignored', 'Ignored'),
    ]

    owner = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='download_queue',
        help_text="User who owns this download"
    )
    url = models.URLField(max_length=500)
    youtube_id = models.CharField(max_length=50, blank=True)
    title = models.CharField(max_length=500, blank=True)
    channel_name = models.CharField(max_length=200, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    error_message = models.TextField(blank=True)
    retry_count = models.PositiveIntegerField(
        default=0,
        help_text="Automatic re-queues since the last manual retry"
    )
    added_date = models.DateTimeField(auto_now_add=True)
    started_date = models.DateTimeField(null=True, blank=True)
    completed_date = models.DateTimeField(null=True, blank=True)
    auto_start = models.BooleanField(default=False)
    claim_token = models.UUIDField(
        null=True,
        blank=True,
        editable=False,
        help_text="Held by the worker allowed to finish this row"
    )
    lease_expires_at = models.DateTimeField(null=True, blank=True, editable=False)
    reserved_bytes = models.BigIntegerField(
        default=0,
        editable=False,
        help_text="Quota held while downloading"
    )
    source_playlist_id = models.CharField(
        max_length=100,
        blank=True,
        help_text="Playlist sync that queued this row"
    )

    class Meta:
        ordering = ['-auto_start', 'added_date']
        constraints = [
            models.UniqueConstraint(fields=['owner', 'url'], name='download_queue_unique_owner_url'),
        ]

    def __str__(self):
        return f"{self.title or self.url} - {self.status}"
