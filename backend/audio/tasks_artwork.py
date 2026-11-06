"""Celery tasks for artwork and metadata management"""
from celery import shared_task
from celery.utils.log import get_task_logger
from django.core.files.base import ContentFile
from django.db.models import Q
import os
from pathlib import Path

from audio.models import Audio
from audio.models_artwork import Artwork, MusicMetadata, ArtistInfo
from audio.artwork_images import (
    InvalidArtworkImage,
    MAX_ARTWORK_BYTES,
    decoded_mime_type,
    load_artwork_image,
)
from common.safe_http import FetchRefused, fetch_public_url
from channel.models import Channel
from audio.lastfm_client import LastFMClient
from audio.fanart_client import FanartClient
from audio.id3_service import ID3TagService
from audio.storage_service import ensure_private_file
from audio.artwork_archive import EXTENSION_BY_MIME_TYPE, THUMBNAIL_TYPE, archive_track_artwork

logger = get_task_logger(__name__)

ARTWORK_FETCH_DEADLINE_SECONDS = 60


@shared_task(bind=True, max_retries=3)
def fetch_metadata_for_audio(self, audio_id: int):
    """
    Fetch metadata for audio from Last.fm
    
    Args:
        audio_id: Audio ID
    """
    try:
        audio = Audio.objects.get(id=audio_id)
        client = LastFMClient()
        
        # Extract artist and title from audio
        artist = audio.channel_name or 'Unknown Artist'
        title = audio.title
        
        # Search Last.fm
        track_info = client.search_track(artist, title)
        
        if not track_info:
            logger.warning(f"No track info found on Last.fm for: {artist} - {title}")
            return
        
        # Create or update metadata
        metadata, created = MusicMetadata.objects.get_or_create(audio=audio)
        
        # Update metadata fields
        if 'album' in track_info:
            metadata.album_name = track_info['album']
        if 'tags' in track_info and track_info['tags']:
            metadata.genre = track_info['tags'][0] if track_info['tags'] else None
            metadata.tags = track_info['tags']
        
        metadata.lastfm_url = track_info.get('url', '')
        metadata.lastfm_mbid = track_info.get('mbid', '')
        metadata.play_count = track_info.get('playcount', 0)
        metadata.listeners = track_info.get('listeners', 0)
        
        metadata.save()
        
        logger.info(f"Updated metadata for audio {audio_id}")
        
        # Also fetch artwork
        fetch_artwork_for_audio.delay(audio_id)
        
    except Audio.DoesNotExist:
        logger.error(f"Audio {audio_id} not found")
    except Exception as e:
        logger.error(f"Error fetching metadata for audio {audio_id}: {e}")
        raise self.retry(exc=e, countdown=300)


@shared_task(bind=True, max_retries=3)
def fetch_artwork_for_audio(self, audio_id: int):
    """
    Fetch artwork for audio from Last.fm and Fanart.tv
    
    Args:
        audio_id: Audio ID
    """
    try:
        audio = Audio.objects.get(id=audio_id)
        
        # Try Last.fm first
        lastfm_client = LastFMClient()
        artist = audio.channel_name or 'Unknown Artist'
        title = audio.title
        
        track_info = lastfm_client.search_track(artist, title)
        
        if track_info and 'images' in track_info:
            # Save album cover from Last.fm
            for img in track_info['images']:
                if img['size'] in ['large', 'extralarge', 'mega']:
                    # Check if artwork already exists
                    if not Artwork.objects.filter(
                        audio=audio,
                        source='lastfm',
                        artwork_type='audio_cover'
                    ).exists():
                        artwork = Artwork.objects.create(
                            audio=audio,
                            artwork_type='audio_cover',
                            source='lastfm',
                            url=img['url'],
                            priority=20
                        )
                        
                        # Download and save locally
                        download_artwork.delay(artwork.id)
                        
                        logger.info(f"Created Last.fm artwork for audio {audio_id}")
                    break
        
        # Try Fanart.tv if we have MusicBrainz ID
        try:
            metadata = MusicMetadata.objects.get(audio=audio)
            if metadata.lastfm_mbid:
                fanart_client = FanartClient()
                artist_images = fanart_client.get_artist_images(metadata.lastfm_mbid)
                
                if artist_images:
                    # Save artist thumbnail
                    if artist_images['thumbnails']:
                        img = artist_images['thumbnails'][0]
                        if not Artwork.objects.filter(
                            audio=audio,
                            source='fanart',
                            artwork_type='audio_cover'
                        ).exists():
                            artwork = Artwork.objects.create(
                                audio=audio,
                                artwork_type='audio_cover',
                                source='fanart',
                                url=img['url'],
                                priority=30
                            )
                            download_artwork.delay(artwork.id)
                            logger.info(f"Created Fanart.tv artwork for audio {audio_id}")
        except MusicMetadata.DoesNotExist:
            pass
        
        # Keep the YouTube thumbnail too, as the fallback
        archive_track_artwork(audio)
        
    except Audio.DoesNotExist:
        logger.error(f"Audio {audio_id} not found")
    except Exception as e:
        logger.error(f"Error fetching artwork for audio {audio_id}: {e}")
        raise self.retry(exc=e, countdown=300)


