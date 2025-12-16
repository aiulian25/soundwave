"""Download queue models"""

from django.db import models
from django.contrib.auth import get_user_model

User = get_user_model()


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
    added_date = models.DateTimeField(auto_now_add=True)
    started_date = models.DateTimeField(null=True, blank=True)
    completed_date = models.DateTimeField(null=True, blank=True)
    auto_start = models.BooleanField(default=False)

    class Meta:
        ordering = ['-auto_start', 'added_date']

    def __str__(self):
        return f"{self.title or self.url} - {self.status}"
