"""Who may work on a queued download, and for how long.

A worker owns a row only while it holds the row's current claim token. Deleting a row, or
a lease that expired, takes that away, so a stale worker can never publish or overwrite.
"""

import logging
import threading
import uuid
from contextlib import contextmanager
from datetime import timedelta
from urllib.parse import parse_qs, urlparse

from django.db import DatabaseError, connection
from django.db.models import Q
from django.utils import timezone

from download.models import DownloadQueue

logger = logging.getLogger(__name__)

# Long enough to survive a few missed heartbeats, short enough that a crash recovers soon.
LEASE_DURATION = timedelta(minutes=5)
HEARTBEAT_INTERVAL_SECONDS = 60
# Rows claimed before leases existed have none; give their old worker the old allowance.
LEGACY_STUCK_AGE = timedelta(minutes=30)

YOUTUBE_WATCH_HOSTS = {'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'}
YOUTUBE_SHORT_HOST = 'youtu.be'
YOUTUBE_SHORTS_PREFIX = '/shorts/'
YOUTUBE_COLLECTION_PREFIXES = ('/playlist', '/channel/', '/c/', '/user/', '/@')
UNFINISHED_STATUSES = ('pending', 'downloading', 'failed')


def canonical_download_url(url):
    """One spelling per YouTube video, so the same video cannot be queued twice."""
    parsed = urlparse(url)
    host = (parsed.hostname or '').lower()
    video_id = ''
    if host == YOUTUBE_SHORT_HOST:
        video_id = parsed.path.strip('/')
    elif host in YOUTUBE_WATCH_HOSTS and parsed.path.startswith(YOUTUBE_SHORTS_PREFIX):
        video_id = parsed.path[len(YOUTUBE_SHORTS_PREFIX):].strip('/')
    elif host in YOUTUBE_WATCH_HOSTS and parsed.path.rstrip('/') == '/watch':
        video_id = parse_qs(parsed.query).get('v', [''])[0]
    return f'https://www.youtube.com/watch?v={video_id}' if video_id else url


def is_youtube_collection_url(url):
    parsed = urlparse(url)
    host = (parsed.hostname or '').lower()
    return host in YOUTUBE_WATCH_HOSTS and parsed.path.startswith(YOUTUBE_COLLECTION_PREFIXES)


def claim_download(queue_id):
    """Atomically take a pending row; returns its token, or None for any duplicate delivery."""
    token = uuid.uuid4()
    now = timezone.now()
    claimed = DownloadQueue.objects.filter(pk=queue_id, status='pending').update(
        status='downloading',
        claim_token=token,
        lease_expires_at=now + LEASE_DURATION,
        started_date=now,
    )
    return token if claimed else None


def _held_claim(queue_id, token):
    return DownloadQueue.objects.filter(pk=queue_id, claim_token=token, status='downloading')


def renew_claim(queue_id, token):
    renewed = _held_claim(queue_id, token).update(lease_expires_at=timezone.now() + LEASE_DURATION)
    return renewed > 0


def fail_claim(queue_id, token, error_message):
    """Returns False when the claim is gone, so a stale worker's failure overwrites nothing."""
    failed = _held_claim(queue_id, token).update(
        status='failed',
        error_message=error_message,
        claim_token=None,
        lease_expires_at=None,
    )
    return failed > 0


def locked_claim(queue_id, token):
    """The row, locked, if this worker may still publish. Call inside a transaction."""
    return _held_claim(queue_id, token).select_for_update().first()


def expired_claims():
    now = timezone.now()
    return DownloadQueue.objects.filter(status='downloading').filter(
        Q(lease_expires_at__lt=now)
        | Q(lease_expires_at__isnull=True, started_date__lt=now - LEGACY_STUCK_AGE)
    )


def requeue_if_failed(queue_item):
    """A failed row needs to be pending again before a new delivery may claim it."""
    if queue_item.status != 'failed':
        return
    queue_item.status = 'pending'
    queue_item.save(update_fields=['status'])


def cancel_unfinished_downloads(owner, **source):
    """Removing a subscription cancels work it started; deleting the row is what cancels it.

    Finished tracks and `ignored` tombstones are left alone.
    """
    return DownloadQueue.objects.filter(owner=owner, status__in=UNFINISHED_STATUSES, **source).delete()[0]


@contextmanager
def keep_claim_alive(queue_id, token):
    """Renew the lease from a thread, so slow work outlives it and a dead worker does not.

    Yields an event that is set once the claim is gone, for the worker to stop early.
    """
    stopping = threading.Event()
    claim_lost = threading.Event()

    def heartbeat():
        try:
            while not stopping.wait(HEARTBEAT_INTERVAL_SECONDS):
                try:
                    if not renew_claim(queue_id, token):
                        claim_lost.set()
                        return
                except DatabaseError:
                    # A database blip is not a lost claim; publication re-checks anyway.
                    logger.warning('Could not renew the lease on download %s', queue_id, exc_info=True)
        finally:
            connection.close()

    thread = threading.Thread(target=heartbeat, daemon=True)
    thread.start()
    try:
        yield claim_lost
    finally:
        stopping.set()
        thread.join()
