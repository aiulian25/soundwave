"""Celery tasks for background processing"""

from celery import shared_task
import yt_dlp
from audio.models import Audio
from channel.models import Channel
from download.models import DownloadQueue
from datetime import datetime, timedelta
from django.utils import timezone
import os


@shared_task
def download_audio_task(queue_id):
    """Download audio from YouTube - AUDIO ONLY, no video"""
    try:
        queue_item = DownloadQueue.objects.get(id=queue_id)
        queue_item.status = 'downloading'
        queue_item.started_date = timezone.now()
        queue_item.save()

        # yt-dlp options for AUDIO ONLY (no video)
        ydl_opts = {
            'format': 'bestaudio/best',  # Best audio quality, no video
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'm4a',
                'preferredquality': '192',
            }],
            'outtmpl': '/app/audio/%(channel)s/%(title)s-%(id)s.%(ext)s',
            'quiet': True,
            'no_warnings': True,
            'extract_audio': True,  # Ensure audio extraction
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(queue_item.url, download=True)
            
            # Get the actual downloaded filename from yt-dlp
            # After post-processing with FFmpegExtractAudio, the extension will be .m4a
            # We need to use prepare_filename and replace the extension
            actual_filename = ydl.prepare_filename(info)
            
            # Replace extension with .m4a since we're extracting audio
            import os as os_module
            base_filename = os_module.path.splitext(actual_filename)[0]
            actual_filename = base_filename + '.m4a'
            
            # Remove /app/audio/ prefix to get relative path
            if actual_filename.startswith('/app/audio/'):
                file_path = actual_filename[11:]  # Remove '/app/audio/' prefix
            else:
                # Fallback to constructed path if prepare_filename doesn't work as expected
                file_path = f"{info.get('channel', 'unknown')}/{info.get('title', 'unknown')}-{info['id']}.m4a"

            # Create Audio object
            audio, created = Audio.objects.get_or_create(
                owner=queue_item.owner,
                youtube_id=info['id'],
                defaults={
                    'title': info.get('title', 'Unknown'),
                    'description': info.get('description', ''),
                    'channel_id': info.get('channel_id', ''),
                    'channel_name': info.get('channel', 'Unknown'),
                    'duration': info.get('duration', 0),
                    'file_path': file_path,
                    'file_size': info.get('filesize', 0) or 0,
                    'thumbnail_url': info.get('thumbnail', ''),
                    'published_date': datetime.strptime(info.get('upload_date', '20230101'), '%Y%m%d'),
                    'view_count': info.get('view_count', 0) or 0,
                    'like_count': info.get('like_count', 0) or 0,
                }
            )
            
            # Queue a task to link this audio to playlists (optimized - runs after download)
            # This prevents blocking the download task with expensive playlist lookups
            link_audio_to_playlists.delay(audio.id, queue_item.owner.id)

        queue_item.status = 'completed'
        queue_item.completed_date = timezone.now()
        queue_item.youtube_id = info['id']
        queue_item.title = info.get('title', '')
        queue_item.save()

        return f"Downloaded: {info.get('title', 'Unknown')}"

    except Exception as e:
        queue_item.status = 'failed'
        queue_item.error_message = str(e)
        queue_item.save()
        raise


