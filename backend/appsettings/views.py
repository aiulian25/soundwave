"""App settings API views"""

from django.conf import settings
from rest_framework.response import Response
from appsettings.serializers import AppConfigSerializer
from common.views import ApiBaseView, AdminOnly


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
    """Backup management endpoint"""
    permission_classes = [AdminOnly]

    def get(self, request):
        """Get list of backups"""
        # TODO: Implement backup listing
        return Response({'backups': []})

    def post(self, request):
        """Create backup"""
        # TODO: Implement backup creation
        return Response({'message': 'Backup created'})
