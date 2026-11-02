"""Background playlist exports and their cleanup."""

import errno
import logging
from datetime import timedelta

from celery import shared_task
from celery.exceptions import SoftTimeLimitExceeded
from django.conf import settings
from django.utils import timezone

from audio.export import exportable_playlist_tracks, write_playlist_zip
from audio.export_limits import (
    JOB_SLOT,
    new_scratch_dir,
    release_slot,
    remove_scratch_dir,
    removable_orphan_dirs,
    take_slot,
)
from audio.models_export import (
    ACTIVE_STATUSES,
    STATUS_EXPIRED,
    STATUS_FAILED,
    STATUS_QUEUED,
    STATUS_READY,
    STATUS_RUNNING,
    ExportJob,
)

logger = logging.getLogger(__name__)

SLOT_RETRY_SECONDS = 30
RESULT_LIFETIME = timedelta(hours=1)
# Well past the task's own hard limit, so only a killed worker leaves a job this old.
ABANDONED_AFTER = timedelta(hours=2)
NO_SPACE_MESSAGE = 'The server ran out of space during this export.'
TOO_LONG_MESSAGE = 'This export took too long.'
NOTHING_EXPORTED_MESSAGE = 'No tracks could be exported.'
FAILED_MESSAGE = 'This export failed.'


def _finish(job_id, **fields):
    """Only an export still running can finish; a cancel that arrived first stands."""
    return ExportJob.objects.filter(pk=job_id, status=STATUS_RUNNING).update(**fields) == 1


def _fail(job, work_dir, message):
    if work_dir:
        remove_scratch_dir(work_dir)
    _finish(job.pk, status=STATUS_FAILED, error_message=message, scratch_dir='')


def _run_export(job):
    work_dir = new_scratch_dir()
    ExportJob.objects.filter(pk=job.pk).update(scratch_dir=str(work_dir))
    try:
        tracks = exportable_playlist_tracks(job.playlist)

        def still_wanted():
            return ExportJob.objects.filter(pk=job.pk, status=STATUS_RUNNING).exists()

        def report_progress(tracks_done):
            ExportJob.objects.filter(pk=job.pk).update(tracks_done=tracks_done)

        outcome = write_playlist_zip(
            tracks, job.options, work_dir, job.playlist.title or job.playlist.playlist_id,
            still_wanted=still_wanted, report_progress=report_progress,
        )
    except SoftTimeLimitExceeded:
        _fail(job, work_dir, TOO_LONG_MESSAGE)
        return
    except OSError as error:
        logger.warning('[ExportJob] %s failed: %s', job.pk, error)
        _fail(job, work_dir, NO_SPACE_MESSAGE if error.errno == errno.ENOSPC else FAILED_MESSAGE)
        return
    except Exception:
        logger.exception('[ExportJob] %s failed', job.pk)
        _fail(job, work_dir, FAILED_MESSAGE)
        raise

    if outcome.exported_count == 0:
        _fail(job, work_dir, NOTHING_EXPORTED_MESSAGE)
        return

    finished = _finish(
        job.pk,
        status=STATUS_READY,
        file_name=outcome.path.name,
        file_bytes=outcome.path.stat().st_size,
        summary={'omitted': outcome.omitted, 'warnings': outcome.warnings},
        expires_at=timezone.now() + RESULT_LIFETIME,
    )
    if not finished:
        remove_scratch_dir(work_dir)
        ExportJob.objects.filter(pk=job.pk).update(scratch_dir='')


@shared_task(
    bind=True,
    name='audio.build_playlist_export',
    soft_time_limit=settings.EXPORT_JOB_SOFT_LIMIT_SECONDS,
    time_limit=settings.EXPORT_JOB_SOFT_LIMIT_SECONDS + 60,
)
def build_playlist_export(self, job_id):
    """Runs one export at a time, so background downloads always keep a worker."""
    slot = take_slot(JOB_SLOT, 1, settings.EXPORT_JOB_SOFT_LIMIT_SECONDS + 120)
    if slot is None:
        if ExportJob.objects.filter(pk=job_id, status=STATUS_QUEUED).exists():
            self.apply_async(args=[job_id], countdown=SLOT_RETRY_SECONDS)
        return

    try:
        claimed = ExportJob.objects.filter(pk=job_id, status=STATUS_QUEUED).update(
            status=STATUS_RUNNING, started_at=timezone.now(),
        )
        if claimed:
            _run_export(ExportJob.objects.select_related('playlist').get(pk=job_id))
    finally:
        release_slot(slot)


@shared_task(name='audio.sweep_export_scratch')
def sweep_export_scratch():
    """Frees finished exports past their expiry, jobs a dead worker left, and stray folders."""
    now = timezone.now()

    expired = ExportJob.objects.filter(status=STATUS_READY, expires_at__lte=now)
    for job in expired:
        if job.scratch_dir:
            remove_scratch_dir(job.scratch_dir)
        ExportJob.objects.filter(pk=job.pk).update(status=STATUS_EXPIRED, scratch_dir='')

    abandoned = ExportJob.objects.filter(status__in=ACTIVE_STATUSES, created_at__lte=now - ABANDONED_AFTER)
    for job in abandoned:
        if job.scratch_dir:
            remove_scratch_dir(job.scratch_dir)
        ExportJob.objects.filter(pk=job.pk).update(
            status=STATUS_FAILED, error_message=FAILED_MESSAGE, scratch_dir='',
        )

    known_dirs = set(ExportJob.objects.exclude(scratch_dir='').values_list('scratch_dir', flat=True))
    for orphan in removable_orphan_dirs(known_dirs):
        remove_scratch_dir(orphan)

    return f'{len(expired)} expired, {len(abandoned)} abandoned'


