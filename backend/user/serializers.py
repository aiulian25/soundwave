"""User serializers"""

from rest_framework import serializers
from user.models import Account


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


class UserConfigSerializer(serializers.Serializer):
    """User configuration serializer"""
    theme = serializers.CharField(default='dark')
    items_per_page = serializers.IntegerField(default=50)
    audio_quality = serializers.ChoiceField(
        choices=['low', 'medium', 'high', 'best'],
        default='best'
    )


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
