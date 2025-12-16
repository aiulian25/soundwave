"""Download admin"""

from django.contrib import admin
from download.models import DownloadQueue


@admin.register(DownloadQueue)
class DownloadQueueAdmin(admin.ModelAdmin):
    """Download queue admin"""
    list_display = ('title', 'channel_name', 'status', 'added_date', 'auto_start')
    list_filter = ('status', 'auto_start', 'added_date')
    search_fields = ('title', 'url', 'youtube_id')
