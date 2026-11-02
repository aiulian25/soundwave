"""Following, canceling and collecting background playlist exports."""

from django.db.models import Q
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response

from audio.export_limits import remove_scratch_dir
from audio.models_export import ACTIVE_STATUSES, STATUS_CANCELED, STATUS_READY, ExportJob
from common.views import ApiBaseView, AuthenticatedOwnerAccess

GONE_MESSAGE = 'This export is no longer available.'
_ZIP_CONTENT_TYPE = 'application/zip'


def _describe(job):
    return {
        'id': str(job.pk),
        'playlist_id': job.playlist.playlist_id,
        'status': job.status,
        'tracks_done': job.tracks_done,
        'tracks_total': job.tracks_total,
        'file_bytes': job.file_bytes,
        'summary': job.summary,
        'error': job.error_message,
        'expires_at': job.expires_at,
    }


def _is_collectable(job):
    return job.status == STATUS_READY and job.expires_at and job.expires_at > timezone.now()


class ExportJobListView(ApiBaseView):
    permission_classes = [AuthenticatedOwnerAccess]

    def get(self, request):
        """This account's exports still of interest, newest first, optionally for one playlist."""
        jobs = ExportJob.objects.filter(owner=request.user).select_related('playlist').filter(
            Q(status__in=ACTIVE_STATUSES) | Q(status=STATUS_READY, expires_at__gt=timezone.now())
        )
        playlist_id = request.query_params.get('playlist')
        if playlist_id:
            jobs = jobs.filter(playlist__playlist_id=playlist_id)
        return Response({'data': [_describe(job) for job in jobs]})


class ExportJobDetailView(ApiBaseView):
    permission_classes = [AuthenticatedOwnerAccess]

    def get(self, request, job_id):
        job = get_object_or_404(ExportJob.objects.select_related('playlist'), pk=job_id, owner=request.user)
        return Response(_describe(job))

    def delete(self, request, job_id):
        """Stop a job or discard its result. The worker notices between tracks."""
        job = get_object_or_404(ExportJob, pk=job_id, owner=request.user)
        was_ready = job.status == STATUS_READY
        ExportJob.objects.filter(pk=job.pk, status__in=(*ACTIVE_STATUSES, STATUS_READY)).update(status=STATUS_CANCELED)
        if was_ready and job.scratch_dir:
            remove_scratch_dir(job.scratch_dir)
            ExportJob.objects.filter(pk=job.pk).update(scratch_dir='')
        return Response(status=status.HTTP_204_NO_CONTENT)


class ExportJobDownloadView(ApiBaseView):
    permission_classes = [AuthenticatedOwnerAccess]

    def get(self, request, job_id):
        job = get_object_or_404(ExportJob, pk=job_id, owner=request.user)
        if not _is_collectable(job):
            return Response({'error': GONE_MESSAGE}, status=status.HTTP_410_GONE)
        return FileResponse(
            open(f'{job.scratch_dir}/{job.file_name}', 'rb'),
            as_attachment=True,
            filename=job.file_name,
            content_type=_ZIP_CONTENT_TYPE,
        )