@shared_task
def download_channel_task(channel_id):
    """Smart sync: Download only NEW audio from channel (not already downloaded)"""
    try:
        channel = Channel.objects.get(id=channel_id)
        channel.sync_status = 'syncing'
        channel.error_message = ''
        channel.save()
        
        url = f"https://www.youtube.com/channel/{channel.channel_id}/videos"
        
        # Extract flat to get list quickly
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'extract_flat': True,
            'playlistend': 50,  # Limit to last 50 videos per sync
        }
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            
            if not info or 'entries' not in info:
                channel.sync_status = 'failed'
                channel.error_message = 'Failed to fetch channel videos'
                channel.save()
                return f"Failed to fetch channel videos"
            
            # Get list of already downloaded video IDs
            existing_ids = set(Audio.objects.filter(
                owner=channel.owner
            ).values_list('youtube_id', flat=True))
            
            # Queue only NEW videos
            new_videos = 0
            skipped = 0
            
            for entry in info['entries']:
                if not entry:
                    continue
                    
                video_id = entry.get('id')
                if not video_id:
                    continue
                
                # SMART SYNC: Skip if already downloaded
                if video_id in existing_ids:
                    skipped += 1
                    continue
                
                # This is NEW content
                queue_item, created = DownloadQueue.objects.get_or_create(
                    owner=channel.owner,
                    url=f"https://www.youtube.com/watch?v={video_id}",
                    defaults={
                        'youtube_id': video_id,
                        'title': entry.get('title', 'Unknown'),
                        'status': 'pending',
                        'auto_start': True
                    }
                )
                
                if created:
                    new_videos += 1
                    download_audio_task.delay(queue_item.id)
            
            # Update channel status
            channel.sync_status = 'success'
            channel.downloaded_count = len(existing_ids)
            channel.save()
            
            if new_videos == 0:
                return f"Channel '{channel.channel_name}' up to date ({skipped} already downloaded)"
            
            return f"Channel '{channel.channel_name}': {new_videos} new audio(s) queued, {skipped} already downloaded"
    
    except Exception as e:
        channel.sync_status = 'failed'
        channel.error_message = str(e)
        channel.save()
        raise


@shared_task(bind=True, name="subscribe_to_playlist")
def subscribe_to_playlist(self, user_id, playlist_url):
    """
    TubeArchivist pattern: Subscribe to playlist and trigger audio download
    Called from API → Creates subscription → Downloads audio (not video)
    """
    from django.contrib.auth import get_user_model
    from playlist.models import Playlist
    from common.src.youtube_metadata import get_playlist_metadata
    import re
    
    User = get_user_model()
    user = User.objects.get(id=user_id)
    
    # Extract playlist ID from URL
    patterns = [
        r'[?&]list=([a-zA-Z0-9_-]+)',
        r'playlist\?list=([a-zA-Z0-9_-]+)',
    ]
    
    playlist_id = None
    for pattern in patterns:
        match = re.search(pattern, playlist_url)
        if match:
            playlist_id = match.group(1)
            break
    
    if not playlist_id and len(playlist_url) >= 13 and playlist_url.startswith(('PL', 'UU', 'LL', 'RD')):
        playlist_id = playlist_url
    
    if not playlist_id:
        raise ValueError("Invalid playlist URL")
    
    # Check if already subscribed
    if Playlist.objects.filter(owner=user, playlist_id=playlist_id).exists():
        return f"Already subscribed to playlist {playlist_id}"
    
    # Fetch metadata
    metadata = get_playlist_metadata(playlist_id)
    if not metadata:
        raise ValueError("Failed to fetch playlist metadata")
    
    # Create subscription
    playlist = Playlist.objects.create(
        owner=user,
        playlist_id=playlist_id,
        title=metadata['title'],
        description=metadata['description'],
        channel_name=metadata['channel_name'],
        channel_id=metadata['channel_id'],
        thumbnail_url=metadata['thumbnail_url'],
        item_count=metadata['item_count'],
        playlist_type='youtube',
        subscribed=True,
        auto_download=True,
        sync_status='pending',
    )
    
    # Trigger audio download task
    download_playlist_task.delay(playlist.id)
    
    return f"Subscribed to playlist: {metadata['title']}"


