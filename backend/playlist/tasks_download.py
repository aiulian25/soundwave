"""Celery tasks for playlist downloading"""

from celery import shared_task
from django.utils import timezone
from django.db import transaction
import logging

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=3)
def download_playlist_task(self, download_id):
    """
    Download all items in a playlist
    
    Args:
        download_id: PlaylistDownload ID
    """
    from playlist.models_download import PlaylistDownload, PlaylistDownloadItem
    from playlist.models import PlaylistItem
    from audio.models import Audio
    
    try:
        download = PlaylistDownload.objects.select_related('playlist', 'user').get(id=download_id)
        
        # Update status to downloading
        download.status = 'downloading'
        download.started_at = timezone.now()
        download.save()
        
        # Get all playlist items
        playlist_items = PlaylistItem.objects.filter(
            playlist=download.playlist
        ).select_related('audio').order_by('position')
        
        # Create download items
        download_items = []
        for idx, item in enumerate(playlist_items):
            download_item, created = PlaylistDownloadItem.objects.get_or_create(
                download=download,
                audio=item.audio,
                defaults={
                    'position': idx,
                    'status': 'pending',
                }
            )
            download_items.append(download_item)
        
        # Update total items count
        download.total_items = len(download_items)
        download.save()
        
        # Download each item
        for download_item in download_items:
            try:
                # Check if already downloaded
                if download_item.audio.downloaded:
                    download_item.status = 'skipped'
                    download_item.completed_at = timezone.now()
                    download_item.save()
                    
                    download.downloaded_items += 1
                    download.save()
                    continue
                
                # Trigger download for this audio
                download_item.status = 'downloading'
                download_item.started_at = timezone.now()
                download_item.save()
                
                # Call the audio download task
                from download.tasks import download_audio_task
                result = download_audio_task.apply(args=[download_item.audio.id])
                
                if result.successful():
                    download_item.status = 'completed'
                    download_item.completed_at = timezone.now()
                    download_item.save()
                    
                    download.downloaded_items += 1
                    download.downloaded_size_bytes += download_item.audio.file_size
                    download.save()
                else:
                    raise Exception("Download task failed")
                    
            except Exception as e:
                logger.error(f"Error downloading item {download_item.id}: {e}")
                download_item.status = 'failed'
                download_item.error_message = str(e)
                download_item.retry_count += 1
                download_item.save()
                
                download.failed_items += 1
                download.save()
        
        # Mark as completed
        download.status = 'completed'
        download.completed_at = timezone.now()
        download.save()
        
        logger.info(f"Playlist download {download_id} completed: {download.downloaded_items}/{download.total_items} items")
        
        return {
            'download_id': download_id,
            'status': 'completed',
            'downloaded_items': download.downloaded_items,
            'failed_items': download.failed_items,
            'total_items': download.total_items,
        }
        
    except PlaylistDownload.DoesNotExist:
        logger.error(f"PlaylistDownload {download_id} not found")
        raise
    except Exception as e:
        logger.error(f"Error in playlist download task {download_id}: {e}")
        
        # Update download status
        try:
            download = PlaylistDownload.objects.get(id=download_id)
            download.status = 'failed'
            download.error_message = str(e)
            download.save()
        except:
            pass
        
        # Retry task
        raise self.retry(exc=e, countdown=60 * (2 ** self.request.retries))


@shared_task
def pause_playlist_download(download_id):
    """Pause a playlist download"""
    from playlist.models_download import PlaylistDownload
    
    try:
        download = PlaylistDownload.objects.get(id=download_id)
        download.status = 'paused'
        download.save()
        
        logger.info(f"Playlist download {download_id} paused")
        return {'download_id': download_id, 'status': 'paused'}
        
    except PlaylistDownload.DoesNotExist:
        logger.error(f"PlaylistDownload {download_id} not found")
        return {'error': 'Download not found'}


@shared_task
def resume_playlist_download(download_id):
    """Resume a paused or failed playlist download"""
    from playlist.models_download import PlaylistDownload
    
    try:
        download = PlaylistDownload.objects.get(id=download_id)
        
        if not download.can_resume:
            return {'error': 'Download cannot be resumed'}
        
        # Trigger the download task again
        download_playlist_task.apply_async(args=[download_id])
        
        logger.info(f"Playlist download {download_id} resumed")
        return {'download_id': download_id, 'status': 'resumed'}
        
    except PlaylistDownload.DoesNotExist:
        logger.error(f"PlaylistDownload {download_id} not found")
        return {'error': 'Download not found'}


@shared_task
def cancel_playlist_download(download_id):
    """Cancel a playlist download"""
    from playlist.models_download import PlaylistDownload
    
    try:
        download = PlaylistDownload.objects.get(id=download_id)
        download.status = 'failed'
        download.error_message = 'Cancelled by user'
        download.completed_at = timezone.now()
        download.save()
        
        logger.info(f"Playlist download {download_id} cancelled")
        return {'download_id': download_id, 'status': 'cancelled'}
        
    except PlaylistDownload.DoesNotExist:
        logger.error(f"PlaylistDownload {download_id} not found")
        return {'error': 'Download not found'}


@shared_task
def cleanup_old_downloads():
    """Clean up old completed downloads (older than 30 days)"""
    from playlist.models_download import PlaylistDownload
    from django.utils import timezone
    from datetime import timedelta
    
    cutoff_date = timezone.now() - timedelta(days=30)
    
    old_downloads = PlaylistDownload.objects.filter(
        status='completed',
        completed_at__lt=cutoff_date
    )
    
    count = old_downloads.count()
    old_downloads.delete()
    
    logger.info(f"Cleaned up {count} old playlist downloads")
    return {'cleaned_up': count}


@shared_task
def retry_failed_items(download_id):
    """Retry failed items in a playlist download"""
    from playlist.models_download import PlaylistDownload, PlaylistDownloadItem
    
    try:
        download = PlaylistDownload.objects.get(id=download_id)
        
        # Get failed items
        failed_items = PlaylistDownloadItem.objects.filter(
            download=download,
            status='failed',
            retry_count__lt=3  # Max 3 retries
        )
        
        if not failed_items.exists():
            return {'message': 'No failed items to retry'}
        
        # Reset failed items to pending
        failed_items.update(
            status='pending',
            error_message='',
            retry_count=models.F('retry_count') + 1
        )
        
        # Update download status
        download.status = 'downloading'
        download.failed_items = 0
        download.save()
        
        # Trigger download task
        download_playlist_task.apply_async(args=[download_id])
        
        logger.info(f"Retrying {failed_items.count()} failed items for download {download_id}")
        return {'download_id': download_id, 'retried_items': failed_items.count()}
        
    except PlaylistDownload.DoesNotExist:
        logger.error(f"PlaylistDownload {download_id} not found")
        return {'error': 'Download not found'}
