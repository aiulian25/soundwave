"""Serializers for admin user management"""
from rest_framework import serializers
from user.models import Account, UserYouTubeAccount
from channel.models import Channel
from playlist.models import Playlist


class UserStatsSerializer(serializers.Serializer):
    """User statistics"""
    total_channels = serializers.IntegerField()
    total_playlists = serializers.IntegerField()
    total_audio_files = serializers.IntegerField()
    storage_used_gb = serializers.FloatField()
    storage_quota_gb = serializers.IntegerField()
    storage_percent = serializers.FloatField()


class UserDetailSerializer(serializers.ModelSerializer):
    """Detailed user information for admin"""
    storage_percent_used = serializers.FloatField(read_only=True)
    can_add_channel = serializers.BooleanField(read_only=True)
    can_add_playlist = serializers.BooleanField(read_only=True)
    stats = serializers.SerializerMethodField()
    created_by_username = serializers.CharField(source='created_by.username', read_only=True)
    
    class Meta:
        model = Account
        fields = [
            'id',
            'username',
            'email',
            'is_admin',
            'is_active',
            'is_staff',
            'is_superuser',
            'two_factor_enabled',
            'storage_quota_gb',
            'storage_used_gb',
            'storage_percent_used',
            'max_channels',
            'max_playlists',
            'can_add_channel',
            'can_add_playlist',
            'user_notes',
            'created_by',
            'created_by_username',
            'date_joined',
            'last_login',
            'stats',
        ]
        read_only_fields = [
            'id',
            'date_joined',
            'last_login',
            'storage_used_gb',
            'two_factor_enabled',
        ]
    
    def get_stats(self, obj):
        """Get user statistics"""
        from audio.models import Audio
        
        channels_count = Channel.objects.filter(owner=obj).count()
        playlists_count = Playlist.objects.filter(owner=obj).count()
        audio_count = Audio.objects.filter(owner=obj).count()
        
        return {
            'total_channels': channels_count,
            'total_playlists': playlists_count,
            'total_audio_files': audio_count,
            'storage_used_gb': obj.storage_used_gb,
            'storage_quota_gb': obj.storage_quota_gb,
            'storage_percent': obj.storage_percent_used,
        }


class UserCreateSerializer(serializers.ModelSerializer):
    """Create new user (admin only)"""
    password = serializers.CharField(write_only=True, required=True, style={'input_type': 'password'})
    password_confirm = serializers.CharField(write_only=True, required=True, style={'input_type': 'password'})
    
    class Meta:
        model = Account
        fields = [
            'username',
            'email',
            'password',
            'password_confirm',
            'is_admin',
            'is_active',
            'storage_quota_gb',
            'max_channels',
            'max_playlists',
            'user_notes',
        ]
    
    def validate(self, data):
        """Validate password match"""
        if data['password'] != data['password_confirm']:
            raise serializers.ValidationError({"password": "Passwords do not match"})
        return data
    
    def create(self, validated_data):
        """Create user with hashed password"""
        validated_data.pop('password_confirm')
        password = validated_data.pop('password')
        
        user = Account.objects.create_user(
            username=validated_data['username'],
            email=validated_data['email'],
            password=password,
        )
        
        # Update additional fields
        for key, value in validated_data.items():
            setattr(user, key, value)
        
        # Set created_by from request context
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            user.created_by = request.user
        
        user.save()
        return user


class UserUpdateSerializer(serializers.ModelSerializer):
    """Update user (admin only)"""
    
    class Meta:
        model = Account
        fields = [
            'is_admin',
            'is_active',
            'is_staff',
            'storage_quota_gb',
            'max_channels',
            'max_playlists',
            'user_notes',
        ]


class UserYouTubeAccountSerializer(serializers.ModelSerializer):
    """YouTube account serializer"""
    
    class Meta:
        model = UserYouTubeAccount
        fields = [
            'id',
            'account_name',
            'youtube_channel_id',
            'youtube_channel_name',
            'is_active',
            'auto_download',
            'download_quality',
            'created_date',
            'last_verified',
        ]
        read_only_fields = ['id', 'created_date', 'last_verified']


class UserYouTubeAccountCreateSerializer(serializers.ModelSerializer):
    """Create YouTube account"""
    
    class Meta:
        model = UserYouTubeAccount
        fields = [
            'account_name',
            'youtube_channel_id',
            'youtube_channel_name',
            'cookies_file',
            'auto_download',
            'download_quality',
        ]
    
    def create(self, validated_data):
        """Set user from request context"""
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            validated_data['user'] = request.user
        return super().create(validated_data)
