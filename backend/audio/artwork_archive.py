"""Artwork kept on this server: fetched once, then never again.

Tracks, playlists and channels carry image links that point at YouTube, Last.fm or Fanart.
YouTube's goes grey when the item is removed, and every request for any of them tells that
service who is looking, so pages and the player only ever load the copy kept here.

Fetching happens in workers only (at download, in the backfill job, or when a page asks for
something with nothing kept yet). A web request never waits on another host.
"""

import hashlib
import logging
import os
from pathlib import Path

import requests
from django.conf import settings
from django.core.cache import cache

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
# A page showing an item asks a worker for its artwork at most this often, so a host that is
# failing is not asked again by every page view.
ARCHIVE_REQUEST_INTERVAL_SECONDS = 60 * 60
ARCHIVE_REQUEST_KEY = 'artwork_archive_requested:{owner_field}:{subject_id}:{links_digest}'

# What an image belongs to, named as the Artwork field that points at it.
TRACK = 'audio'
PLAYLIST = 'playlist'
CHANNEL = 'channel'

COVER_TYPE = 'audio_cover'
THUMBNAIL_TYPE = 'audio_thumbnail'
PLAYLIST_COVER_TYPE = 'playlist_cover'
CHANNEL_THUMBNAIL_TYPE = 'channel_thumbnail'
YOUTUBE_SOURCE = 'youtube'
COVER_LINK_SOURCE = 'cover_link'
# Above the YouTube thumbnail, as the player preferred cover art before.
COVER_PRIORITY = 20
THUMBNAIL_PRIORITY = 10
# A channel can also hold banners and logos from other sources; its picture is this one type.
# A track shows whichever of its images ranks highest.
SERVED_TYPES = {
    PLAYLIST: (PLAYLIST_COVER_TYPE,),
    CHANNEL: (CHANNEL_THUMBNAIL_TYPE,),
}


def _linked_images(owner_field, subject):
    """(link, artwork type, source, priority) for each image this item points at."""
    if owner_field == PLAYLIST:
        return ((subject.thumbnail_url, PLAYLIST_COVER_TYPE, YOUTUBE_SOURCE, THUMBNAIL_PRIORITY),)
    if owner_field == CHANNEL:
        return ((subject.channel_thumbnail, CHANNEL_THUMBNAIL_TYPE, YOUTUBE_SOURCE, THUMBNAIL_PRIORITY),)
    return (
        (subject.cover_art_url, COVER_TYPE, COVER_LINK_SOURCE, COVER_PRIORITY),
        (subject.thumbnail_url, THUMBNAIL_TYPE, YOUTUBE_SOURCE, THUMBNAIL_PRIORITY),
    )


def _links_to_keep(owner_field, subject):
    """The linked images that exist and may be fetched."""
    from audio.views import is_safe_artwork_url  # audio.views imports the models this module uses

    return [image for image in _linked_images(owner_field, subject) if image[0] and is_safe_artwork_url(image[0])]


def _artwork_of(owner_field, subject):
    return Artwork.objects.filter(**{owner_field: subject})


def stored_artwork(owner_field, subject):
    """The best artwork kept on disk for this item, or None."""
    kept = _artwork_of(owner_field, subject).exclude(local_path='')
    served_types = SERVED_TYPES.get(owner_field)
    if served_types:
        kept = kept.filter(artwork_type__in=served_types)
    return kept.order_by('-priority', '-fetched_date').first()


def _already_tried(owner_field, subject, link, artwork_type):
    return _artwork_of(owner_field, subject).filter(artwork_type=artwork_type, url=link).exists()


def _write_image(owner_field, subject, artwork_type, source, image_data, mime_type):
    filename = f'{owner_field}_{subject.id}_{artwork_type}_{source}.{EXTENSION_BY_MIME_TYPE[mime_type]}'
    directory = Path(settings.MEDIA_ROOT) / ARTWORK_SUBDIRECTORY
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / filename
    partial = directory / f'.{filename}.partial'
    partial.write_bytes(image_data)
    os.replace(partial, target)
    return str(target.relative_to(settings.MEDIA_ROOT))


def _keep(owner_field, subject, link, artwork_type, source, priority):
    """Store one linked image unless it is stored already or known to be gone."""
    if _already_tried(owner_field, subject, link, artwork_type):
        return

    label = f'{owner_field} {subject.id}'
    try:
        fetched = fetch_public_url(link, MAX_ARTWORK_BYTES, ARCHIVE_FETCH_TIMEOUT_SECONDS)
        mime_type = decoded_mime_type(fetched.content)
    except FetchRefused as refusal:
        if refusal.status_code in GONE_STATUS_CODES:
            # Recorded with no file, so nobody asks the host again for an image it no longer has.
            Artwork.objects.create(
                **{owner_field: subject}, artwork_type=artwork_type, source=source, url=link, priority=priority
            )
        logger.info('Artwork for %s not kept: %s', label, refusal)
        return
    except (InvalidArtworkImage, requests.RequestException) as error:
        logger.info('Artwork for %s not kept this time: %s', label, error)
        return

    try:
        local_path = _write_image(owner_field, subject, artwork_type, source, fetched.content, mime_type)
    except OSError as error:
        logger.warning('Artwork for %s could not be written: %s', label, error)
        return
    kept = Artwork.objects.create(
        **{owner_field: subject},
        artwork_type=artwork_type,
        source=source,
        url=link,
        local_path=local_path,
        file_size=len(fetched.content),
        priority=priority,
    )
    # After the new row exists: deleting a row removes its image unless another row keeps the
    # same file, and a replacement of the same type is written under the same name.
    _artwork_of(owner_field, subject).filter(artwork_type=artwork_type, source=source).exclude(pk=kept.pk).delete()


def archive_artwork(owner_field, subject):
    """Keep every image the item links to, then return the best one kept, or None."""
    for link, artwork_type, source, priority in _links_to_keep(owner_field, subject):
        _keep(owner_field, subject, link, artwork_type, source, priority)
    return stored_artwork(owner_field, subject)


def archive_track_artwork(audio):
    """Keep a downloaded track's artwork, then return the best one kept, or None."""
    return archive_artwork(TRACK, audio)


def request_archive(owner_field, subject):
    """Ask a worker to keep this item's artwork if a link has not been tried, once per interval."""
    untried = [
        link for link, artwork_type, _source, _priority in _links_to_keep(owner_field, subject)
        if not _already_tried(owner_field, subject, link, artwork_type)
    ]
    if not untried:
        return
    # Keyed on the links too, so a cover chosen a minute ago is fetched now, not in an hour.
    request_key = ARCHIVE_REQUEST_KEY.format(
        owner_field=owner_field,
        subject_id=subject.id,
        links_digest=hashlib.sha256('|'.join(untried).encode()).hexdigest(),
    )
    if not cache.add(request_key, True, ARCHIVE_REQUEST_INTERVAL_SECONDS):
        return

    from audio.tasks_artwork import archive_artwork_task  # that module imports this one

    archive_artwork_task.delay(owner_field, subject.id)
