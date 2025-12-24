"""Views for Quick Sync adaptive streaming"""
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework import status
from django.core.cache import cache

from audio.quick_sync_service import QuickSyncService


class QuickSyncStatusView(APIView):
    """Get Quick Sync status and recommendations"""
    
    permission_classes = [IsAuthenticated]
    
    def get(self, request):
        """Get current quick sync status"""
        service = QuickSyncService()
        user_prefs = service.get_user_preferences(request.user.id)
        sync_status = service.get_quick_sync_status(user_prefs)
        
        return Response({
            'status': sync_status,
            'preferences': user_prefs,
        })


class QuickSyncPreferencesView(APIView):
    """Manage Quick Sync user preferences"""
    
    permission_classes = [IsAuthenticated]
    
    def get(self, request):
        """Get user's quick sync preferences"""
        service = QuickSyncService()
        prefs = service.get_user_preferences(request.user.id)
        
        return Response(prefs)
    
    def post(self, request):
        """Update user's quick sync preferences"""
        service = QuickSyncService()
        
        preferences = {
            'mode': request.data.get('mode', 'auto'),
            'prefer_quality': request.data.get('prefer_quality', True),
            'adapt_to_system': request.data.get('adapt_to_system', True),
            'auto_download_quality': request.data.get('auto_download_quality', False),
        }
        
        success = service.update_user_preferences(request.user.id, preferences)
        
        if success:
            # Get updated status
            sync_status = service.get_quick_sync_status(preferences)
            return Response({
                'message': 'Quick Sync preferences updated',
                'preferences': preferences,
                'status': sync_status,
            })
        else:
            return Response(
                {'error': 'Failed to update preferences'},
                status=status.HTTP_400_BAD_REQUEST
            )


class QuickSyncTestView(APIView):
    """Test network speed for Quick Sync"""
    
    permission_classes = [IsAuthenticated]
    
    def post(self, request):
        """Run network speed test"""
        service = QuickSyncService()
        
        # Clear cache to force new test
        cache.delete('quick_sync_network_speed')
        
        speed = service.measure_network_speed()
        system_resources = service.get_system_resources()
        
        return Response({
            'network_speed_mbps': speed,
            'system_resources': system_resources,
            'recommended_quality': service.get_recommended_quality()[0],
            'timestamp': system_resources['timestamp'],
        })


class QuickSyncQualityPresetsView(APIView):
    """Get available quality presets"""
    
    permission_classes = [IsAuthenticated]
    
    def get(self, request):
        """Get all quality presets"""
        service = QuickSyncService()
        
        return Response({
            'presets': service.QUALITY_PRESETS,
            'thresholds': service.SPEED_THRESHOLDS,
        })
