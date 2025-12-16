"""Admin interface for user management"""
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.utils.html import format_html
from django.urls import reverse
from django.utils.safestring import mark_safe
from user.models import Account, UserYouTubeAccount


@admin.register(Account)
class AccountAdmin(BaseUserAdmin):
    """Enhanced admin for Account model with user management"""
    
    list_display = [
        'username',
        'email',
        'is_admin',
        'is_active',
        'storage_usage',
        'channel_count',
        'playlist_count',
        'date_joined',
        'last_login',
    ]
    
    list_filter = [
        'is_admin',
        'is_active',
        'is_staff',
        'is_superuser',
        'two_factor_enabled',
        'date_joined',
    ]
    
    search_fields = ['username', 'email']
    
    fieldsets = (
        ('Account Info', {
            'fields': ('username', 'email', 'password')
        }),
        ('Permissions', {
            'fields': (
                'is_active',
                'is_staff',
                'is_admin',
                'is_superuser',
                'groups',
                'user_permissions',
            )
        }),
        ('Resource Limits', {
            'fields': (
                'storage_quota_gb',
                'storage_used_gb',
                'max_channels',
                'max_playlists',
            )
        }),
        ('Security', {
            'fields': (
                'two_factor_enabled',
                'two_factor_secret',
            )
        }),
        ('Metadata', {
            'fields': (
                'user_notes',
                'created_by',
                'date_joined',
                'last_login',
            )
        }),
    )
    
    add_fieldsets = (
        ('Create New User', {
            'classes': ('wide',),
            'fields': (
                'username',
                'email',
                'password1',
                'password2',
                'is_admin',
                'is_active',
                'storage_quota_gb',
                'max_channels',
                'max_playlists',
                'user_notes',
            ),
        }),
    )
    
    readonly_fields = ['date_joined', 'last_login', 'storage_used_gb']
    
    ordering = ['-date_joined']
    
    def storage_usage(self, obj):
        """Display storage usage with progress bar"""
        percent = obj.storage_percent_used
        if percent > 90:
            color = 'red'
        elif percent > 75:
            color = 'orange'
        else:
            color = 'green'
        
        return format_html(
            '<div style="width:100px; background-color:#f0f0f0; border:1px solid #ccc;">'
            '<div style="width:{}%; background-color:{}; height:20px; text-align:center; color:white;">'
            '{:.1f}%'
            '</div></div>',
            min(percent, 100),
            color,
            percent
        )
    storage_usage.short_description = 'Storage'
    
    def channel_count(self, obj):
        """Display channel count with limit"""
        from channel.models import Channel
        count = Channel.objects.filter(owner=obj).count()
        return format_html(
            '<span style="color: {};">{} / {}</span>',
            'red' if count >= obj.max_channels else 'green',
            count,
            obj.max_channels
        )
    channel_count.short_description = 'Channels'
    
    def playlist_count(self, obj):
        """Display playlist count with limit"""
        from playlist.models import Playlist
        count = Playlist.objects.filter(owner=obj).count()
        return format_html(
            '<span style="color: {};">{} / {}</span>',
            'red' if count >= obj.max_playlists else 'green',
            count,
            obj.max_playlists
        )
    playlist_count.short_description = 'Playlists'
    
    def save_model(self, request, obj, form, change):
        """Set created_by for new users"""
        if not change and request.user.is_authenticated:
            obj.created_by = request.user
        super().save_model(request, obj, form, change)
    
    actions = [
        'reset_storage_quota',
        'disable_users',
        'enable_users',
        'reset_2fa',
    ]
    
    def reset_storage_quota(self, request, queryset):
        """Reset storage usage to 0"""
        count = queryset.update(storage_used_gb=0.0)
        self.message_user(request, f'Reset storage for {count} users')
    reset_storage_quota.short_description = 'Reset storage usage'
    
    def disable_users(self, request, queryset):
        """Disable selected users"""
        count = queryset.update(is_active=False)
        self.message_user(request, f'Disabled {count} users')
    disable_users.short_description = 'Disable selected users'
    
    def enable_users(self, request, queryset):
        """Enable selected users"""
        count = queryset.update(is_active=True)
        self.message_user(request, f'Enabled {count} users')
    enable_users.short_description = 'Enable selected users'
    
    def reset_2fa(self, request, queryset):
        """Reset 2FA for selected users"""
        count = queryset.update(
            two_factor_enabled=False,
            two_factor_secret='',
            backup_codes=[]
        )
        self.message_user(request, f'Reset 2FA for {count} users')
    reset_2fa.short_description = 'Reset 2FA'


@admin.register(UserYouTubeAccount)
class UserYouTubeAccountAdmin(admin.ModelAdmin):
    """Admin for YouTube accounts"""
    
    list_display = [
        'user',
        'account_name',
        'youtube_channel_name',
        'is_active',
        'auto_download',
        'download_quality',
        'created_date',
    ]
    
    list_filter = [
        'is_active',
        'auto_download',
        'download_quality',
        'created_date',
    ]
    
    search_fields = [
        'user__username',
        'account_name',
        'youtube_channel_name',
        'youtube_channel_id',
    ]
    
    fieldsets = (
        ('Account Info', {
            'fields': (
                'user',
                'account_name',
                'youtube_channel_id',
                'youtube_channel_name',
            )
        }),
        ('Authentication', {
            'fields': (
                'cookies_file',
                'is_active',
                'last_verified',
            )
        }),
        ('Download Settings', {
            'fields': (
                'auto_download',
                'download_quality',
            )
        }),
    )
    
    readonly_fields = ['created_date', 'last_verified']
    
    def get_queryset(self, request):
        """Filter by user if not admin"""
        qs = super().get_queryset(request)
        if request.user.is_superuser or request.user.is_admin:
            return qs
        return qs.filter(user=request.user)
