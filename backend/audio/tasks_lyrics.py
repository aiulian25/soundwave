"""Celery tasks for automatic lyrics fetching"""
from celery import shared_task
from django.utils import timezone
from datetime import timedelta
import logging

logger = logging.getLogger(__name__)


@shared_task(name="audio.fetch_lyrics_for_audio")
def fetch_lyrics_for_audio(audio_youtube_id: str, force: bool = False):
    """
    Fetch lyrics for a single audio track
    
    Args:
        audio_youtube_id: YouTube ID of the audio
        force: Force fetch even if already attempted
    """
    from audio.models import Audio
    from audio.lyrics_service import LyricsService
    
    try:
        audio = Audio.objects.get(youtube_id=audio_youtube_id)
        service = LyricsService()
        service.fetch_and_store_lyrics(audio, force=force)
        logger.info(f"Fetched lyrics for {audio.title}")
        return {"status": "success", "youtube_id": audio_youtube_id}
    except Audio.DoesNotExist:
        logger.error(f"Audio not found: {audio_youtube_id}")
        return {"status": "error", "error": "Audio not found"}
    except Exception as e:
        logger.error(f"Error fetching lyrics for {audio_youtube_id}: {e}")
        return {"status": "error", "error": str(e)}


@shared_task(name="audio.fetch_lyrics_batch")
def fetch_lyrics_batch(audio_ids: list, delay_seconds: int = 2):
    """
    Fetch lyrics for multiple audio tracks with delay between requests
    
    Args:
        audio_ids: List of YouTube IDs
        delay_seconds: Delay between requests to avoid rate limiting
    """
    import time
    from audio.models import Audio
    from audio.lyrics_service import LyricsService
    
    service = LyricsService()
    results = {
        'success': 0,
        'failed': 0,
        'skipped': 0,
    }
    
    for youtube_id in audio_ids:
        try:
            audio = Audio.objects.get(youtube_id=youtube_id)
            service.fetch_and_store_lyrics(audio, force=False)
            results['success'] += 1
            logger.info(f"Fetched lyrics for {audio.title}")
        except Audio.DoesNotExist:
            results['skipped'] += 1
            logger.warning(f"Audio not found: {youtube_id}")
        except Exception as e:
            results['failed'] += 1
            logger.error(f"Error fetching lyrics for {youtube_id}: {e}")
        
        # Delay to avoid rate limiting
        if delay_seconds > 0:
            time.sleep(delay_seconds)
    
    return results


@shared_task(name="audio.auto_fetch_lyrics")
def auto_fetch_lyrics(limit: int = 50, max_attempts: int = 3):
    """
    Automatically fetch lyrics for audio without lyrics
    
    This task should be scheduled to run periodically (e.g., every hour)
    
    Args:
        limit: Maximum number of tracks to process
        max_attempts: Skip tracks that have been attempted this many times
    """
    from audio.models import Audio
    from audio.models_lyrics import Lyrics
    from audio.lyrics_service import LyricsService
    
    # Find audio without lyrics or with failed attempts (file_path indicates downloaded)
    audio_without_lyrics = Audio.objects.exclude(
        file_path=''
    ).exclude(
        file_path__isnull=True
    ).exclude(
        lyrics__fetch_attempted=True,
        lyrics__fetch_attempts__gte=max_attempts
    )[:limit]
    
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
        import time
        time.sleep(1)
    
    logger.info(f"Auto-fetch completed: {results}")
    return results


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
