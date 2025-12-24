"""Lyrics models for audio tracks"""
from django.db import models
from audio.models import Audio


class Lyrics(models.Model):
    """Store lyrics for audio tracks"""
    
    audio = models.OneToOneField(
        Audio,
        on_delete=models.CASCADE,
        related_name='lyrics',
        primary_key=True
    )
    
    # Synced lyrics in LRC format [mm:ss.xx]text
    synced_lyrics = models.TextField(blank=True, default='')
    
    # Plain text lyrics without timestamps
    plain_lyrics = models.TextField(blank=True, default='')
    
    # Track is instrumental (no lyrics)
    is_instrumental = models.BooleanField(default=False)
    
    # Lyrics source (lrclib, genius, manual, etc.)
    source = models.CharField(max_length=50, default='lrclib')
    
    # Language code (en, es, fr, etc.)
    language = models.CharField(max_length=10, blank=True, default='')
    
    # When lyrics were fetched
    fetched_date = models.DateTimeField(auto_now=True)
    
    # Whether fetch was attempted (to avoid repeated failures)
    fetch_attempted = models.BooleanField(default=False)
    
    # Number of fetch attempts
    fetch_attempts = models.IntegerField(default=0)
    
    # Last fetch error message
    last_error = models.TextField(blank=True, default='')
    
    class Meta:
        verbose_name_plural = "Lyrics"
        ordering = ['-fetched_date']
    
    def __str__(self):
        return f"Lyrics for {self.audio.title}"
    
    @property
    def has_lyrics(self):
        """Check if lyrics are available"""
        return bool(self.synced_lyrics or self.plain_lyrics)
    
    @property
    def is_synced(self):
        """Check if lyrics are synchronized"""
        return bool(self.synced_lyrics)
    
    def get_display_lyrics(self):
        """Get lyrics for display (prefer synced over plain)"""
        if self.is_instrumental:
            return "[Instrumental]"
        return self.synced_lyrics or self.plain_lyrics or ""


class LyricsCache(models.Model):
    """Cache for LRCLIB API responses to avoid duplicate requests"""
    
    # Composite key: title + artist + album + duration
    title = models.CharField(max_length=500)
    artist_name = models.CharField(max_length=500)
    album_name = models.CharField(max_length=500, blank=True, default='')
    duration = models.IntegerField()  # Duration in seconds
    
    # Cached response
    synced_lyrics = models.TextField(blank=True, default='')
    plain_lyrics = models.TextField(blank=True, default='')
    is_instrumental = models.BooleanField(default=False)
    
    # Metadata
    language = models.CharField(max_length=10, blank=True, default='')
    source = models.CharField(max_length=50, default='lrclib')
    
    # Cache management
    cached_date = models.DateTimeField(auto_now_add=True)
    last_accessed = models.DateTimeField(auto_now=True)
    access_count = models.IntegerField(default=0)
    
    # Whether this is a "not found" cache entry
    not_found = models.BooleanField(default=False)
    
    class Meta:
        indexes = [
            models.Index(fields=['title', 'artist_name', 'duration']),
            models.Index(fields=['cached_date']),
        ]
        unique_together = [['title', 'artist_name', 'album_name', 'duration']]
    
    def __str__(self):
        return f"{self.title} - {self.artist_name}"
