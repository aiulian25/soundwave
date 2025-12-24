"""Models for artwork and metadata"""
from django.db import models
from audio.models import Audio
from channel.models import Channel


class Artwork(models.Model):
    """Store artwork/cover art for audio and channels"""
    
    ARTWORK_TYPE_CHOICES = [
        ('audio_thumbnail', 'Audio Thumbnail'),
        ('audio_cover', 'Audio Cover Art'),
        ('album_cover', 'Album Cover'),
        ('artist_image', 'Artist Image'),
        ('artist_banner', 'Artist Banner'),
        ('artist_logo', 'Artist Logo'),
    ]
    
    SOURCE_CHOICES = [
        ('youtube', 'YouTube'),
        ('lastfm', 'Last.fm'),
        ('fanart', 'Fanart.tv'),
        ('manual', 'Manual Upload'),
    ]
    
    # Related objects
    audio = models.ForeignKey(
        Audio,
        on_delete=models.CASCADE,
        related_name='artworks',
        null=True,
        blank=True
    )
    channel = models.ForeignKey(
        Channel,
        on_delete=models.CASCADE,
        related_name='artworks',
        null=True,
        blank=True
    )
    
    # Artwork details
    artwork_type = models.CharField(max_length=50, choices=ARTWORK_TYPE_CHOICES)
    source = models.CharField(max_length=50, choices=SOURCE_CHOICES)
    url = models.URLField(max_length=1000)
    local_path = models.CharField(max_length=500, blank=True, default='')
    
    # Image metadata
    width = models.IntegerField(null=True, blank=True)
    height = models.IntegerField(null=True, blank=True)
    file_size = models.IntegerField(null=True, blank=True, help_text="Size in bytes")
    
    # Priority for display (higher = preferred)
    priority = models.IntegerField(default=0)
    
    # Metadata
    fetched_date = models.DateTimeField(auto_now_add=True)
    is_primary = models.BooleanField(default=False)
    
    class Meta:
        ordering = ['-priority', '-fetched_date']
        indexes = [
            models.Index(fields=['audio', 'artwork_type']),
            models.Index(fields=['channel', 'artwork_type']),
            models.Index(fields=['is_primary']),
        ]
    
    def __str__(self):
        if self.audio:
            return f"{self.artwork_type} for {self.audio.title} ({self.source})"
        elif self.channel:
            return f"{self.artwork_type} for {self.channel.channel_name} ({self.source})"
        return f"{self.artwork_type} ({self.source})"


class MusicMetadata(models.Model):
    """Extended music metadata from Last.fm and other sources"""
    
    audio = models.OneToOneField(
        Audio,
        on_delete=models.CASCADE,
        related_name='music_metadata',
        primary_key=True
    )
    
    # Album information
    album_name = models.CharField(max_length=500, blank=True, default='')
    album_artist = models.CharField(max_length=500, blank=True, default='')
    release_year = models.IntegerField(null=True, blank=True)
    
    # Track information
    track_number = models.IntegerField(null=True, blank=True)
    disc_number = models.IntegerField(null=True, blank=True)
    
    # Additional metadata
    genre = models.CharField(max_length=200, blank=True, default='')
    tags = models.JSONField(default=list, blank=True)  # List of tags
    
    # Last.fm specific
    lastfm_url = models.URLField(max_length=500, blank=True, default='')
    lastfm_mbid = models.CharField(max_length=100, blank=True, default='', help_text="MusicBrainz ID")
    play_count = models.IntegerField(default=0, help_text="Global play count from Last.fm")
    listeners = models.IntegerField(default=0, help_text="Unique listeners from Last.fm")
    
    # Fanart.tv IDs
    fanart_artist_id = models.CharField(max_length=100, blank=True, default='')
    fanart_album_id = models.CharField(max_length=100, blank=True, default='')
    
    # Metadata status
    metadata_fetched = models.BooleanField(default=False)
    last_updated = models.DateTimeField(auto_now=True)
    
    class Meta:
        verbose_name_plural = "Music Metadata"
    
    def __str__(self):
        return f"Metadata for {self.audio.title}"


class ArtistInfo(models.Model):
    """Store artist/channel information from Last.fm and Fanart.tv"""
    
    channel = models.OneToOneField(
        Channel,
        on_delete=models.CASCADE,
        related_name='artist_info',
        primary_key=True
    )
    
    # Basic info
    bio = models.TextField(blank=True, default='')
    bio_summary = models.TextField(blank=True, default='')
    
    # Links
    lastfm_url = models.URLField(max_length=500, blank=True, default='')
    lastfm_mbid = models.CharField(max_length=100, blank=True, default='')
    
    # Stats
    lastfm_listeners = models.IntegerField(default=0)
    lastfm_playcount = models.IntegerField(default=0)
    
    # Tags/Genres
    tags = models.JSONField(default=list, blank=True)
    
    # Fanart.tv ID
    fanart_id = models.CharField(max_length=100, blank=True, default='')
    
    # Social links from Last.fm
    similar_artists = models.JSONField(default=list, blank=True)
    
    # Status
    metadata_fetched = models.BooleanField(default=False)
    last_updated = models.DateTimeField(auto_now=True)
    
    class Meta:
        verbose_name_plural = "Artist Info"
    
    def __str__(self):
        return f"Info for {self.channel.channel_name}"
