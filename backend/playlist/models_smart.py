"""Smart Playlist models - Dynamic auto-updating playlists"""

from django.db import models
from django.contrib.auth import get_user_model
from django.utils import timezone
from datetime import timedelta

User = get_user_model()


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
    
    def get_queryset(self):
        """Build and return the queryset for this smart playlist"""
        from audio.models import Audio
        from django.db.models import Q
        import random
        
        queryset = Audio.objects.filter(owner=self.owner)
        
        # Apply rules
        rules = self.rules.all()
        if rules.exists():
            if self.match_mode == 'all':
                # AND mode - all rules must match
                for rule in rules:
                    queryset = self._apply_rule(queryset, rule)
            else:
                # OR mode - any rule can match
                combined_q = Q()
                for rule in rules:
                    rule_q = self._build_rule_q(rule)
                    if rule_q:
                        combined_q |= rule_q
                if combined_q:
                    queryset = queryset.filter(combined_q)
        
        # Apply ordering
        if self.order_by == 'random':
            # For random, we'll get all IDs and shuffle
            ids = list(queryset.values_list('id', flat=True))
            random.shuffle(ids)
            if self.limit:
                ids = ids[:self.limit]
            # Preserve the random order using CASE WHEN
            from django.db.models import Case, When
            preserved_order = Case(*[When(pk=pk, then=pos) for pos, pk in enumerate(ids)])
            queryset = Audio.objects.filter(pk__in=ids).order_by(preserved_order)
        else:
            queryset = queryset.order_by(self.order_by)
            
            # Apply limit
            if self.limit:
                queryset = queryset[:self.limit]
        
        return queryset
    
    def _apply_rule(self, queryset, rule):
        """Apply a single rule to a queryset (for AND mode)"""
        rule_q = self._build_rule_q(rule)
        if rule_q:
            return queryset.filter(rule_q)
        return queryset
    
    def _build_rule_q(self, rule):
        """Build a Q object for a rule"""
        from django.db.models import Q
        
        field = rule.field
        operator = rule.operator
        value = rule.value
        value_2 = rule.value_2
        
        # Text operators
        if operator == 'contains':
            return Q(**{f'{field}__icontains': value})
        elif operator == 'not_contains':
            return ~Q(**{f'{field}__icontains': value})
        elif operator == 'equals':
            return Q(**{f'{field}__iexact': value})
        elif operator == 'not_equals':
            return ~Q(**{f'{field}__iexact': value})
        elif operator == 'starts_with':
            return Q(**{f'{field}__istartswith': value})
        elif operator == 'ends_with':
            return Q(**{f'{field}__iendswith': value})
        
        # Numeric operators
        elif operator == 'greater_than':
            return Q(**{f'{field}__gt': int(value)})
        elif operator == 'less_than':
            return Q(**{f'{field}__lt': int(value)})
        elif operator == 'greater_equal':
            return Q(**{f'{field}__gte': int(value)})
        elif operator == 'less_equal':
            return Q(**{f'{field}__lte': int(value)})
        elif operator == 'between':
            return Q(**{f'{field}__gte': int(value), f'{field}__lte': int(value_2)})
        
        # Date operators
        elif operator == 'in_last_days':
            days_ago = timezone.now() - timedelta(days=int(value))
            return Q(**{f'{field}__gte': days_ago})
        elif operator == 'not_in_last_days':
            days_ago = timezone.now() - timedelta(days=int(value))
            return Q(**{f'{field}__lt': days_ago}) | Q(**{f'{field}__isnull': True})
        elif operator == 'before_date':
            return Q(**{f'{field}__lt': value})
        elif operator == 'after_date':
            return Q(**{f'{field}__gt': value})
        
        # Boolean operators
        elif operator == 'is_true':
            return Q(**{field: True})
        elif operator == 'is_false':
            return Q(**{field: False})
        
        # Null operators
        elif operator == 'is_set':
            # Check if field is not null and not empty string
            return ~Q(**{f'{field}__isnull': True}) & ~Q(**{field: ''})
        elif operator == 'is_not_set':
            return Q(**{f'{field}__isnull': True}) | Q(**{field: ''})
        
        return None
    
    def get_tracks(self):
        """Get the list of tracks matching this smart playlist"""
        return list(self.get_queryset())
    
    def get_track_count(self):
        """Get count of tracks matching this smart playlist"""
        if self.order_by == 'random':
            # For random, we need to get all matching tracks first
            from audio.models import Audio
            queryset = Audio.objects.filter(owner=self.owner)
            for rule in self.rules.all():
                queryset = self._apply_rule(queryset, rule)
            count = queryset.count()
            return min(count, self.limit) if self.limit else count
        return self.get_queryset().count()
    
    def update_cache(self):
        """Update the cached track count"""
        self.cached_count = self.get_track_count()
        self.cache_updated = timezone.now()
        self.save(update_fields=['cached_count', 'cache_updated'])


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