@shared_task(bind=True, name="subscribe_to_channel")
def subscribe_to_channel(self, user_id, channel_url):
    """
    TubeArchivist pattern: Subscribe to channel and trigger audio download
    Called from API → Creates subscription → Downloads audio (not video)
    """
    from django.contrib.auth import get_user_model
    from channel.models import Channel
    from common.src.youtube_metadata import get_channel_metadata
    import re
    
    User = get_user_model()
    user = User.objects.get(id=user_id)
    
    # Extract channel ID from URL
    patterns = [
        r'youtube\.com/channel/(UC[\w-]+)',
        r'youtube\.com/@([\w-]+)',
        r'youtube\.com/c/([\w-]+)',
        r'youtube\.com/user/([\w-]+)',
    ]
    
    channel_id = None
    for pattern in patterns:
        match = re.search(pattern, channel_url)
        if match:
            channel_id = match.group(1)
            break
    
    if not channel_id and channel_url.startswith('UC') and len(channel_url) == 24:
        channel_id = channel_url
    
    if not channel_id:
        channel_id = channel_url  # Try as-is
    
    # Fetch metadata (this resolves handles to actual channel IDs)
    metadata = get_channel_metadata(channel_id)
    if not metadata:
        raise ValueError("Failed to fetch channel metadata")
    
    actual_channel_id = metadata['channel_id']
    
    # Check if already subscribed
    if Channel.objects.filter(owner=user, channel_id=actual_channel_id).exists():
        return f"Already subscribed to channel {actual_channel_id}"
    
    # Create subscription
    channel = Channel.objects.create(
        owner=user,
        channel_id=actual_channel_id,
        channel_name=metadata['channel_name'],
        channel_description=metadata['channel_description'],
        channel_thumbnail=metadata['channel_thumbnail'],
        subscriber_count=metadata['subscriber_count'],
        video_count=metadata['video_count'],
        subscribed=True,
        auto_download=True,
        sync_status='pending',
    )
    
    # Trigger audio download task
    download_channel_task.delay(channel.id)
    
    return f"Subscribed to channel: {metadata['channel_name']}"


@shared_task(name="update_subscriptions")
def update_subscriptions_task():
    """
    TubeArchivist pattern: Periodic task to check ALL subscriptions for NEW audio
    Runs every 2 hours via Celery Beat
    """
    from playlist.models import Playlist
    
    # Sync all subscribed playlists
    playlists = Playlist.objects.filter(subscribed=True, auto_download=True)
    for playlist in playlists:
        download_playlist_task.delay(playlist.id)
    
    # Sync all subscribed channels
    channels = Channel.objects.filter(subscribed=True, auto_download=True)
    for channel in channels:
        download_channel_task.delay(channel.id)

    return f"Syncing {playlists.count()} playlists and {channels.count()} channels"


