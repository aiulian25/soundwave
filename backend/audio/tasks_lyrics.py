"""Celery tasks for automatic lyrics fetching"""
from celery import shared_task
from django.utils import timezone
from datetime import timedelta
import logging

logger = logging.getLogger(__name__)


def _owned_audio(audio_id, owner_id):
    """The track only if it still exists under this active owner; a job never outlives either."""
    from audio.models import Audio

    return Audio.objects.filter(pk=audio_id, owner_id=owner_id, owner__is_active=True).first()


# The names changed with the signatures: a queued job carrying only a YouTube ID is left
# unregistered and dropped by the worker, never run under its old global lookup.
@shared_task(name="audio.fetch_lyrics_for_owned_audio")
def fetch_lyrics_for_audio(audio_id: int, owner_id: int, force: bool = False):
    """
    Fetch lyrics for a single audio track
    
    Args:
        audio_id: Primary key of the audio
        owner_id: Account the request was authorized for
        force: Force fetch even if already attempted
    """
    from audio.lyrics_service import LyricsService
    
    audio = _owned_audio(audio_id, owner_id)
    if audio is None:
        logger.info(f"Skipped lyrics fetch: audio {audio_id} is gone or its owner is inactive")
        return {"status": "skipped", "audio_id": audio_id}
    
    try:
        LyricsService().fetch_and_store_lyrics(audio, force=force)
        logger.info(f"Fetched lyrics for {audio.title}")
        return {"status": "success", "audio_id": audio_id}
    except Exception as e:
        logger.error(f"Error fetching lyrics for audio {audio_id}: {e}")
        return {"status": "error", "error": str(e)}


@shared_task(name="audio.fetch_lyrics_batch_for_owner")
def fetch_lyrics_batch(audio_ids: list, owner_id: int, delay_seconds: int = 2):
    """
    Fetch lyrics for multiple audio tracks with delay between requests
    
    Args:
        audio_ids: Primary keys of the audio
        owner_id: Account the request was authorized for
        delay_seconds: Delay between requests to avoid rate limiting
    """
    import time
    from audio.lyrics_service import LyricsService
    
    service = LyricsService()
    results = {
        'success': 0,
        'failed': 0,
        'skipped': 0,
    }
    
    for audio_id in audio_ids:
        audio = _owned_audio(audio_id, owner_id)
        if audio is None:
            results['skipped'] += 1
            continue
        
        try:
            service.fetch_and_store_lyrics(audio, force=False)
            results['success'] += 1
            logger.info(f"Fetched lyrics for {audio.title}")
        except Exception as e:
            results['failed'] += 1
            logger.error(f"Error fetching lyrics for audio {audio_id}: {e}")
        
        # Delay to avoid rate limiting
        if delay_seconds > 0:
            time.sleep(delay_seconds)
    
    return results


def _audio_missing_lyrics(max_attempts):
    """Active owners' downloaded tracks that still have no lyrics worth keeping."""
    from audio.models import Audio
    
    # file_path indicates downloaded
    return Audio.objects.filter(owner__is_active=True).exclude(
        file_path=''
    ).exclude(
        file_path__isnull=True
    ).exclude(
        lyrics__fetch_attempted=True,
        lyrics__fetch_attempts__gte=max_attempts
    ).exclude(
        lyrics__synced_lyrics__gt=''
    ).exclude(
        lyrics__plain_lyrics__gt=''
    ).exclude(
        lyrics__is_instrumental=True
    )


def _fetch_missing_lyrics(audio_without_lyrics):
    import time
    from audio.lyrics_service import LyricsService
    
    if not audio_without_lyrics:
        logger.info("No audio tracks need lyrics fetching")
        return {"status": "no_work", "message": "No tracks need lyrics"}
    
    service = LyricsService()
    results = {
        'processed': 0,
        'success': 0,
        'failed': 0,
    }
    
    for audio in audio_without_lyrics:
        try:
            lyrics = service.fetch_and_store_lyrics(audio, force=False)
            results['processed'] += 1
            
            if lyrics.has_lyrics:
                results['success'] += 1
            else:
                results['failed'] += 1
                
        except Exception as e:
            logger.error(f"Error in auto-fetch for {audio.title}: {e}")
            results['failed'] += 1
        
        # Small delay to be nice to the API
        time.sleep(1)
    
    logger.info(f"Auto-fetch completed: {results}")
    return results


