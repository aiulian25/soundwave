"""App settings API views"""

from django.conf import settings
from rest_framework.response import Response
from appsettings.serializers import AppConfigSerializer
from appsettings import backup as backup_service
from common.views import ApiBaseView, AdminWriteOnly


class AppConfigView(ApiBaseView):
    """Application configuration endpoint"""

    def get(self, request):
        """Get app configuration"""
        config = {
            'app_name': 'SoundWave',
            'version': '1.0.0',
            'sw_host': settings.SW_HOST,
            'audio_quality': 'best',
            'auto_update_ytdlp': settings.SW_AUTO_UPDATE_YTDLP,
        }
        serializer = AppConfigSerializer(config)
        return Response(serializer.data)


class BackupView(ApiBaseView):
    """Per-user library backup (F14). GET a manifest, POST to build the backup JSON."""
    permission_classes = [AdminWriteOnly]

    def get(self, request):
        """Return current-library counts (there is no server-side backup store)."""
        return Response({'library': backup_service.library_counts(request.user)})

    def post(self, request):
        """Build and return the full library backup JSON for the requesting user."""
        return Response(backup_service.build_backup(request.user))


class RestoreView(ApiBaseView):
    """Restore a library backup for the requesting user (owner-scoped, idempotent)."""
    permission_classes = [AdminWriteOnly]

    def post(self, request):
        """Apply the backup, or preview it when ?dry_run=1 (counts only, no writes)."""
        dry_run = request.query_params.get('dry_run') in ('1', 'true', 'True')
        try:
            summary = backup_service.restore_backup(request, request.data, dry_run=dry_run)
        except backup_service.BackupValidationError as exc:
            return Response({'error': exc.message}, status=exc.status_code)
        return Response({'dry_run': dry_run, 'summary': summary})
