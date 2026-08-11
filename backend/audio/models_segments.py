"""Audio segment model (F3) — virtual "tracks" within a single long mix.

Each AudioSegment marks a start/end offset (and a title) inside one downloaded Audio
file, produced by splitting a mix's tracklist (from F2 chapters, else the parsed
description). They are surfaced to the player as navigable parts.
"""

from django.db import models

from audio.models import Audio


class AudioSegment(models.Model):
    """A titled start/end slice of a single Audio file."""

    audio = models.ForeignKey(
        Audio,
        on_delete=models.CASCADE,
        related_name='segments',
        help_text="The mix this segment belongs to",
    )
    title = models.CharField(max_length=500, blank=True)
    start_seconds = models.FloatField(help_text="Segment start offset in seconds")
    end_seconds = models.FloatField(help_text="Segment end offset in seconds")
    order = models.IntegerField(default=0, help_text="Position within the split")
    created_date = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['order']
        indexes = [
            models.Index(fields=['audio', 'order']),
        ]

    def __str__(self):
        return f"{self.audio.title} · {self.title or self.order}"
