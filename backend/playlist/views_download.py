"""Views for playlist downloads"""

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.shortcuts import get_object_or_404

from playlist.models import Playlist
from playlist.models_download import PlaylistDownload, PlaylistDownloadItem
from playlist.serializers_download import (
    PlaylistDownloadSerializer,
    PlaylistDownloadCreateSerializer,
    PlaylistDownloadItemSerializer,
)
from playlist.tasks_download import (
    download_playlist_task,
    pause_playlist_download,
    resume_playlist_download,
    cancel_playlist_download,
    retry_failed_items,
)
from common.permissions import IsOwnerOrAdmin


class PlaylistDownloadViewSet(viewsets.ModelViewSet):
    """ViewSet for managing playlist downloads"""
    permission_classes = [IsAuthenticated, IsOwnerOrAdmin]
    
    def get_serializer_class(self):
        if self.action == 'create':
            return PlaylistDownloadCreateSerializer
        return PlaylistDownloadSerializer
    
    def get_queryset(self):
        """Filter by user"""
        queryset = PlaylistDownload.objects.select_related(
            'playlist', 'user'
        ).prefetch_related('items')
        
        # Regular users see only their downloads
        if not (self.request.user.is_admin or self.request.user.is_superuser):
            queryset = queryset.filter(user=self.request.user)
        
        # Filter by status
        status_filter = self.request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        
        # Filter by playlist
        playlist_id = self.request.query_params.get('playlist_id')
        if playlist_id:
            queryset = queryset.filter(playlist_id=playlist_id)
        
        return queryset.order_by('-created_at')
    
    def perform_create(self, serializer):
        """Create download and trigger task"""
        download = serializer.save(user=self.request.user)
        
        # Trigger download task
        download_playlist_task.apply_async(args=[download.id])
        
        return download
    
    @action(detail=True, methods=['post'])
    def pause(self, request, pk=None):
        """Pause playlist download"""
        download = self.get_object()
        
        if download.status != 'downloading':
            return Response(
                {'error': 'Can only pause downloading playlists'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        result = pause_playlist_download.apply_async(args=[download.id])
        
        return Response({
            'message': 'Playlist download paused',
            'task_id': result.id
        })
    
    @action(detail=True, methods=['post'])
    def resume(self, request, pk=None):
        """Resume paused playlist download"""
        download = self.get_object()
        
        if not download.can_resume:
            return Response(
                {'error': 'Download cannot be resumed'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        result = resume_playlist_download.apply_async(args=[download.id])
        
        return Response({
            'message': 'Playlist download resumed',
            'task_id': result.id
        })
    
    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        """Cancel playlist download"""
        download = self.get_object()
        
        if download.status in ['completed', 'failed']:
            return Response(
                {'error': 'Cannot cancel completed or failed download'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        result = cancel_playlist_download.apply_async(args=[download.id])
        
        return Response({
            'message': 'Playlist download cancelled',
            'task_id': result.id
        })
    
    @action(detail=True, methods=['post'])
    def retry_failed(self, request, pk=None):
        """Retry failed items"""
        download = self.get_object()
        
        if download.failed_items == 0:
            return Response(
                {'error': 'No failed items to retry'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        result = retry_failed_items.apply_async(args=[download.id])
        
        return Response({
            'message': f'Retrying {download.failed_items} failed items',
            'task_id': result.id
        })
    
    @action(detail=True, methods=['get'])
    def items(self, request, pk=None):
        """Get download items with status"""
        download = self.get_object()
        items = download.items.select_related('audio').order_by('position')
        
        serializer = PlaylistDownloadItemSerializer(items, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def active(self, request):
        """Get active downloads (pending or downloading)"""
        downloads = self.get_queryset().filter(
            status__in=['pending', 'downloading']
        )
        
        serializer = self.get_serializer(downloads, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def completed(self, request):
        """Get completed downloads"""
        downloads = self.get_queryset().filter(status='completed')
        
        serializer = self.get_serializer(downloads, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['post'])
    def download_playlist(self, request):
        """Quick action to download a playlist"""
        playlist_id = request.data.get('playlist_id')
        quality = request.data.get('quality', 'medium')
        
        if not playlist_id:
            return Response(
                {'error': 'playlist_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Get playlist
        playlist = get_object_or_404(Playlist, id=playlist_id, owner=request.user)
        
        # Check if already downloading
        existing = PlaylistDownload.objects.filter(
            playlist=playlist,
            user=request.user,
            status__in=['pending', 'downloading']
        ).first()
        
        if existing:
            return Response(
                {
                    'error': 'Playlist is already being downloaded',
                    'download': PlaylistDownloadSerializer(existing).data
                },
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Create download
        download = PlaylistDownload.objects.create(
            playlist=playlist,
            user=request.user,
            quality=quality
        )
        
        # Trigger task
        download_playlist_task.apply_async(args=[download.id])
        
        serializer = PlaylistDownloadSerializer(download)
        return Response(serializer.data, status=status.HTTP_201_CREATED)
