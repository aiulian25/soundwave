"""A playlist export too big for a web request, tracked from queue to expiry."""

import uuid

from django.conf import settings
from django.db import models

STATUS_QUEUED = 'queued'
STATUS_RUNNING = 'running'
STATUS_READY = 'ready'
STATUS_FAILED = 'failed'
STATUS_CANCELED = 'canceled'
STATUS_EXPIRED = 'expired'
ACTIVE_STATUSES = (STATUS_QUEUED, STATUS_RUNNING)


class ExportJob(models.Model):
    STATUS_CHOICES = [
        (STATUS_QUEUED, 'Queued'),
        (STATUS_RUNNING, 'Running'),
        (STATUS_READY, 'Ready'),
        (STATUS_FAILED, 'Failed'),
        (STATUS_CANCELED, 'Canceled'),
        (STATUS_EXPIRED, 'Expired'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='export_jobs')
    playlist = models.ForeignKey('playlist.Playlist', on_delete=models.CASCADE, related_name='export_jobs')
    options = models.JSONField(default=dict)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_QUEUED)
    tracks_done = models.IntegerField(default=0)
    tracks_total = models.IntegerField(default=0)
    scratch_dir = models.CharField(max_length=500, blank=True)
    file_name = models.CharField(max_length=255, blank=True)
    file_bytes = models.BigIntegerField(default=0)
    summary = models.JSONField(default=dict, blank=True)
    error_message = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['owner', 'status'])]
