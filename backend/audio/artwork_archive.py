"""A downloaded track's artwork, kept on this server: fetched once, then never again.

The links stored at download point at YouTube, Last.fm or Fanart. YouTube's goes grey when the
video is removed, and every request for any of them tells that service who is looking, so lists
and the player only ever load the copy kept here.
"""

import logging
import os
from pathlib import Path

import requests
from django.conf import settings

from audio.artwork_images import ARTWORK_SUBDIRECTORY, InvalidArtworkImage, MAX_ARTWORK_BYTES, decoded_mime_type
from audio.models_artwork import Artwork
from common.safe_http import FetchRefused, REFUSED_UPSTREAM_STATUS, fetch_public_url

logger = logging.getLogger(__name__)

EXTENSION_BY_MIME_TYPE = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
}
ARCHIVE_FETCH_TIMEOUT_SECONDS = 20
# Only these answers mean the image no longer exists; anything else may work next time.
GONE_STATUS_CODES = {404, 410}

COVER_TYPE = 'audio_cover'
THUMBNAIL_TYPE = 'audio_thumbnail'
YOUTUBE_SOURCE = 'youtube'
COVER_LINK_SOURCE = 'cover_link'
# Above the YouTube thumbnail, as the player preferred cover art before.
COVER_PRIORITY = 20
THUMBNAIL_PRIORITY = 10


def stored_artwork(audio):
    """The best artwork kept on disk for this track, or None."""
    return (
        Artwork.objects.filter(audio=audio)
        .exclude(local_path='')
        .order_by('-priority', '-fetched_date')
        .first()
    )


def _links_to_keep(audio):
    """(link, artwork type, source, priority) for each image this track points at."""
    links = []
    if audio.cover_art_url:
        links.append((audio.cover_art_url, COVER_TYPE, COVER_LINK_SOURCE, COVER_PRIORITY))
    if audio.thumbnail_url:
        links.append((audio.thumbnail_url, THUMBNAIL_TYPE, YOUTUBE_SOURCE, THUMBNAIL_PRIORITY))
    return links


def _write_image(audio, artwork_type, source, image_data, mime_type):
    filename = f'audio_{audio.id}_{artwork_type}_{source}.{EXTENSION_BY_MIME_TYPE[mime_type]}'
    directory = Path(settings.MEDIA_ROOT) / ARTWORK_SUBDIRECTORY
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / filename
    partial = directory / f'.{filename}.partial'
    partial.write_bytes(image_data)
    os.replace(partial, target)
    return str(target.relative_to(settings.MEDIA_ROOT))


def _keep(audio, link, artwork_type, source, priority):
    """Store one linked image unless it is stored already or known to be gone."""
    from audio.views import is_safe_artwork_url  # audio.views imports the models this module uses

    already_tried = Artwork.objects.filter(audio=audio, artwork_type=artwork_type, url=link)
    if already_tried.exists() or not is_safe_artwork_url(link):
        return

    try:
        fetched = fetch_public_url(link, MAX_ARTWORK_BYTES, ARCHIVE_FETCH_TIMEOUT_SECONDS)
        mime_type = decoded_mime_type(fetched.content)
    except FetchRefused as refusal:
        if refusal.status_code in GONE_STATUS_CODES:
            # Recorded with no file, so nobody asks the host again for an image it no longer has.
            Artwork.objects.create(
                audio=audio, artwork_type=artwork_type, source=source, url=link, priority=priority
            )
        logger.info('Artwork for track %s not kept: %s', audio.id, refusal)
        return
    except (InvalidArtworkImage, requests.RequestException) as error:
        logger.info('Artwork for track %s not kept this time: %s', audio.id, error)
        return

    try:
        local_path = _write_image(audio, artwork_type, source, fetched.content, mime_type)
    except OSError as error:
        logger.warning('Artwork for track %s could not be written: %s', audio.id, error)
        return
    Artwork.objects.filter(audio=audio, artwork_type=artwork_type, source=source).delete()
    Artwork.objects.create(
        audio=audio,
        artwork_type=artwork_type,
        source=source,
        url=link,
        local_path=local_path,
        file_size=len(fetched.content),
        priority=priority,
    )


def archive_track_artwork(audio):
    """Keep every image the track links to, then return the best one kept, or None."""
    for link, artwork_type, source, priority in _links_to_keep(audio):
        _keep(audio, link, artwork_type, source, priority)
    return stored_artwork(audio)
