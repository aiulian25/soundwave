"""Stats models"""

from django.db import models
from django.contrib.auth import get_user_model

User = get_user_model()


class ListeningHistory(models.Model):
    """Track individual listening events for analytics"""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='listening_history')
    audio = models.ForeignKey('audio.Audio', on_delete=models.CASCADE, related_name='listening_events')
    
    # Track info at time of listen (denormalized for historical accuracy)
    artist = models.CharField(max_length=255, blank=True)
    title = models.CharField(max_length=500)
    channel_name = models.CharField(max_length=200)
    genre = models.CharField(max_length=100, blank=True, default='')
    
    # Listening details
    listened_at = models.DateTimeField(auto_now_add=True)
    duration_listened = models.IntegerField(default=0, help_text="Duration listened in seconds")
    completed = models.BooleanField(default=False, help_text="Whether the track was fully played")
    
    class Meta:
        ordering = ['-listened_at']
        indexes = [
            models.Index(fields=['user', '-listened_at']),
            models.Index(fields=['user', 'artist']),
            models.Index(fields=['user', 'channel_name']),
            models.Index(fields=['user', 'genre']),
        ]
        verbose_name_plural = 'Listening history'
    
    def __str__(self):
        return f"{self.user.username} - {self.title} @ {self.listened_at}"
