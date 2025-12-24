"""Admin configuration for artwork and metadata"""
from django.contrib import admin
from audio.models_artwork import Artwork, MusicMetadata, ArtistInfo


@admin.register(Artwork)
class ArtworkAdmin(admin.ModelAdmin):
    """Admin for Artwork model"""
    
    list_display = [
        'id',
        'audio',
        'channel',
        'artwork_type',
        'source',
        'priority',
        'is_primary',
        'has_local_file',
        'created_at',
    ]
    list_filter = [
        'artwork_type',
        'source',
        'is_primary',
        'created_at',
    ]
    search_fields = [
        'audio__audio_title',
        'channel__channel_name',
        'url',
    ]
    readonly_fields = ['created_at']
    ordering = ['-priority', '-created_at']
    
    fieldsets = (
        ('Related Objects', {
            'fields': ('audio', 'channel')
        }),
        ('Artwork Details', {
            'fields': ('artwork_type', 'source', 'url', 'local_path')
        }),
        ('Image Properties', {
            'fields': ('width', 'height', 'priority', 'is_primary')
        }),
        ('Metadata', {
            'fields': ('created_at',)
        }),
    )
    
    def has_local_file(self, obj):
        """Check if artwork has local file"""
        return bool(obj.local_path)
    has_local_file.boolean = True
    has_local_file.short_description = 'Local File'
    
    actions = ['download_artwork', 'set_as_primary']
    
    def download_artwork(self, request, queryset):
        """Download artwork from URLs"""
        from audio.tasks_artwork import download_artwork
        count = 0
        for artwork in queryset:
            if artwork.url:
                download_artwork.delay(artwork.id)
                count += 1
        self.message_user(request, f'Queued {count} artwork downloads')
    download_artwork.short_description = 'Download selected artwork'
    
    def set_as_primary(self, request, queryset):
        """Set selected artwork as primary"""
        count = 0
        for artwork in queryset:
            # Unset other primary
            if artwork.audio:
                Artwork.objects.filter(
                    audio=artwork.audio,
                    artwork_type=artwork.artwork_type
                ).update(is_primary=False)
            elif artwork.channel:
                Artwork.objects.filter(
                    channel=artwork.channel,
                    artwork_type=artwork.artwork_type
                ).update(is_primary=False)
            
            artwork.is_primary = True
            artwork.save()
            count += 1
        self.message_user(request, f'Set {count} artwork as primary')
    set_as_primary.short_description = 'Set as primary'


@admin.register(MusicMetadata)
class MusicMetadataAdmin(admin.ModelAdmin):
    """Admin for MusicMetadata model"""
    
    list_display = [
        'id',
        'audio',
        'album_name',
        'album_artist',
        'genre',
        'release_year',
        'play_count',
        'listeners',
        'updated_at',
    ]
    list_filter = [
        'genre',
        'release_year',
        'updated_at',
    ]
    search_fields = [
        'audio__audio_title',
        'album_name',
        'album_artist',
        'genre',
    ]
    readonly_fields = ['created_at', 'updated_at']
    ordering = ['-updated_at']
    
    fieldsets = (
        ('Audio', {
            'fields': ('audio',)
        }),
        ('Album Information', {
            'fields': (
                'album_name',
                'album_artist',
                'release_year',
                'track_number',
                'disc_number',
            )
        }),
        ('Genre & Tags', {
            'fields': ('genre', 'tags')
        }),
        ('Last.fm Data', {
            'fields': (
                'lastfm_url',
                'lastfm_mbid',
                'play_count',
                'listeners',
            )
        }),
        ('Fanart.tv IDs', {
            'fields': ('fanart_artist_id', 'fanart_album_id')
        }),
        ('Metadata', {
            'fields': ('created_at', 'updated_at')
        }),
    )
    
    actions = ['fetch_from_lastfm', 'update_id3_tags']
    
    def fetch_from_lastfm(self, request, queryset):
        """Fetch metadata from Last.fm"""
        from audio.tasks_artwork import fetch_metadata_for_audio
        count = 0
        for metadata in queryset:
            fetch_metadata_for_audio.delay(metadata.audio.id)
            count += 1
        self.message_user(request, f'Queued {count} metadata fetches')
    fetch_from_lastfm.short_description = 'Fetch from Last.fm'
    
    def update_id3_tags(self, request, queryset):
        """Update ID3 tags in audio files"""
        from audio.tasks_artwork import update_id3_tags_from_metadata
        count = 0
        for metadata in queryset:
            update_id3_tags_from_metadata.delay(metadata.audio.id)
            count += 1
        self.message_user(request, f'Queued {count} ID3 tag updates')
    update_id3_tags.short_description = 'Update ID3 tags'


@admin.register(ArtistInfo)
class ArtistInfoAdmin(admin.ModelAdmin):
    """Admin for ArtistInfo model"""
    
    list_display = [
        'id',
        'channel',
        'lastfm_listeners',
        'lastfm_playcount',
        'has_bio',
        'tags_count',
        'updated_at',
    ]
    list_filter = [
        'updated_at',
    ]
    search_fields = [
        'channel__channel_name',
        'bio',
        'tags',
    ]
    readonly_fields = ['created_at', 'updated_at']
    ordering = ['-updated_at']
    
    fieldsets = (
        ('Channel', {
            'fields': ('channel',)
        }),
        ('Biography', {
            'fields': ('bio', 'bio_summary')
        }),
        ('Last.fm Data', {
            'fields': (
                'lastfm_url',
                'lastfm_mbid',
                'lastfm_listeners',
                'lastfm_playcount',
            )
        }),
        ('Tags & Similar', {
            'fields': ('tags', 'similar_artists')
        }),
        ('Fanart.tv', {
            'fields': ('fanart_id',)
        }),
        ('Metadata', {
            'fields': ('created_at', 'updated_at')
        }),
    )
    
    def has_bio(self, obj):
        """Check if artist has bio"""
        return bool(obj.bio)
    has_bio.boolean = True
    has_bio.short_description = 'Has Bio'
    
    def tags_count(self, obj):
        """Get number of tags"""
        return len(obj.tags) if obj.tags else 0
    tags_count.short_description = 'Tags'
    
    actions = ['fetch_from_lastfm']
    
    def fetch_from_lastfm(self, request, queryset):
        """Fetch artist info from Last.fm"""
        from audio.tasks_artwork import fetch_artist_info
        count = 0
        for artist_info in queryset:
            fetch_artist_info.delay(artist_info.channel.id)
            count += 1
        self.message_user(request, f'Queued {count} artist info fetches')
    fetch_from_lastfm.short_description = 'Fetch from Last.fm'