@shared_task(name="audio.auto_fetch_lyrics")
def auto_fetch_lyrics(limit: int = 50, max_attempts: int = 3):
    """
    Scheduled, instance-wide fetch for audio without lyrics; never dispatched by a request
    
    Args:
        limit: Maximum number of tracks to process
        max_attempts: Skip tracks that have been attempted this many times
    """
    return _fetch_missing_lyrics(_audio_missing_lyrics(max_attempts)[:limit])


@shared_task(name="audio.fetch_missing_lyrics_for_owner")
def fetch_missing_lyrics_for_owner(owner_id: int, limit: int = 50, max_attempts: int = 3):
    """
    Fetch lyrics for one account's audio without lyrics
    
    Args:
        owner_id: Account the request was authorized for
        limit: Maximum number of tracks to process
        max_attempts: Skip tracks that have been attempted this many times
    """
    return _fetch_missing_lyrics(_audio_missing_lyrics(max_attempts).filter(owner_id=owner_id)[:limit])


@shared_task(name="audio.cleanup_lyrics_cache")
def cleanup_lyrics_cache(days_old: int = 30):
    """
    Clean up old lyrics cache entries
    
    Args:
        days_old: Remove cache entries older than this many days
    """
    from audio.models_lyrics import LyricsCache
    from django.utils import timezone
    from datetime import timedelta
    
    cutoff_date = timezone.now() - timedelta(days=days_old)
    
    # Delete old not_found entries
    deleted_count = LyricsCache.objects.filter(
        not_found=True,
        cached_date__lt=cutoff_date
    ).delete()[0]
    
    # Delete old unused entries (not accessed in the last N days)
    deleted_unused = LyricsCache.objects.filter(
        last_accessed__lt=cutoff_date,
        access_count=0
    ).delete()[0]
    
    logger.info(f"Cleaned up {deleted_count} not_found and {deleted_unused} unused cache entries")
    
    return {
        'deleted_not_found': deleted_count,
        'deleted_unused': deleted_unused,
    }


@shared_task(name="audio.refetch_failed_lyrics")
def refetch_failed_lyrics(days_old: int = 7, limit: int = 20):
    """
    Retry fetching lyrics for tracks that failed before
    
    Args:
        days_old: Retry tracks that failed more than this many days ago
        limit: Maximum number of tracks to retry
    """
    from audio.models_lyrics import Lyrics
    from audio.lyrics_service import LyricsService
    from django.utils import timezone
    from datetime import timedelta
    
    cutoff_date = timezone.now() - timedelta(days=days_old)
    
    # Find tracks that failed but haven't been tried recently
    failed_lyrics = Lyrics.objects.filter(
        audio__owner__is_active=True,
        fetch_attempted=True,
        synced_lyrics='',
        plain_lyrics='',
        is_instrumental=False,
        fetched_date__lt=cutoff_date,
        fetch_attempts__lt=5  # Don't retry if attempted 5+ times
    )[:limit]
    
    service = LyricsService()
    results = {
        'retried': 0,
        'success': 0,
        'failed': 0,
    }
    
    for lyrics in failed_lyrics:
        try:
            updated = service.fetch_and_store_lyrics(lyrics.audio, force=True)
            results['retried'] += 1
            
            if updated.has_lyrics:
                results['success'] += 1
            else:
                results['failed'] += 1
                
        except Exception as e:
            logger.error(f"Error retrying lyrics for {lyrics.audio.title}: {e}")
            results['failed'] += 1
        
        import time
        time.sleep(2)  # Be nice to the API
    
    logger.info(f"Refetch completed: {results}")
    return results
