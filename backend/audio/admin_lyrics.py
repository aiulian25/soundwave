"""Admin interface for lyrics"""
from django.contrib import admin
from audio.models_lyrics import Lyrics, LyricsCache


@admin.register(Lyrics)
class LyricsAdmin(admin.ModelAdmin):
    """Admin for Lyrics model"""
    
    list_display = [
        'audio',
        'has_lyrics',
        'is_synced',
        'is_instrumental',
        'source',
        'language',
        'fetch_attempted',
        'fetch_attempts',
        'fetched_date',
    ]
    
    list_filter = [
        'is_instrumental',
        'source',
        'language',
        'fetch_attempted',
        'fetched_date',
    ]
    
    search_fields = [
        'audio__title',
        'audio__channel_name',
        'audio__youtube_id',
    ]
    
    readonly_fields = [
        'audio',
        'fetched_date',
        'has_lyrics',
        'is_synced',
    ]
    
    fieldsets = (
        ('Audio Information', {
            'fields': ('audio',)
        }),
        ('Lyrics', {
            'fields': ('synced_lyrics', 'plain_lyrics', 'is_instrumental')
        }),
        ('Metadata', {
            'fields': ('source', 'language')
        }),
        ('Fetch Status', {
            'fields': ('fetch_attempted', 'fetch_attempts', 'last_error', 'fetched_date')
        }),
        ('Properties', {
            'fields': ('has_lyrics', 'is_synced'),
            'classes': ('collapse',)
        }),
    )


@admin.register(LyricsCache)
class LyricsCacheAdmin(admin.ModelAdmin):
    """Admin for LyricsCache model"""
    
    list_display = [
        'title',
        'artist_name',
        'duration',
        'source',
        'cached_date',
        'access_count',
        'not_found',
    ]
    
    list_filter = [
        'source',
        'not_found',
        'cached_date',
        'language',
    ]
    
    search_fields = [
        'title',
        'artist_name',
        'album_name',
    ]
    
    readonly_fields = [
        'cached_date',
        'last_accessed',
        'access_count',
    ]
    
    fieldsets = (
        ('Track Information', {
            'fields': ('title', 'artist_name', 'album_name', 'duration')
        }),
        ('Cached Lyrics', {
            'fields': ('synced_lyrics', 'plain_lyrics', 'is_instrumental')
        }),
        ('Metadata', {
            'fields': ('source', 'language', 'not_found')
        }),
        ('Cache Statistics', {
            'fields': ('cached_date', 'last_accessed', 'access_count')
        }),
    )
    
    actions = ['clear_not_found']
    
    def clear_not_found(self, request, queryset):
        """Clear not_found cache entries"""
        count = queryset.filter(not_found=True).delete()[0]
        self.message_user(request, f'Cleared {count} not_found cache entries')
    clear_not_found.short_description = 'Clear not_found entries'