@shared_task
def download_playlist_task(playlist_id):
    """Smart sync: Download only NEW audio from playlist (not already downloaded)"""
    from playlist.models import Playlist, PlaylistItem
    
    try:
        playlist = Playlist.objects.get(id=playlist_id)
        playlist.sync_status = 'syncing'
        playlist.error_message = ''
        playlist.save()
        
        url = f"https://www.youtube.com/playlist?list={playlist.playlist_id}"
        
        # Extract flat to get list quickly without downloading
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'extract_flat': True,
        }
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            
            if not info or 'entries' not in info:
                playlist.sync_status = 'failed'
                playlist.error_message = 'Failed to fetch playlist items'
                playlist.save()
                return f"Failed to fetch playlist items"
            
            # Update item count
            total_items = len([e for e in info['entries'] if e])
            playlist.item_count = total_items
            
            # Get list of already downloaded video IDs
            existing_ids = set(Audio.objects.filter(
                owner=playlist.owner
            ).values_list('youtube_id', flat=True))
            
            # Queue only NEW videos (not already downloaded)
            new_videos = 0
            skipped = 0
            
            for idx, entry in enumerate(info['entries']):
                if not entry:
                    continue
                    
                video_id = entry.get('id')
                if not video_id:
                    continue
                
                # Check if audio already exists
                audio_obj = Audio.objects.filter(
                    owner=playlist.owner,
                    youtube_id=video_id
                ).first()
                
                # Create PlaylistItem if audio exists but not in playlist yet
                if audio_obj:
                    PlaylistItem.objects.get_or_create(
                        playlist=playlist,
                        audio=audio_obj,
                        defaults={'position': idx}
                    )
                    skipped += 1
                    continue
                
                # This is NEW content - add to download queue
                # First check for existing queue item
                existing_queue_item = DownloadQueue.objects.filter(
                    owner=playlist.owner,
                    youtube_id=video_id
                ).first()
                
                # Check if item is stuck in downloading state (> 30 minutes)
                if existing_queue_item and existing_queue_item.status == 'downloading':
                    if existing_queue_item.started_date:
                        stuck_threshold = timezone.now() - timedelta(minutes=30)
                        if existing_queue_item.started_date < stuck_threshold:
                            # Reset stuck download
                            existing_queue_item.status = 'failed'
                            existing_queue_item.error_message = 'Download stuck, resetting for retry'
                            existing_queue_item.save()
                            existing_queue_item = None  # Allow recreation
                
                # Create or get queue item
                if not existing_queue_item or existing_queue_item.status in ['failed', 'ignored']:
                    if existing_queue_item and existing_queue_item.status in ['failed', 'ignored']:
                        # Update existing failed item
                        existing_queue_item.status = 'pending'
                        existing_queue_item.error_message = ''
                        existing_queue_item.save()
                        queue_item = existing_queue_item
                        created = True  # Treat as newly created for triggering download
                    else:
                        # Create new item
                        queue_item, created = DownloadQueue.objects.get_or_create(
                            owner=playlist.owner,
                            url=f"https://www.youtube.com/watch?v={video_id}",
                            defaults={
                                'youtube_id': video_id,
                                'title': entry.get('title', 'Unknown'),
                                'status': 'pending',
                                'auto_start': True
                            }
                        )
                    
                    if created:
                        new_videos += 1
                        # Trigger download task for NEW video
                        download_audio_task.delay(queue_item.id)
                else:
                    # Item is already downloading or completed
                    if existing_queue_item.status == 'completed':
                        # Verify the audio actually exists - if not, reset and redownload
                        audio_exists = Audio.objects.filter(
                            owner=playlist.owner,
                            youtube_id=video_id
                        ).exists()
                        
                        if audio_exists:
                            skipped += 1
                        else:
                            # Queue shows completed but audio doesn't exist - reset and redownload
                            existing_queue_item.status = 'pending'
                            existing_queue_item.error_message = 'Audio missing, re-downloading'
                            existing_queue_item.save()
                            new_videos += 1
                            download_audio_task.delay(existing_queue_item.id)
                
                # Create PlaylistItem for the downloaded audio (will be created after download completes)
                # Note: Audio object might not exist yet, so we'll add a post-download hook
            
            # Update playlist status
            playlist.sync_status = 'success'
            playlist.last_refresh = timezone.now()
            # Count only audios from THIS playlist (match by checking all video IDs in playlist)
            all_playlist_video_ids = [e.get('id') for e in info['entries'] if e and e.get('id')]
            playlist.downloaded_count = Audio.objects.filter(
                owner=playlist.owner,
                youtube_id__in=all_playlist_video_ids
            ).count()
            playlist.save()
            
            if new_videos == 0:
                return f"Playlist '{playlist.title}' up to date ({skipped} already downloaded)"
            
            return f"Playlist '{playlist.title}': {new_videos} new audio(s) queued, {skipped} already downloaded"
    
    except Exception as e:
        playlist.sync_status = 'failed'
        playlist.error_message = str(e)
        playlist.save()
        raise


