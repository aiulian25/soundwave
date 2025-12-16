"""Celery configuration for SoundWave"""

import os
from celery import Celery
from celery.schedules import crontab

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

app = Celery('soundwave')
app.config_from_object('django.conf:settings', namespace='CELERY')
app.autodiscover_tasks()

# Periodic task schedule
app.conf.beat_schedule = {
    # SMART SYNC: Check for new content in subscriptions every 15 minutes
    'sync-subscriptions': {
        'task': 'update_subscriptions',
        'schedule': crontab(minute='*/15'),  # Every 15 minutes for faster sync
    },
    # Auto-fetch lyrics every hour
    'auto-fetch-lyrics': {
        'task': 'audio.auto_fetch_lyrics',
        'schedule': crontab(minute=0),  # Every hour
        'kwargs': {'limit': 50, 'max_attempts': 3},
    },
    # Clean up lyrics cache weekly
    'cleanup-lyrics-cache': {
        'task': 'audio.cleanup_lyrics_cache',
        'schedule': crontab(hour=3, minute=0, day_of_week=0),  # Sunday at 3 AM
        'kwargs': {'days_old': 30},
    },
    # Retry failed lyrics weekly
    'refetch-failed-lyrics': {
        'task': 'audio.refetch_failed_lyrics',
        'schedule': crontab(hour=4, minute=0, day_of_week=0),  # Sunday at 4 AM
        'kwargs': {'days_old': 7, 'limit': 20},
    },
    # Auto-fetch artwork every 2 hours
    'auto-fetch-artwork': {
        'task': 'audio.auto_fetch_artwork_batch',
        'schedule': crontab(minute=0, hour='*/2'),  # Every 2 hours
        'kwargs': {'limit': 50},
    },
    # Auto-fetch artist info daily
    'auto-fetch-artist-info': {
        'task': 'audio.auto_fetch_artist_info_batch',
        'schedule': crontab(hour=2, minute=0),  # Daily at 2 AM
        'kwargs': {'limit': 20},
    },
}
