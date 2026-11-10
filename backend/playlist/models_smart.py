"""Smart Playlist models - Dynamic auto-updating playlists"""

import random

from django.db import models, transaction
from django.db.models import Case, When
from django.contrib.auth import get_user_model
from django.utils import timezone

from playlist.smart_rules import RATING_FIELD, InvalidRule, rule_is_valid, rules_predicate

User = get_user_model()

RANDOM_ORDER = 'random'


class SmartPlaylistRule(models.Model):
    """Individual rule for smart playlist matching"""
    
    FIELD_CHOICES = [
        # Audio metadata fields
        ('title', 'Title'),
        ('artist', 'Artist'),
        ('album', 'Album'),
        ('genre', 'Genre'),
        ('channel_name', 'Channel Name'),
        ('year', 'Year'),
        # Stats fields
        ('play_count', 'Play Count'),
        ('last_played', 'Last Played'),
        ('downloaded_date', 'Date Added'),
        ('duration', 'Duration (seconds)'),
        (RATING_FIELD, 'Rating (stars)'),
        # Boolean fields
        ('is_favorite', 'Is Favorite'),
    ]
    
    OPERATOR_CHOICES = [
        # Text operators
        ('contains', 'Contains'),
        ('not_contains', 'Does not contain'),
        ('equals', 'Equals'),
        ('not_equals', 'Does not equal'),
        ('starts_with', 'Starts with'),
        ('ends_with', 'Ends with'),
        # Numeric operators
        ('greater_than', 'Greater than'),
        ('less_than', 'Less than'),
        ('greater_equal', 'Greater than or equal'),
        ('less_equal', 'Less than or equal'),
        ('between', 'Between'),
        # Date operators
        ('in_last_days', 'In the last N days'),
        ('not_in_last_days', 'Not in the last N days'),
        ('before_date', 'Before date'),
        ('after_date', 'After date'),
        # Boolean operators
        ('is_true', 'Is true'),
        ('is_false', 'Is false'),
        # Null operators
        ('is_set', 'Is set'),
        ('is_not_set', 'Is not set'),
    ]
    
    smart_playlist = models.ForeignKey(
        'SmartPlaylist',
        on_delete=models.CASCADE,
        related_name='rules'
    )
    field = models.CharField(max_length=50, choices=FIELD_CHOICES)
    operator = models.CharField(max_length=30, choices=OPERATOR_CHOICES)
    value = models.CharField(max_length=500, blank=True, help_text="Value to compare against")
    value_2 = models.CharField(max_length=500, blank=True, help_text="Second value for 'between' operator")
    order = models.IntegerField(default=0, help_text="Order of rule evaluation")
    
    class Meta:
        ordering = ['order']
    
    def __str__(self):
        return f"{self.field} {self.operator} {self.value}"


