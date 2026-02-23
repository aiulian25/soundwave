"""User models"""

from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import models
import json
import secrets
import hashlib


class AccountManager(BaseUserManager):
    """Custom user manager"""

    def create_user(self, username, email, password=None):
        """Create regular user"""
        if not email:
            raise ValueError('Users must have an email address')
        if not username:
            raise ValueError('Users must have a username')

        user = self.model(
            email=self.normalize_email(email),
            username=username,
        )
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, username, email, password):
        """Create superuser"""
        user = self.create_user(
            email=self.normalize_email(email),
            password=password,
            username=username,
        )
        user.is_admin = True
        user.is_staff = True
        user.is_superuser = True
        user.save(using=self._db)
        return user


class Account(AbstractUser):
    """Custom user model"""
    email = models.EmailField(verbose_name="email", max_length=60, unique=True)
    username = models.CharField(max_length=30, unique=True)
    date_joined = models.DateTimeField(verbose_name='date joined', auto_now_add=True)
    last_login = models.DateTimeField(verbose_name='last login', auto_now=True)
    is_admin = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    is_superuser = models.BooleanField(default=False)
    
    # 2FA fields
    two_factor_enabled = models.BooleanField(default=False)
    two_factor_secret = models.CharField(max_length=32, blank=True, null=True)
    backup_codes = models.JSONField(default=list, blank=True)
    
    # User isolation and resource limits
    storage_quota_gb = models.IntegerField(default=50, help_text="Storage quota in GB")
    storage_used_gb = models.FloatField(default=0.0, help_text="Storage used in GB")
    max_channels = models.IntegerField(default=50, help_text="Maximum channels allowed")
    max_playlists = models.IntegerField(default=100, help_text="Maximum playlists allowed")
    
    # User metadata
    user_notes = models.TextField(blank=True, help_text="Admin notes about this user")
    created_by = models.ForeignKey(
        'self', 
        on_delete=models.SET_NULL, 
        null=True, 
        blank=True, 
        related_name='created_users',
        help_text="Admin who created this user"
    )
    avatar = models.CharField(
        max_length=500,
        blank=True,
        null=True,
        help_text="Path to user avatar image or preset avatar number (1-5)"
    )

    USERNAME_FIELD = 'username'
    REQUIRED_FIELDS = ['email']

    objects = AccountManager()

    def __str__(self):
        return self.username
    
    @property
    def storage_percent_used(self):
        """Calculate storage usage percentage"""
        if self.storage_quota_gb == 0:
            return 0
        return (self.storage_used_gb / self.storage_quota_gb) * 100
    
    @property
    def can_add_channel(self):
        """Check if user can add more channels"""
        from channel.models import Channel
        current_count = Channel.objects.filter(owner=self).count()
        return current_count < self.max_channels
    
    @property
    def can_add_playlist(self):
        """Check if user can add more playlists"""
        from playlist.models import Playlist
        current_count = Playlist.objects.filter(owner=self).count()
        return current_count < self.max_playlists
    
    def calculate_storage_usage(self):
        """Calculate and update actual storage usage from audio files"""
        from audio.models import Audio
        from django.db.models import Sum
        
        total_bytes = Audio.objects.filter(owner=self).aggregate(
            total=Sum('file_size')
        )['total'] or 0
        
        # Convert bytes to GB
        self.storage_used_gb = round(total_bytes / (1024 ** 3), 2)
        self.save(update_fields=['storage_used_gb'])
        return self.storage_used_gb


class UserYouTubeAccount(models.Model):
    """User's YouTube account credentials and settings"""
    user = models.ForeignKey(Account, on_delete=models.CASCADE, related_name='youtube_accounts')
    account_name = models.CharField(max_length=200, help_text="Friendly name for this YouTube account")
    
    # YouTube authentication (for future OAuth integration)
    youtube_channel_id = models.CharField(max_length=50, blank=True)
    youtube_channel_name = models.CharField(max_length=200, blank=True)
    
    # Cookie-based authentication (current method)
    cookies_file = models.TextField(blank=True, help_text="YouTube cookies for authenticated downloads")
    
    # Account status
    is_active = models.BooleanField(default=True)
    last_verified = models.DateTimeField(null=True, blank=True)
    created_date = models.DateTimeField(auto_now_add=True)
    
    # Download preferences
    auto_download = models.BooleanField(default=True, help_text="Automatically download new videos")
    download_quality = models.CharField(
        max_length=20, 
        default='medium',
        choices=[('low', 'Low'), ('medium', 'Medium'), ('high', 'High'), ('ultra', 'Ultra')]
    )
    
    class Meta:
        ordering = ['-created_date']
        unique_together = ('user', 'account_name')
    
    def __str__(self):
        return f"{self.user.username} - {self.account_name}"