@shared_task(bind=True, max_retries=3)
def fetch_artist_info(self, channel_id: int):
    """
    Fetch artist information from Last.fm
    
    Args:
        channel_id: Channel ID
    """
    try:
        channel = Channel.objects.get(id=channel_id)
        client = LastFMClient()
        
        artist_name = channel.channel_name
        artist_info = client.get_artist_info(artist_name)
        
        if not artist_info:
            logger.warning(f"No artist info found on Last.fm for: {artist_name}")
            return
        
        # Create or update artist info
        info, created = ArtistInfo.objects.get_or_create(channel=channel)
        
        info.bio = artist_info.get('bio', '')
        info.bio_summary = artist_info.get('bio_summary', '')
        info.lastfm_url = artist_info.get('url', '')
        info.lastfm_mbid = artist_info.get('mbid', '')
        info.lastfm_listeners = artist_info.get('listeners', 0)
        info.lastfm_playcount = artist_info.get('playcount', 0)
        info.tags = artist_info.get('tags', [])
        info.similar_artists = artist_info.get('similar_artists', [])
        
        info.save()
        
        logger.info(f"Updated artist info for channel {channel_id}")
        
        # Also fetch artist artwork
        fetch_artist_artwork.delay(channel_id)
        
    except Channel.DoesNotExist:
        logger.error(f"Channel {channel_id} not found")
    except Exception as e:
        logger.error(f"Error fetching artist info for channel {channel_id}: {e}")
        raise self.retry(exc=e, countdown=300)


@shared_task(bind=True, max_retries=3)
def fetch_artist_artwork(self, channel_id: int):
    """
    Fetch artist artwork from Last.fm and Fanart.tv
    
    Args:
        channel_id: Channel ID
    """
    try:
        channel = Channel.objects.get(id=channel_id)
        
        # Try Last.fm first
        lastfm_client = LastFMClient()
        artist_name = channel.channel_name
        artist_info = lastfm_client.get_artist_info(artist_name)
        
        if artist_info and 'images' in artist_info:
            # Save artist image from Last.fm
            for img in artist_info['images']:
                if img['size'] in ['large', 'extralarge', 'mega']:
                    if not Artwork.objects.filter(
                        channel=channel,
                        source='lastfm',
                        artwork_type='artist_image'
                    ).exists():
                        artwork = Artwork.objects.create(
                            channel=channel,
                            artwork_type='artist_image',
                            source='lastfm',
                            url=img['url'],
                            priority=20
                        )
                        download_artwork.delay(artwork.id)
                        logger.info(f"Created Last.fm artist image for channel {channel_id}")
                    break
        
        # Try Fanart.tv if we have MusicBrainz ID
        try:
            info = ArtistInfo.objects.get(channel=channel)
            if info.lastfm_mbid:
                fanart_client = FanartClient()
                artist_images = fanart_client.get_artist_images(info.lastfm_mbid)
                
                if artist_images:
                    # Save artist thumbnail
                    if artist_images['thumbnails'] and not Artwork.objects.filter(
                        channel=channel,
                        source='fanart',
                        artwork_type='artist_image'
                    ).exists():
                        img = artist_images['thumbnails'][0]
                        artwork = Artwork.objects.create(
                            channel=channel,
                            artwork_type='artist_image',
                            source='fanart',
                            url=img['url'],
                            priority=30
                        )
                        download_artwork.delay(artwork.id)
                    
                    # Save artist banner
                    if artist_images['banners'] and not Artwork.objects.filter(
                        channel=channel,
                        source='fanart',
                        artwork_type='artist_banner'
                    ).exists():
                        img = artist_images['banners'][0]
                        artwork = Artwork.objects.create(
                            channel=channel,
                            artwork_type='artist_banner',
                            source='fanart',
                            url=img['url'],
                            priority=30
                        )
                        download_artwork.delay(artwork.id)
                    
                    # Save artist logo
                    if (artist_images['logos_hd'] or artist_images['logos']) and not Artwork.objects.filter(
                        channel=channel,
                        source='fanart',
                        artwork_type='artist_logo'
                    ).exists():
                        img = artist_images['logos_hd'][0] if artist_images['logos_hd'] else artist_images['logos'][0]
                        artwork = Artwork.objects.create(
                            channel=channel,
                            artwork_type='artist_logo',
                            source='fanart',
                            url=img['url'],
                            priority=30
                        )
                        download_artwork.delay(artwork.id)
                    
                    logger.info(f"Created Fanart.tv artwork for channel {channel_id}")
        except ArtistInfo.DoesNotExist:
            pass
        
        # Use YouTube thumbnail as fallback
        if channel.channel_thumbnail and not Artwork.objects.filter(channel=channel, source='youtube').exists():
            artwork = Artwork.objects.create(
                channel=channel,
                artwork_type='artist_image',
                source='youtube',
                url=channel.channel_thumbnail,
                priority=10
            )
            download_artwork.delay(artwork.id)
            logger.info(f"Created YouTube thumbnail for channel {channel_id}")
        
    except Channel.DoesNotExist:
        logger.error(f"Channel {channel_id} not found")
    except Exception as e:
        logger.error(f"Error fetching artist artwork for channel {channel_id}: {e}")
        raise self.retry(exc=e, countdown=300)