class SmartPlaylist(models.Model):
    """Smart playlist with dynamic rules-based membership"""
    
    MATCH_MODE_CHOICES = [
        ('all', 'Match all rules (AND)'),
        ('any', 'Match any rule (OR)'),
    ]
    
    ORDER_BY_CHOICES = [
        ('title', 'Title (A-Z)'),
        ('-title', 'Title (Z-A)'),
        ('artist', 'Artist (A-Z)'),
        ('-artist', 'Artist (Z-A)'),
        ('channel_name', 'Channel (A-Z)'),
        ('-channel_name', 'Channel (Z-A)'),
        ('downloaded_date', 'Date Added (Oldest first)'),
        ('-downloaded_date', 'Date Added (Newest first)'),
        ('play_count', 'Play Count (Least played)'),
        ('-play_count', 'Play Count (Most played)'),
        ('last_played', 'Last Played (Oldest first)'),
        ('-last_played', 'Last Played (Most recent)'),
        ('duration', 'Duration (Shortest first)'),
        ('-duration', 'Duration (Longest first)'),
        ('year', 'Year (Oldest first)'),
        ('-year', 'Year (Newest first)'),
        ('rating', 'Rating (Lowest first)'),
        ('-rating', 'Rating (Highest first)'),
        ('random', 'Random'),
    ]
    
    # User isolation
    owner = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='smart_playlists',
        help_text="User who owns this smart playlist"
    )
    
    # Basic info
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    icon = models.CharField(max_length=50, blank=True, default='auto_awesome', help_text="Material icon name")
    color = models.CharField(max_length=20, blank=True, default='#7C3AED', help_text="Theme color (hex)")
    
    # Matching behavior
    match_mode = models.CharField(max_length=10, choices=MATCH_MODE_CHOICES, default='all')
    
    # Ordering and limits
    order_by = models.CharField(max_length=30, choices=ORDER_BY_CHOICES, default='-downloaded_date')
    limit = models.IntegerField(null=True, blank=True, help_text="Maximum number of tracks (null = unlimited)")
    
    # System/preset playlists (cannot be deleted/edited by user)
    is_system = models.BooleanField(default=False, help_text="System preset smart playlist")
    preset_type = models.CharField(
        max_length=30,
        blank=True,
        choices=[
            ('most_played', 'Most Played'),
            ('recently_added', 'Recently Added'),
            ('not_played_recently', 'Not Played Recently'),
            ('never_played', 'Never Played'),
            ('favorites', 'Favorites'),
            ('short_tracks', 'Short Tracks'),
            ('long_tracks', 'Long Tracks'),
        ],
        help_text="Preset type for system playlists"
    )
    
    # Cache
    cached_count = models.IntegerField(default=0, help_text="Cached track count")
    cache_updated = models.DateTimeField(null=True, blank=True)
    
    # Timestamps
    created_date = models.DateTimeField(auto_now_add=True)
    last_updated = models.DateTimeField(auto_now=True)
    
    class Meta:
        ordering = ['is_system', 'name']
        unique_together = ('owner', 'name')
        indexes = [
            models.Index(fields=['owner', 'is_system']),
            models.Index(fields=['owner', 'preset_type']),
        ]
    
    def __str__(self):
        return f"{self.owner.username} - {self.name}"
    
    @property
    def track_cap(self):
        """The limit as a usable bound; rows saved before limits were validated may hold nonsense."""
        return self.limit if self.limit and self.limit > 0 else None

    def invalid_rule_ids(self):
        return [rule.id for rule in self.rules.all() if not rule_is_valid(rule)]

    def matching_tracks(self, rules=None):
        """Every matching track, unordered. Pass `rules` to evaluate a draft that is not saved.

        A stored rule that means nothing matches nothing: skipping it would widen the
        playlist. invalid_rule_ids tells the owner which rule to repair.
        """
        from audio.models import Audio

        evaluated_rules = self.rules.all() if rules is None else rules
        try:
            predicate = rules_predicate(evaluated_rules, self.match_mode)
        except InvalidRule:
            return Audio.objects.none()
        return Audio.objects.filter(owner=self.owner).filter(predicate)

    def _shuffled_track_ids(self, shuffle_seed, rules):
        track_ids = list(self.matching_tracks(rules).order_by('id').values_list('id', flat=True))
        random.Random(shuffle_seed).shuffle(track_ids)
        return track_ids[:self.track_cap] if self.track_cap else track_ids

    def tracks_page(self, start, end, shuffle_seed=None, rules=None):
        """One slice of the playlist. The same seed always gives the same random order."""
        from audio.models import Audio

        if self.order_by == RANDOM_ORDER:
            page_ids = self._shuffled_track_ids(shuffle_seed, rules)[start:end]
            page_order = Case(*[When(pk=track_id, then=index) for index, track_id in enumerate(page_ids)])
            return Audio.objects.filter(pk__in=page_ids).order_by(page_order)
        ordered = self.matching_tracks(rules).order_by(self.order_by, 'id')
        capped = ordered[:self.track_cap] if self.track_cap else ordered
        return capped[start:end]

    def get_track_count(self, rules=None):
        """Get count of tracks matching this smart playlist"""
        count = self.matching_tracks(rules).count()
        return min(count, self.track_cap) if self.track_cap else count

    def forget_cached_count(self):
        self.cache_updated = None
        self.save(update_fields=['cache_updated'])

    def replace_rules(self, rules_data):
        """Swap in already validated rules, all or nothing."""
        with transaction.atomic():
            self.rules.all().delete()
            rules = [
                SmartPlaylistRule.objects.create(smart_playlist=self, order=position, **rule_data)
                for position, rule_data in enumerate(rules_data)
            ]
            self.forget_cached_count()
        return rules

    def update_cache(self):
        """Update the cached track count"""
        self.cached_count = self.get_track_count()
        self.cache_updated = timezone.now()
        self.save(update_fields=['cached_count', 'cache_updated'])


