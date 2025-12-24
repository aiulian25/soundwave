"""Audio admin"""

from django.contrib import admin
from audio.models import Audio, AudioProgress


@admin.register(Audio)
class AudioAdmin(admin.ModelAdmin):
    """Audio admin"""
    list_display = ('title', 'channel_name', 'duration', 'published_date', 'play_count', 'has_lyrics')
    list_filter = ('channel_name', 'audio_format', 'published_date')
    search_fields = ('title', 'channel_name', 'youtube_id')
    readonly_fields = ('downloaded_date', 'play_count', 'last_played', 'downloaded', 'has_lyrics')


@admin.register(AudioProgress)
class AudioProgressAdmin(admin.ModelAdmin):
    """Audio progress admin"""
    list_display = ('user', 'audio', 'position', 'completed', 'last_updated')
    list_filter = ('completed', 'last_updated')
    search_fields = ('user__username', 'audio__title')


# Import lyrics admin
from audio.admin_lyrics import *  # noqa
