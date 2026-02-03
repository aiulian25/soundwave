"""Playlist admin"""

from django.contrib import admin
from playlist.models import Playlist, PlaylistItem
from playlist.models_smart import SmartPlaylist, SmartPlaylistRule


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


class SmartPlaylistRuleInline(admin.TabularInline):
    """Inline for smart playlist rules"""
    model = SmartPlaylistRule
    extra = 1
    ordering = ['order']


@admin.register(SmartPlaylist)
class SmartPlaylistAdmin(admin.ModelAdmin):
    """Smart playlist admin"""
    list_display = ('name', 'owner', 'is_system', 'preset_type', 'match_mode', 'order_by', 'limit', 'cached_count', 'created_date')
    list_filter = ('is_system', 'preset_type', 'match_mode', 'order_by')
    search_fields = ('name', 'description', 'owner__username')
    readonly_fields = ('cached_count', 'cache_updated', 'created_date', 'last_updated')
    inlines = [SmartPlaylistRuleInline]


@admin.register(SmartPlaylistRule)
class SmartPlaylistRuleAdmin(admin.ModelAdmin):
    """Smart playlist rule admin"""
    list_display = ('smart_playlist', 'field', 'operator', 'value', 'order')
    list_filter = ('field', 'operator')
    search_fields = ('smart_playlist__name', 'value')