def forget_counts_of_playlists_using(owner, field):
    """A track changed in `field`, so the remembered counts of playlists that test it are stale."""
    SmartPlaylist.objects.filter(owner=owner, rules__field=field).update(cache_updated=None)


def create_system_smart_playlists(user):
    """Create default system smart playlists for a user"""
    system_playlists = [
        {
            'name': '🔥 Most Played',
            'description': 'Your top 50 most played tracks',
            'icon': 'local_fire_department',
            'color': '#EF4444',
            'preset_type': 'most_played',
            'order_by': '-play_count',
            'limit': 50,
            'rules': [
                {'field': 'play_count', 'operator': 'greater_than', 'value': '0'}
            ]
        },
        {
            'name': '✨ Recently Added',
            'description': 'Tracks added in the last 30 days',
            'icon': 'new_releases',
            'color': '#10B981',
            'preset_type': 'recently_added',
            'order_by': '-downloaded_date',
            'limit': None,
            'rules': [
                {'field': 'downloaded_date', 'operator': 'in_last_days', 'value': '30'}
            ]
        },
        {
            'name': '🕰️ Rediscover',
            'description': 'Tracks you haven\'t played in over 60 days',
            'icon': 'history',
            'color': '#F59E0B',
            'preset_type': 'not_played_recently',
            'order_by': 'last_played',
            'limit': 100,
            'rules': [
                {'field': 'last_played', 'operator': 'not_in_last_days', 'value': '60'},
                {'field': 'play_count', 'operator': 'greater_than', 'value': '0'}
            ]
        },
        {
            'name': '🆕 Never Played',
            'description': 'Tracks you haven\'t listened to yet',
            'icon': 'explore',
            'color': '#6366F1',
            'preset_type': 'never_played',
            'order_by': '-downloaded_date',
            'limit': None,
            'rules': [
                {'field': 'play_count', 'operator': 'equals', 'value': '0'}
            ]
        },
        {
            'name': '⚡ Quick Hits',
            'description': 'Tracks under 3 minutes',
            'icon': 'bolt',
            'color': '#EC4899',
            'preset_type': 'short_tracks',
            'order_by': '-play_count',
            'limit': None,
            'rules': [
                {'field': 'duration', 'operator': 'less_than', 'value': '180'}
            ]
        },
        {
            'name': '🎸 Epic Tracks',
            'description': 'Tracks over 6 minutes',
            'icon': 'album',
            'color': '#8B5CF6',
            'preset_type': 'long_tracks',
            'order_by': '-play_count',
            'limit': None,
            'rules': [
                {'field': 'duration', 'operator': 'greater_than', 'value': '360'}
            ]
        },
    ]
    
    created_playlists = []
    for playlist_data in system_playlists:
        rules_data = playlist_data.pop('rules')
        
        playlist, created = SmartPlaylist.objects.get_or_create(
            owner=user,
            preset_type=playlist_data['preset_type'],
            defaults={
                **playlist_data,
                'is_system': True,
                'match_mode': 'all',
            }
        )
        
        if created:
            # Create rules
            for i, rule_data in enumerate(rules_data):
                SmartPlaylistRule.objects.create(
                    smart_playlist=playlist,
                    order=i,
                    **rule_data
                )
            created_playlists.append(playlist)
    
    return created_playlists