@shared_task
def link_audio_to_playlists(audio_id, user_id):
    """Link newly downloaded audio to playlists that contain it (optimized)"""
    from playlist.models import Playlist, PlaylistItem
    from django.contrib.auth import get_user_model
    
    try:
        User = get_user_model()
        user = User.objects.get(id=user_id)
        audio = Audio.objects.get(id=audio_id)
        
        # Get all playlists for this user
        playlists = Playlist.objects.filter(owner=user, playlist_type='youtube')
        
        # For each playlist, check if this video is in it
        for playlist in playlists:
            # Check if already linked
            if PlaylistItem.objects.filter(playlist=playlist, audio=audio).exists():
                continue
                
            try:
                ydl_opts = {
                    'quiet': True,
                    'no_warnings': True,
                    'extract_flat': True,
                }
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    playlist_info = ydl.extract_info(
                        f"https://www.youtube.com/playlist?list={playlist.playlist_id}",
                        download=False
                    )
                    if playlist_info and 'entries' in playlist_info:
                        for idx, entry in enumerate(playlist_info['entries']):
                            if entry and entry.get('id') == audio.youtube_id:
                                # Found it! Create the link
                                PlaylistItem.objects.get_or_create(
                                    playlist=playlist,
                                    audio=audio,
                                    defaults={'position': idx}
                                )
                                # Update playlist downloaded count
                                all_video_ids = [e.get('id') for e in playlist_info['entries'] if e and e.get('id')]
                                playlist.downloaded_count = Audio.objects.filter(
                                    owner=user,
                                    youtube_id__in=all_video_ids
                                ).count()
                                playlist.save(update_fields=['downloaded_count'])
                                break
            except Exception as e:
                # Don't fail if playlist linking fails
                pass
                
        return f"Linked audio {audio.youtube_id} to playlists"
    except Exception as e:
        # Don't fail - this is a best-effort operation
        return f"Failed to link audio: {str(e)}"


@shared_task
def cleanup_task():
    """Cleanup old download queue items"""
    # Remove completed items older than 7 days
    cutoff_date = timezone.now() - timedelta(days=7)

    deleted = DownloadQueue.objects.filter(
        status='completed',
        completed_date__lt=cutoff_date
    ).delete()

    return f"Cleaned up {deleted[0]} items"


@shared_task
def reset_stuck_downloads():
    """Reset downloads that have been stuck in 'downloading' status for more than 30 minutes"""
    stuck_threshold = timezone.now() - timedelta(minutes=30)
    
    stuck_downloads = DownloadQueue.objects.filter(
        status='downloading',
        started_date__lt=stuck_threshold
    )
    
    count = stuck_downloads.count()
    
    if count > 0:
        stuck_downloads.update(
            status='failed',
            error_message='Download stuck, reset for retry'
        )
        
        return f"Reset {count} stuck downloads"
    else:
        return "No stuck downloads found"


@shared_task
def retry_failed_downloads(max_retries=3):
    """
    Automatically retry failed downloads that haven't exceeded max retries.
    This ensures downloads continue even when the app was closed.
    """
    # Get failed downloads from the last 24 hours
    retry_window = timezone.now() - timedelta(hours=24)
    
    failed_downloads = DownloadQueue.objects.filter(
        status='failed',
        added_date__gte=retry_window,
    ).exclude(
        error_message__icontains='max retries exceeded'
    ).exclude(
        error_message__icontains='video unavailable'
    ).exclude(
        error_message__icontains='private video'
    ).exclude(
        error_message__icontains='copyright'
    )
    
    retried = 0
    skipped = 0
    
    for download in failed_downloads[:20]:  # Limit to 20 per cycle
        # Count retry attempts from error message or default to 0
        attempts = download.error_message.count('Retry attempt') if download.error_message else 0
        
        if attempts >= max_retries:
            # Mark as permanently failed
            download.error_message = f'{download.error_message}\nmax retries exceeded'
            download.save()
            skipped += 1
            continue
        
        # Reset status and queue for retry
        download.status = 'pending'
        download.error_message = f'Retry attempt {attempts + 1}: {download.error_message or "Auto-retry"}'
        download.save()
        
        # Trigger the download task
        download_audio_task.delay(download.id)
        retried += 1
    
    return f"Retried {retried} downloads, skipped {skipped}"


@shared_task
def resume_pending_downloads():
    """
    Resume any pending downloads that haven't been started.
    Called on app startup to ensure downloads continue.
    """
    pending_downloads = DownloadQueue.objects.filter(
        status='pending',
        auto_start=True,
    ).exclude(
        started_date__isnull=False
    )
    
    count = 0
    for download in pending_downloads[:50]:  # Limit batch size
        download_audio_task.delay(download.id)
        count += 1
    
    return f"Resumed {count} pending downloads"
