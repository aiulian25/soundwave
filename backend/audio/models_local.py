"""Models for user-uploaded local audio files"""

from django.db import models
from django.contrib.auth import get_user_model
import os

User = get_user_model()


class LocalAudio(models.Model):
    """User-uploaded local audio files"""
    
    owner = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='local_audio_files',
        help_text="User who uploaded this file"
    )
    
    # File info
    title = models.CharField(max_length=500)
    artist = models.CharField(max_length=200, blank=True)
    album = models.CharField(max_length=200, blank=True)
    year = models.IntegerField(null=True, blank=True)
    genre = models.CharField(max_length=100, blank=True)
    track_number = models.IntegerField(null=True, blank=True)
    
    # File details
    file = models.FileField(upload_to='local_audio/%Y/%m/', max_length=500)
    file_size = models.BigIntegerField(help_text="File size in bytes")
    duration = models.IntegerField(null=True, blank=True, help_text="Duration in seconds")
    
    # Audio properties
    audio_format = models.CharField(max_length=20, blank=True)  # mp3, flac, m4a, etc.
    bitrate = models.IntegerField(null=True, blank=True, help_text="Bitrate in kbps")
    sample_rate = models.IntegerField(null=True, blank=True, help_text="Sample rate in Hz")
    channels = models.IntegerField(null=True, blank=True, help_text="Number of audio channels")
    
    # Cover art
    cover_art = models.ImageField(upload_to='local_audio_covers/%Y/%m/', null=True, blank=True)
    
    # Metadata
    original_filename = models.CharField(max_length=500)
    uploaded_date = models.DateTimeField(auto_now_add=True)
    modified_date = models.DateTimeField(auto_now=True)
    
    # Playback tracking
    play_count = models.IntegerField(default=0)
    last_played = models.DateTimeField(null=True, blank=True)
    
    # Tags and organization
    tags = models.JSONField(default=list, blank=True, help_text="User-defined tags")
    notes = models.TextField(blank=True, help_text="User notes about this file")
    
    # Favorites
    is_favorite = models.BooleanField(default=False)
    
    class Meta:
        ordering = ['-uploaded_date']
        indexes = [
            models.Index(fields=['owner', '-uploaded_date']),
            models.Index(fields=['owner', 'is_favorite']),
            models.Index(fields=['owner', 'artist']),
            models.Index(fields=['owner', 'album']),
        ]
    
    def __str__(self):
        return f"{self.owner.username} - {self.title}"
    
    @property
    def file_size_mb(self):
        """Get file size in MB"""
        return self.file_size / (1024 * 1024)
    
    @property
    def duration_formatted(self):
        """Get formatted duration (MM:SS)"""
        if not self.duration:
            return "00:00"
        minutes = self.duration // 60
        seconds = self.duration % 60
        return f"{minutes:02d}:{seconds:02d}"
    
    def delete(self, *args, **kwargs):
        """Override delete to remove files"""
        # Delete the audio file
        if self.file:
            if os.path.isfile(self.file.path):
                os.remove(self.file.path)
        
        # Delete cover art
        if self.cover_art:
            if os.path.isfile(self.cover_art.path):
                os.remove(self.cover_art.path)
        
        super().delete(*args, **kwargs)


class LocalAudioPlaylist(models.Model):
    """Playlists for local audio files"""
    
    owner = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='local_playlists'
    )
    
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    
    # Playlist image
    cover_image = models.ImageField(upload_to='local_playlist_covers/', null=True, blank=True)
    
    # Timestamps
    created_date = models.DateTimeField(auto_now_add=True)
    modified_date = models.DateTimeField(auto_now=True)
    
    class Meta:
        ordering = ['-created_date']
        indexes = [
            models.Index(fields=['owner', '-created_date']),
        ]
    
    def __str__(self):
        return f"{self.owner.username} - {self.title}"


class LocalAudioPlaylistItem(models.Model):
    """Items in local audio playlist"""
    
    playlist = models.ForeignKey(
        LocalAudioPlaylist,
        on_delete=models.CASCADE,
        related_name='items'
    )
    audio = models.ForeignKey(
        LocalAudio,
        on_delete=models.CASCADE,
        related_name='playlist_items'
    )
    position = models.IntegerField(default=0)
    added_date = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        ordering = ['position']
        unique_together = ('playlist', 'audio')
    
    def __str__(self):
        return f"{self.playlist.title} - {self.audio.title}"