@shared_task(bind=True, max_retries=3)
def download_artwork(self, artwork_id: int):
    """
    Download artwork from URL and save locally
    
    Args:
        artwork_id: Artwork ID
    """
    try:
        artwork = Artwork.objects.get(id=artwork_id)
        
        if not artwork.url:
            logger.warning(f"No URL for artwork {artwork_id}")
            return

        # Artwork.url can be user-supplied through ArtworkViewSet, so the fetch is bounded and
        # every hop validated, and only a decoded image ever reaches the disk.
        try:
            fetched = fetch_public_url(artwork.url, MAX_ARTWORK_BYTES, ARTWORK_FETCH_DEADLINE_SECONDS)
            ext = EXTENSION_BY_MIME_TYPE[decoded_mime_type(fetched.content)]
        except (FetchRefused, InvalidArtworkImage) as refusal:
            logger.warning("Refused artwork fetch for artwork %s: %s", artwork_id, refusal)
            return
        
        # Generate filename
        if artwork.audio:
            filename = f"audio_{artwork.audio.id}_{artwork.artwork_type}_{artwork.source}.{ext}"
        elif artwork.channel:
            filename = f"channel_{artwork.channel.id}_{artwork.artwork_type}_{artwork.source}.{ext}"
        else:
            filename = f"artwork_{artwork.id}.{ext}"
        
        # Save to media directory
        from django.conf import settings
        artwork_dir = Path(settings.MEDIA_ROOT) / 'artwork'
        artwork_dir.mkdir(parents=True, exist_ok=True)
        
        filepath = artwork_dir / filename
        
        with open(filepath, 'wb') as f:
            f.write(fetched.content)
        
        # Update artwork record
        artwork.local_path = str(filepath.relative_to(settings.MEDIA_ROOT))
        artwork.save()
        
        logger.info(f"Downloaded artwork {artwork_id} to {filepath}")
        
        # If it's audio cover, embed in file
        if artwork.audio and artwork.artwork_type in ['audio_cover', 'audio_thumbnail']:
            embed_artwork_in_audio.delay(artwork.audio.id, artwork_id)
        
    except Artwork.DoesNotExist:
        logger.error(f"Artwork {artwork_id} not found")
    except Exception as e:
        logger.error(f"Error downloading artwork {artwork_id}: {e}")
        raise self.retry(exc=e, countdown=300)


@shared_task(bind=True)
def embed_artwork_in_audio(self, audio_id: int, artwork_id: int = None):
    """
    Embed artwork in audio file using ID3 tags
    
    Args:
        audio_id: Audio ID
        artwork_id: Optional specific artwork ID to embed (uses best if not provided)
    """
    try:
        audio = Audio.objects.get(id=audio_id)
        
        if not audio.file_path:
            logger.warning(f"No media file for audio {audio_id}")
            return
        
        # Get artwork
        if artwork_id:
            # Re-checked here: queued ids and stored rows may predate or bypass the API checks.
            artwork = Artwork.embeddable_in(audio).filter(id=artwork_id).first()
        else:
            # Get best artwork (highest priority)
            artwork = Artwork.objects.filter(
                audio=audio,
                local_path__isnull=False
            ).order_by('-priority', '-id').first()
        
        if not artwork or not artwork.local_path:
            logger.warning(f"No local artwork found for audio {audio_id}")
            return
        
        # Read image data
        try:
            image_data, mime_type = load_artwork_image(artwork)
        except InvalidArtworkImage as e:
            logger.warning(f"Refused artwork {artwork.id} for audio {audio_id}: {e}")
            return
        
        # Embed in audio file
        from django.conf import settings
        service = ID3TagService()
        if not ensure_private_file(audio):
            logger.error(f"Could not make a private copy of audio {audio_id}")
            return
        audio_path = Path(settings.MEDIA_ROOT) / audio.file_path
        
        if audio_path.exists():
            success = service.embed_cover_art(str(audio_path), image_data, mime_type)
            if success:
                logger.info(f"Embedded artwork in audio {audio_id}")
            else:
                logger.error(f"Failed to embed artwork in audio {audio_id}")
        else:
            logger.error(f"Audio file not found: {audio_path}")
        
    except Audio.DoesNotExist:
        logger.error(f"Audio {audio_id} not found")
    except Exception as e:
        logger.error(f"Error embedding artwork for audio {audio_id}: {e}")


