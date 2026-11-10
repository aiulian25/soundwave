"""Where each owner's media lives, and the only way bytes are removed or un-shared.

New downloads get a path no other owner can have. Older files may still be shared between
owners of the same video, so anything that removes or rewrites bytes must go through here.
"""

import filecmp
import logging
import os
import shutil
from pathlib import Path

from django.conf import settings
from django.db import transaction
from django.utils.text import get_valid_filename
from mutagen import File as MutagenFile
from mutagen import MutagenError

logger = logging.getLogger(__name__)

OWNER_MEDIA_DIRECTORY = 'users'
COPY_IN_PROGRESS_SUFFIX = '.copying'


def _audio_model():
    # audio.models imports this module for Audio.delete.
    from audio.models import Audio

    return Audio


def absolute_media_path(file_path):
    return Path(settings.MEDIA_ROOT) / file_path


def count_files_on_disk(tracks):
    """How many of these Audio rows have their file present, not merely a stored path."""
    # ponytail: one stat per track, store the verified state on Audio if a huge library makes this slow
    stored_paths = tracks.exclude(file_path='').values_list('file_path', flat=True)
    return sum(absolute_media_path(stored_path).is_file() for stored_path in stored_paths)


def contained_media_path(file_path):
    """The resolved path, or None if a stored value points outside MEDIA_ROOT."""
    resolved = absolute_media_path(file_path).resolve()
    if resolved.is_relative_to(Path(settings.MEDIA_ROOT).resolve()):
        return resolved
    return None


def relative_media_path(absolute_path):
    return str(Path(absolute_path).relative_to(settings.MEDIA_ROOT))


def owner_download_template(owner_id):
    """yt-dlp output template; a literal % in MEDIA_ROOT must not read as a template field."""
    directory = Path(settings.MEDIA_ROOT) / OWNER_MEDIA_DIRECTORY / str(owner_id)
    return str(directory).replace('%', '%%') + '/%(id)s.%(ext)s'


def remove_if_unreferenced(file_path):
    """Returns True if bytes were removed. OSError propagates, for callers that report it."""
    if _audio_model().objects.filter(file_path=file_path).exists():
        return False
    path = contained_media_path(file_path)
    if path is None or not path.is_file():
        return False
    path.unlink()
    return True


def _remove_logging_failure(file_path):
    try:
        remove_if_unreferenced(file_path)
    except OSError as error:
        logger.warning("Could not delete audio file %s: %s", file_path, error)


def remove_after_commit(file_path):
    """A rolled-back transaction can restore a row but never the bytes, so those go last."""
    transaction.on_commit(lambda: _remove_logging_failure(file_path))


def _is_shared(audio):
    return _audio_model().objects.filter(file_path=audio.file_path).exclude(pk=audio.pk).exists()


def _private_path_for(audio, source):
    file_name = get_valid_filename(f'{audio.youtube_id}{source.suffix}')
    return Path(OWNER_MEDIA_DIRECTORY) / str(audio.owner_id) / file_name


def _copy_verified(source, target):
    in_progress = target.with_name(target.name + COPY_IN_PROGRESS_SUFFIX)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, in_progress)
    if not filecmp.cmp(source, in_progress, shallow=False):
        in_progress.unlink()
        raise OSError(f'Copy of {source} did not verify')
    os.replace(in_progress, target)


def ensure_private_file(audio):
    """Give this row bytes only it references, so they can safely be rewritten.

    The source is never moved or changed: another owner is still using it. Returns False,
    leaving the row as it was, when the bytes cannot be made private.
    """
    if not _is_shared(audio):
        return True

    source = contained_media_path(audio.file_path)
    if source is None or not source.is_file():
        logger.warning("Shared file for audio %s is missing or outside the media root", audio.pk)
        return False

    private_path = _private_path_for(audio, source)
    try:
        _copy_verified(source, absolute_media_path(private_path))
    except OSError as error:
        logger.warning("Could not make a private copy for audio %s: %s", audio.pk, error)
        return False

    # Only if nothing changed the row while copying; a concurrent winner's value stands.
    previous_path = audio.file_path
    new_path = str(private_path)
    _audio_model().objects.filter(pk=audio.pk, file_path=previous_path).update(file_path=new_path)
    audio.refresh_from_db(fields=['file_path'])
    return audio.file_path == new_path


class IngestionRefused(Exception):
    """A download stopped by policy; the message starts with a marker the interface translates."""


QUOTA_EXCEEDED_MARKER = '[quota_exceeded]'
DOWNLOAD_TOO_LARGE_MARKER = '[download_too_large]'
NOT_SINGLE_ITEM_MARKER = '[not_single_item]'
DISK_FULL_MARKER = '[disk_full]'
INVALID_OUTPUT_MARKER = '[invalid_output]'

