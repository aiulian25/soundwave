"""What keeps exports from exhausting the machine: size, space, concurrency and scratch.

Work goes in a dedicated folder on the cache volume rather than /tmp, which is a small tmpfs
in production, and nothing here ever touches source media.
"""

import logging
import shutil
import tempfile
import time
from pathlib import Path

from django.conf import settings
from django.core.cache import cache
from django.http import FileResponse

logger = logging.getLogger(__name__)

# Worst case for uncompressed-equivalent CD audio, which FLAC stays below on real material.
_FLAC_BYTES_PER_SECOND = 176_400
_MP3_BYTES_PER_SECOND = {'high': 40_000, 'medium': 24_000, 'low': 16_000}
_WORST_MP3_BYTES_PER_SECOND = _MP3_BYTES_PER_SECOND['high']

SYNC_SLOT = 'sync'
JOB_SLOT = 'job'
_SLOT_KEY = 'export_slot:{group}:{index}'
_ORPHAN_SCRATCH_AGE_SECONDS = 6 * 60 * 60


class ExportRefused(Exception):
    """The export must not start. `status` is the HTTP answer and `message` says why."""

    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def _track_estimate(audio, target_format, quality):
    source_is_target = (audio.file_path or '').lower().endswith(f'.{target_format}')
    if source_is_target and (quality == 'original' or target_format == 'flac'):
        return audio.file_size or 0
    if target_format == 'flac':
        return audio.duration * _FLAC_BYTES_PER_SECOND
    return audio.duration * _MP3_BYTES_PER_SECOND.get(quality, _WORST_MP3_BYTES_PER_SECOND)


def estimated_export_bytes(tracks, target_format, quality):
    return sum(_track_estimate(audio, target_format, quality) for audio in tracks)


def scratch_root():
    root = Path(settings.EXPORT_SCRATCH_DIR)
    root.mkdir(parents=True, exist_ok=True)
    return root


def refuse_if_no_room(estimated_bytes):
    if estimated_bytes > settings.EXPORT_MAX_BYTES:
        raise ExportRefused(413, 'This export is too large. Choose fewer tracks or a smaller format.')
    free_bytes = shutil.disk_usage(scratch_root()).free
    if free_bytes < estimated_bytes + settings.EXPORT_MIN_FREE_BYTES:
        raise ExportRefused(507, 'There is not enough free space for this export right now.')


def new_scratch_dir():
    return Path(tempfile.mkdtemp(dir=scratch_root()))


def remove_scratch_dir(path):
    """Refuses anything outside the scratch folder, so a bad stored path can never reach media."""
    target = Path(path).resolve()
    if scratch_root().resolve() not in target.parents:
        logger.error('[Export] Refused to remove %s: outside the scratch folder', target)
        return
    shutil.rmtree(target, ignore_errors=True)


def take_slot(group, capacity, lifetime_seconds):
    """A key to hand back to release_slot, or None when every slot is taken. Slots expire, so a
    killed process cannot hold one forever."""
    for index in range(capacity):
        key = _SLOT_KEY.format(group=group, index=index)
        if cache.add(key, True, timeout=lifetime_seconds):
            return key
    return None


def release_slot(key):
    cache.delete(key)


def take_sync_slot():
    key = take_slot(SYNC_SLOT, settings.EXPORT_MAX_SYNC, settings.EXPORT_SLOT_LIFETIME_SECONDS)
    if key is None:
        raise ExportRefused(429, 'The server is busy with other exports. Please try again shortly.')
    return key


class ScratchFileResponse(FileResponse):
    """Streams a file from disk and tidies up afterwards.

    The server closes a response whether the download finished or the client went away, so
    this is the one moment that is both safe and certain to happen.
    """

    def __init__(self, *args, cleanup, **kwargs):
        super().__init__(*args, **kwargs)
        self._cleanup = cleanup

    def close(self):
        super().close()
        cleanup, self._cleanup = self._cleanup, None
        if cleanup:
            cleanup()


def removable_orphan_dirs(known_dirs, now=None):
    """Scratch folders no job claims that are too old to belong to a running request."""
    now = now or time.time()
    return [
        entry for entry in scratch_root().iterdir()
        if entry.is_dir()
        and str(entry) not in known_dirs
        and now - entry.stat().st_mtime > _ORPHAN_SCRATCH_AGE_SECONDS
    ]
