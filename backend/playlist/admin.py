"""Playlist admin"""

from django.contrib import admin
from playlist.models import Playlist, PlaylistItem


@admin.register(Playlist)
class PlaylistAdmin(admin.ModelAdmin):
    """Playlist admin"""
    list_display = ('title', 'playlist_type', 'subscribed', 'created_date')
    list_filter = ('playlist_type', 'subscribed')
    search_fields = ('title', 'playlist_id')


@admin.register(PlaylistItem)
class PlaylistItemAdmin(admin.ModelAdmin):
    """Playlist item admin"""
    list_display = ('playlist', 'audio', 'position', 'added_date')
    list_filter = ('playlist', 'added_date')