MULTI_ENTRY_TYPES = {'playlist', 'multi_video'}
# First URL segments under /api/audio/; a track with one of these IDs could not be reached.
RESERVED_AUDIO_IDS = {'api', 'list', 'local-audio', 'local-playlists', 'lyrics', 'lyrics-cache'}
# 320 kbps: what the highest lossy quality settles at. Actual bytes are settled on publish.
ESTIMATED_BYTES_PER_SECOND = 40_000
ESTIMATE_FOR_UNKNOWN_DURATION_BYTES = 100 * 1024 * 1024


def refuse_unsuitable_source(info):
    """The worker publishes exactly one bounded track; anything else stops before bytes move."""
    if info.get('id') in RESERVED_AUDIO_IDS:
        raise IngestionRefused(f'{INVALID_OUTPUT_MARKER} This video has an ID the app cannot address.')
    if info.get('_type') in MULTI_ENTRY_TYPES:
        raise IngestionRefused(f'{NOT_SINGLE_ITEM_MARKER} This URL is a collection, not a single track.')
    if info.get('is_live'):
        raise IngestionRefused(f'{NOT_SINGLE_ITEM_MARKER} Live streams cannot be downloaded.')
    if (info.get('duration') or 0) > settings.MAX_DOWNLOAD_DURATION_SECONDS:
        raise IngestionRefused(f'{DOWNLOAD_TOO_LARGE_MARKER} This track is longer than the allowed duration.')


def estimated_download_bytes(info):
    duration = info.get('duration')
    if not duration:
        return ESTIMATE_FOR_UNKNOWN_DURATION_BYTES
    return int(duration * ESTIMATED_BYTES_PER_SECOND)


def _quota_refusal(account):
    return IngestionRefused(f'{QUOTA_EXCEEDED_MARKER} Storage quota of {account.storage_quota_gb} GB is used up.')


def refuse_if_over_quota(owner):
    """Cheap check before any network work; reserve_download makes the binding decision."""
    if not owner.has_unlimited_storage and owner.storage_used_bytes() >= owner.storage_quota_bytes:
        raise _quota_refusal(owner)


def reserve_download(queue_id, owner_id, reserved_bytes):
    """Hold capacity for a download. Counted only while the row is `downloading`, so any
    way out of that status (done, failed, cancelled, lease expired) releases it by itself.
    """
    from download.models import DownloadQueue
    from user.models import Account

    if shutil.disk_usage(settings.MEDIA_ROOT).free - reserved_bytes < settings.MIN_FREE_DISK_BYTES:
        raise IngestionRefused(f'{DISK_FULL_MARKER} Not enough free disk space for this download.')

    with transaction.atomic():
        # The lock serialises one owner's reservations, so concurrent ones cannot overspend.
        account = Account.objects.select_for_update().get(pk=owner_id)
        over_quota = account.storage_used_bytes() + reserved_bytes > account.storage_quota_bytes
        if over_quota and not account.has_unlimited_storage:
            raise _quota_refusal(account)
        DownloadQueue.objects.filter(pk=queue_id).update(reserved_bytes=reserved_bytes)


def refuse_if_settling_exceeds_quota(account, queue_item, replaced_bytes, file_size):
    """Final check against actual bytes; the caller holds the claim's row lock."""
    used_by_everything_else = account.storage_used_bytes() - queue_item.reserved_bytes - replaced_bytes
    if used_by_everything_else + file_size > account.storage_quota_bytes and not account.has_unlimited_storage:
        raise _quota_refusal(account)


def finished_download_path(info):
    """The relative path of the file yt-dlp reports having finished, not one inferred from a name."""
    requested = info.get('requested_downloads') or []
    finished_path = requested[-1].get('filepath') if requested else None
    if not finished_path:
        raise IngestionRefused(f'{INVALID_OUTPUT_MARKER} The download finished without an output file.')
    try:
        return relative_media_path(finished_path)
    except ValueError as error:
        raise IngestionRefused(f'{INVALID_OUTPUT_MARKER} The download finished outside the media folder.') from error


def validated_file_size(file_path):
    """The file's real size, once it is proven to be finished audio within the limits."""
    path = contained_media_path(file_path)
    if path is None or not path.is_file():
        raise IngestionRefused(f'{INVALID_OUTPUT_MARKER} The downloaded file is missing.')

    file_size = path.stat().st_size
    if file_size > settings.MAX_DOWNLOAD_BYTES:
        raise IngestionRefused(f'{DOWNLOAD_TOO_LARGE_MARKER} The downloaded file is larger than allowed.')

    try:
        decoded = MutagenFile(path)
    except (MutagenError, OSError) as error:
        raise IngestionRefused(f'{INVALID_OUTPUT_MARKER} The downloaded file is not valid audio.') from error
    if decoded is None or not decoded.info.length:
        raise IngestionRefused(f'{INVALID_OUTPUT_MARKER} The downloaded file is not valid audio.')
    return file_size