@shared_task(name='audio.auto_fetch_artwork_batch')
def auto_fetch_artwork_batch(limit: int = 50):
    """
    Auto-fetch artwork for audio without artwork
    
    Args:
        limit: Maximum number of audio to process
    """
    # Find audio without artwork
    audio_without_artwork = Audio.objects.filter(
        ~Q(artworks__isnull=False)
    )[:limit]
    
    count = 0
    for audio in audio_without_artwork:
        fetch_metadata_for_audio.delay(audio.id)
        count += 1
    
    logger.info(f"Queued artwork fetch for {count} audio tracks")


@shared_task(name='audio.auto_fetch_artist_info_batch')
def auto_fetch_artist_info_batch(limit: int = 20):
    """
    Auto-fetch artist info for channels without info
    
    Args:
        limit: Maximum number of channels to process
    """
    # Find channels without artist info
    channels_without_info = Channel.objects.filter(
        ~Q(artist_info__isnull=False)
    )[:limit]
    
    count = 0
    for channel in channels_without_info:
        fetch_artist_info.delay(channel.id)
        count += 1
    
    logger.info(f"Queued artist info fetch for {count} channels")


@shared_task
def update_id3_tags_from_metadata(audio_id: int):
    """
    Update ID3 tags in audio file from metadata
    
    Args:
        audio_id: Audio ID
    """
    try:
        audio = Audio.objects.get(id=audio_id)
        
        if not audio.file_path:
            logger.warning(f"No media file for audio {audio_id}")
            return
        
        from django.conf import settings
        if not ensure_private_file(audio):
            logger.error(f"Could not make a private copy of audio {audio_id}")
            return
        audio_path = Path(settings.MEDIA_ROOT) / audio.file_path
        
        if not audio_path.exists():
            logger.error(f"Audio file not found: {audio_path}")
            return
        
        # Prepare tags
        tags = {
            'title': audio.title,
            'artist': audio.channel_name or 'Unknown Artist',
        }
        
        # Add metadata if available
        try:
            metadata = MusicMetadata.objects.get(audio=audio)
            if metadata.album_name:
                tags['album'] = metadata.album_name
            if metadata.album_artist:
                tags['album_artist'] = metadata.album_artist
            if metadata.release_year:
                tags['year'] = str(metadata.release_year)
            if metadata.genre:
                tags['genre'] = metadata.genre
            if metadata.track_number:
                tags['track_number'] = metadata.track_number
            if metadata.disc_number:
                tags['disc_number'] = metadata.disc_number
        except MusicMetadata.DoesNotExist:
            pass
        
        # Write tags
        service = ID3TagService()
        success = service.write_tags(str(audio_path), tags)
        
        if success:
            logger.info(f"Updated ID3 tags for audio {audio_id}")
        else:
            logger.error(f"Failed to update ID3 tags for audio {audio_id}")
        
    except Audio.DoesNotExist:
        logger.error(f"Audio {audio_id} not found")
    except Exception as e:
        logger.error(f"Error updating ID3 tags for audio {audio_id}: {e}")


# Small, spaced batches: this only reads images YouTube already serves to every viewer, but it
# should never look like a crawler.
ARCHIVE_BATCH_SIZE = 100
ARCHIVE_PAUSE_SECONDS = 1


@shared_task(name='audio.archive_missing_artwork')
def archive_missing_artwork(limit: int = ARCHIVE_BATCH_SIZE):
    """Keep the artwork of downloaded tracks that have not had theirs kept yet."""
    import time

    waiting = (
        Audio.objects.exclude(file_path='')
        .exclude(thumbnail_url='')
        .exclude(artworks__artwork_type=THUMBNAIL_TYPE)
        .order_by('-downloaded_date')[:limit]
    )
    kept = 0
    for audio in waiting:
        if archive_track_artwork(audio) is not None:
            kept += 1
        time.sleep(ARCHIVE_PAUSE_SECONDS)
    return f'Kept artwork for {kept} of {len(waiting)} tracks'
