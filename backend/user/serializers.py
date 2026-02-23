"""User serializers"""

from rest_framework import serializers
from user.models import Account, UserConfig, APIKey


class AccountSerializer(serializers.ModelSerializer):
    """Account serializer"""
    avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = Account
        fields = [
            'id', 'username', 'email', 'date_joined', 'last_login', 
            'two_factor_enabled', 'avatar', 'avatar_url',
            'is_admin', 'is_superuser', 'is_staff',
            'storage_quota_gb', 'storage_used_gb', 
            'max_channels', 'max_playlists'
        ]
        read_only_fields = [
            'id', 'date_joined', 'last_login', 'two_factor_enabled', 'avatar_url',
            'is_admin', 'is_superuser', 'is_staff',
            'storage_used_gb'
        ]
    
    def get_avatar_url(self, obj):
        """Get avatar URL"""
        if not obj.avatar:
            return None
        
        # Preset avatars (served from frontend public folder)
        if obj.avatar.startswith('preset_'):
            return f"/avatars/{obj.avatar}.svg"
        
        # Custom avatars (served from backend)
        return f"/api/user/avatar/file/{obj.avatar.split('/')[-1]}/"


class LoginSerializer(serializers.Serializer):
    """Login serializer"""
    username = serializers.CharField()
    password = serializers.CharField(write_only=True)
    two_factor_code = serializers.CharField(required=False, allow_blank=True)


class UserConfigSerializer(serializers.ModelSerializer):
    """User configuration serializer"""
    class Meta:
        model = UserConfig
        fields = [
            'theme', 'volume', 'repeat_mode', 'shuffle_enabled',
            'smart_shuffle_enabled', 'smart_shuffle_history_size',
            'visualizer_theme', 'visualizer_enabled', 'visualizer_glow',
            'seek_duration',
            'audio_quality', 'items_per_page', 'prefetch_enabled',
            'extra_settings', 'updated_at'
        ]
        read_only_fields = ['updated_at']


class TwoFactorSetupSerializer(serializers.Serializer):
    """2FA setup response"""
    secret = serializers.CharField()
    qr_code = serializers.CharField()
    backup_codes = serializers.ListField(child=serializers.CharField())


class TwoFactorVerifySerializer(serializers.Serializer):
    """2FA verification"""
    code = serializers.CharField(min_length=6, max_length=6)


class TwoFactorStatusSerializer(serializers.Serializer):
    """2FA status"""
    enabled = serializers.BooleanField()
    backup_codes_count = serializers.IntegerField()


class APIKeySerializer(serializers.ModelSerializer):
    """API Key serializer (for listing keys)"""
    
    class Meta:
        model = APIKey
        fields = [
            'id', 'name', 'key_prefix', 'permission',
            'scope_stats', 'scope_audio', 'scope_channels',
            'scope_playlists', 'scope_downloads',
            'is_active', 'created_at', 'last_used', 'expires_at'
        ]
        read_only_fields = [
            'id', 'key_prefix', 'created_at', 'last_used'
        ]


class APIKeyCreateSerializer(serializers.Serializer):
    """API Key creation serializer"""
    name = serializers.CharField(max_length=100, default='Widget API Key')
    permission = serializers.ChoiceField(
        choices=['read', 'write', 'admin'],
        default='read'
    )
    scope_stats = serializers.BooleanField(default=True)
    scope_audio = serializers.BooleanField(default=False)
    scope_channels = serializers.BooleanField(default=False)
    scope_playlists = serializers.BooleanField(default=False)
    scope_downloads = serializers.BooleanField(default=False)
    expires_in_days = serializers.IntegerField(required=False, allow_null=True, min_value=1)


class APIKeyCreatedSerializer(serializers.Serializer):
    """Response after creating an API key (includes the actual key, shown only once)"""
    id = serializers.IntegerField()
    name = serializers.CharField()
    key = serializers.CharField(help_text="The API key - save this, it's only shown once!")
    key_prefix = serializers.CharField()
    permission = serializers.CharField()
    created_at = serializers.DateTimeField()
