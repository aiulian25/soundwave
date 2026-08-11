"""Audio models"""

import os
import logging
from pathlib import Path
from django.db import models
from django.contrib.auth import get_user_model
from django.conf import settings

User = get_user_model()
logger = logging.getLogger(__name__)


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
    view_count = models.BigIntegerField(default=0)
    like_count = models.BigIntegerField(default=0)
    audio_format = models.CharField(max_length=20, default='m4a')
    bitrate = models.IntegerField(null=True, blank=True, help_text="Bitrate in kbps")
    # Integrated loudness in LUFS (EBU R128), measured post-download for volume
    # normalization in the player (F9). Null until measured.
    loudness_lufs = models.FloatField(null=True, blank=True, help_text="Integrated loudness (LUFS)")
    # Chapter markers captured from yt-dlp at download: [{'title','start','end'}, ...] (F2)
    chapters = models.JSONField(default=list, blank=True, help_text="Chapter markers [{title,start,end}]")

    # Audio-feature analysis (F16), computed post-download by extract_features_task (librosa).
    # Null/empty until extracted; backfillable. Never user-supplied (derived from the file).
    bpm = models.FloatField(null=True, blank=True, help_text="Estimated tempo (beats/min)")
    music_key = models.CharField(max_length=8, blank=True, help_text="Estimated musical key, e.g. 'A'")
    energy = models.FloatField(null=True, blank=True, help_text="Normalized RMS energy 0..1")
    feature_vector = models.JSONField(default=list, blank=True, help_text="Normalized 6-dim sonic feature vector")

    # Enhanced metadata (from external sources)
    artist = models.CharField(max_length=500, blank=True, help_text="Artist name from metadata lookup")
    album = models.CharField(max_length=500, blank=True, help_text="Album name")
    year = models.IntegerField(null=True, blank=True, help_text="Release year")
    genre = models.CharField(max_length=100, blank=True, help_text="Music genre")
    track_number = models.IntegerField(null=True, blank=True, help_text="Track number on album")
    cover_art_url = models.URLField(max_length=500, blank=True, help_text="Cover art from metadata source")
    musicbrainz_id = models.CharField(max_length=50, blank=True, help_text="MusicBrainz recording ID")
    metadata_source = models.CharField(max_length=50, blank=True, help_text="Source of enhanced metadata")
    metadata_updated = models.DateTimeField(null=True, blank=True, help_text="When metadata was last updated")
    
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
        file_to_delete = Path(settings.MEDIA_ROOT) / self.file_path if self.file_path else None

        # Delete from database first so we don't orphan records if DB deletion fails.
        super().delete(*args, **kwargs)

        if file_to_delete:
            try:
                file_to_delete.unlink(missing_ok=True)
            except OSError as e:
                logger.warning("Could not delete audio file %s: %s", file_to_delete, e)


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
