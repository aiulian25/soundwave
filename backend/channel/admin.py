"""Channel admin"""

from django.contrib import admin
from django.utils import timezone
from channel.models import Channel


@admin.register(Channel)
class ChannelAdmin(admin.ModelAdmin):
    """Channel admin"""
    list_display = (
        'channel_name',
        'subscribed',
        'auto_download',
        'sync_status',
        'consecutive_sync_failures',
        'auto_disabled',
        'video_count',
        'subscriber_count',
        'last_refreshed',
    )
    list_filter = ('subscribed', 'auto_download', 'sync_status', 'auto_disabled', 'last_refreshed')
    search_fields = ('channel_name', 'channel_id')
    actions = ('mark_for_manual_review', 'reenable_selected_subscriptions')

    @admin.action(description='Mark selected channels for manual review')
    def mark_for_manual_review(self, request, queryset):
        updated = queryset.update(
            sync_status='stale',
            last_failed_sync=timezone.now(),
        )
        self.message_user(request, f'{updated} channel(s) marked for manual review.')

    @admin.action(description='Re-enable selected auto-disabled subscriptions')
    def reenable_selected_subscriptions(self, request, queryset):
        updated = queryset.update(
            subscribed=True,
            auto_download=True,
            active=True,
            auto_disabled=False,
            auto_disabled_reason='',
            consecutive_sync_failures=0,
            sync_status='pending',
            error_message='',
        )
        self.message_user(request, f'{updated} channel subscription(s) re-enabled.')