class UserConfig(models.Model):
    """User configuration and preferences"""
    user = models.OneToOneField(Account, on_delete=models.CASCADE, related_name='config')
    
    # UI Preferences
    theme = models.CharField(max_length=50, default='dark', help_text="UI theme preference")
    
    # Player Settings
    volume = models.IntegerField(default=80, help_text="Player volume (0-100)")
    repeat_mode = models.CharField(
        max_length=20,
        default='none',
        choices=[('none', 'None'), ('one', 'Repeat One'), ('all', 'Repeat All')],
        help_text="Player repeat mode"
    )
    shuffle_enabled = models.BooleanField(default=False, help_text="Shuffle mode enabled")
    
    # Smart Shuffle Settings
    smart_shuffle_enabled = models.BooleanField(default=True, help_text="Smart shuffle mode - avoids recently played songs")
    smart_shuffle_history_size = models.IntegerField(default=10, help_text="Number of recent songs to avoid in smart shuffle (5-50)")
    
    # Visualizer Settings
    visualizer_theme = models.CharField(max_length=50, default='rounded-bars', help_text="Audio visualizer theme")
    visualizer_enabled = models.BooleanField(default=True, help_text="Enable audio visualizer")
    visualizer_glow = models.BooleanField(default=True, help_text="Enable glow effect on visualizer")
    
    # Seek Settings
    seek_duration = models.IntegerField(default=3, help_text="Seek duration in seconds (3, 5, or 10)")
    
    # Audio Quality
    audio_quality = models.CharField(
        max_length=20,
        default='high',
        choices=[('low', 'Low'), ('medium', 'Medium'), ('high', 'High'), ('best', 'Best')],
        help_text="Preferred audio quality"
    )
    
    # Display Settings
    items_per_page = models.IntegerField(default=50, help_text="Items per page in lists")
    
    # Prefetch/Caching Settings
    prefetch_enabled = models.BooleanField(default=True, help_text="Enable automatic prefetching of upcoming tracks")
    
    # Additional settings stored as JSON
    extra_settings = models.JSONField(default=dict, blank=True, help_text="Additional user settings")
    
    # Metadata
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        verbose_name = 'User Configuration'
        verbose_name_plural = 'User Configurations'
    
    def __str__(self):
        return f"Config for {self.user.username}"
    
    def get_setting(self, key, default=None):
        """Get a setting from extra_settings"""
        return self.extra_settings.get(key, default)
    
    def set_setting(self, key, value):
        """Set a setting in extra_settings"""
        self.extra_settings[key] = value
        self.save(update_fields=['extra_settings', 'updated_at'])


class APIKey(models.Model):
    """API Key model for widget/external API access (TubeArchivist-style)"""
    
    user = models.ForeignKey(
        Account,
        on_delete=models.CASCADE,
        related_name='api_keys',
        help_text="User who owns this API key"
    )
    name = models.CharField(max_length=100, help_text="Friendly name for this API key")
    
    # Key hashed for security - we only show the key once when created
    key_hash = models.CharField(max_length=64, unique=True, db_index=True)
    key_prefix = models.CharField(max_length=8, help_text="First 8 chars of the key for identification")
    
    # Permissions
    PERMISSION_CHOICES = [
        ('read', 'Read Only'),
        ('write', 'Read & Write'),
        ('admin', 'Full Admin'),
    ]
    permission = models.CharField(max_length=20, choices=PERMISSION_CHOICES, default='read')
    
    # Scopes - what data this key can access
    scope_stats = models.BooleanField(default=True, help_text="Can access stats/widget API")
    scope_audio = models.BooleanField(default=False, help_text="Can access audio API")
    scope_channels = models.BooleanField(default=False, help_text="Can access channels API")
    scope_playlists = models.BooleanField(default=False, help_text="Can access playlists API")
    scope_downloads = models.BooleanField(default=False, help_text="Can access downloads API")
    
    # Status
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_used = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True, help_text="Optional expiry date")
    
    class Meta:
        ordering = ['-created_at']
        verbose_name = 'API Key'
        verbose_name_plural = 'API Keys'
    
    def __str__(self):
        return f"{self.user.username} - {self.name} ({self.key_prefix}...)"
    
    @classmethod
    def generate_key(cls):
        """Generate a new random API key"""
        return secrets.token_hex(20)  # 40 character hex string
    
    @classmethod
    def hash_key(cls, key):
        """Hash an API key for storage"""
        return hashlib.sha256(key.encode()).hexdigest()
    
    @classmethod
    def create_for_user(cls, user, name='Widget API Key', permission='read'):
        """Create a new API key for a user and return the raw key (only shown once)"""
        raw_key = cls.generate_key()
        api_key = cls.objects.create(
            user=user,
            name=name,
            key_hash=cls.hash_key(raw_key),
            key_prefix=raw_key[:8],
            permission=permission,
        )
        # Return both the model and the raw key (only available at creation time)
        return api_key, raw_key
    
    @classmethod
    def validate_key(cls, raw_key):
        """Validate an API key and return the APIKey object if valid"""
        if not raw_key:
            return None
        key_hash = cls.hash_key(raw_key)
        try:
            api_key = cls.objects.select_related('user').get(
                key_hash=key_hash,
                is_active=True
            )
            # Check expiry
            from django.utils import timezone
            if api_key.expires_at and api_key.expires_at < timezone.now():
                return None
            # Update last_used
            api_key.last_used = timezone.now()
            api_key.save(update_fields=['last_used'])
            return api_key
        except cls.DoesNotExist:
            return None
