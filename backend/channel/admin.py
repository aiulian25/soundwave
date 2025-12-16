"""Channel admin"""

from django.contrib import admin
from channel.models import Channel


@admin.register(Channel)
class ChannelAdmin(admin.ModelAdmin):
    """Channel admin"""
    list_display = ('channel_name', 'subscribed', 'video_count', 'subscriber_count', 'last_refreshed')
    list_filter = ('subscribed', 'last_refreshed')
    search_fields = ('channel_name', 'channel_id')
