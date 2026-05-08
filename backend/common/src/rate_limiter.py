"""Rate limiting and throttling utilities for YouTube API calls"""

from functools import wraps
from django.core.cache import cache
from django.utils import timezone
from datetime import timedelta
import time
import logging

logger = logging.getLogger(__name__)


def rate_limit_task(
    max_calls=10,
    time_window_seconds=60,
    task_name='task'
):
    """
    Decorator to rate-limit Celery tasks to prevent YouTube rate-limiting.
    
    Ensures that no more than max_calls are made within time_window_seconds.
    Uses Django cache (Redis) for distributed rate limiting.
    
    Args:
        max_calls: Maximum number of calls allowed in the time window
        time_window_seconds: Time window in seconds
        task_name: Name of the task (for cache key)
    
    Usage:
        @rate_limit_task(max_calls=5, time_window_seconds=60, task_name='playlist_sync')
        @shared_task
        def download_playlist_task(playlist_id):
            ...
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            cache_key = f'rate_limit_{task_name}'
            call_times = cache.get(cache_key, [])
            
            now = time.time()
            cutoff_time = now - time_window_seconds
            
            # Remove old call times outside the window
            call_times = [t for t in call_times if t > cutoff_time]
            
            if len(call_times) >= max_calls:
                # Rate limit exceeded - delay the task
                delay_seconds = call_times[0] + time_window_seconds - now + 1
                logger.warning(
                    '[RateLimit] %s rate limited. Retrying in %.1f seconds (calls: %d/%d)',
                    task_name, delay_seconds, len(call_times), max_calls
                )
                
                # Re-raise the task to be retried after delay
                from config.celery import app
                raise app.backend.retry_call(
                    func, args, kwargs,
                    countdown=int(delay_seconds),
                    exc=Exception(f'{task_name} rate limited, retrying...')
                )
            
            # Record this call
            call_times.append(now)
            cache.set(cache_key, call_times, time_window_seconds + 10)
            
            logger.debug(
                '[RateLimit] %s called (calls: %d/%d in %ds window)',
                task_name, len(call_times), max_calls, time_window_seconds
            )
            
            return func(*args, **kwargs)
        
        return wrapper
    return decorator


def stagger_tasks(
    total_items,
    items_per_batch=5,
    batch_delay_seconds=5
):
    """
    Generator to stagger task execution and prevent overwhelming YouTube API.
    
    Yields batches of items with delays between batches.
    
    Args:
        total_items: List of items to process
        items_per_batch: How many items to process before delay
        batch_delay_seconds: Delay in seconds between batches
    
    Yields:
        Batches of items
    
    Usage:
        for batch in stagger_tasks(playlists, items_per_batch=5, batch_delay_seconds=10):
            for playlist in batch:
                download_playlist_task.delay(playlist.id)
            time.sleep(batch_delay_seconds)
    """
    for i in range(0, len(total_items), items_per_batch):
        batch = total_items[i:i + items_per_batch]
        yield batch
        if i + items_per_batch < len(total_items):
            # Don't sleep after the last batch
            logger.debug('[Stagger] Waiting %ds before next batch', batch_delay_seconds)
            time.sleep(batch_delay_seconds)


class YouTubeAPIThrottler:
    """
    Manages YouTube API request throttling to respect rate limits.
    
    YouTube has the following limits:
    - Standard quota: 10,000 units per day
    - Most playlist/channel operations: 1 unit
    - Video download: varies by quality
    
    This throttler ensures we don't exceed YouTube's rate limits.
    """
    
    QUOTA_PER_DAY = 10000
    REQUESTS_PER_MINUTE = 30  # Conservative estimate
    
    @staticmethod
    def get_quota_remaining():
        """Get estimated remaining API quota for today"""
        cache_key = 'yt_api_quota_used'
        used_today = cache.get(cache_key, 0)
        remaining = YouTubeAPIThrottler.QUOTA_PER_DAY - used_today
        return max(0, remaining)
    
    @staticmethod
    def record_request(units=1):
        """Record an API request and increment the quota counter"""
        cache_key = 'yt_api_quota_used'
        used_today = cache.get(cache_key, 0)
        used_today += units
        
        # Reset daily at midnight UTC
        expires_in = int((
            timezone.now().replace(hour=0, minute=0, second=0, microsecond=0) + 
            timedelta(days=1) - 
            timezone.now()
        ).total_seconds())
        
        cache.set(cache_key, used_today, expires_in)
        
        logger.debug('[YouTubeThrottler] Quota used: %d/%d units', 
                     used_today, YouTubeAPIThrottler.QUOTA_PER_DAY)
    
    @staticmethod
    def should_sync():
        """Check if we have enough quota remaining for a sync operation"""
        remaining = YouTubeAPIThrottler.get_quota_remaining()
        # Conservative: reserve 500 units for manual operations
        should_continue = remaining > 500
        
        if not should_continue:
            logger.warning('[YouTubeThrottler] Insufficient quota remaining (%d units), skipping sync',
                          remaining)
        
        return should_continue
