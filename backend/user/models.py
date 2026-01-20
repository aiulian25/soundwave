"""User models"""

from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import models
import json


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
    visualizer_theme = models.CharField(max_length=50, default='classic-bars', help_text="Audio visualizer theme")
    visualizer_enabled = models.BooleanField(default=True, help_text="Enable audio visualizer")
    visualizer_glow = models.BooleanField(default=True, help_text="Enable glow effect on visualizer")
    
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
