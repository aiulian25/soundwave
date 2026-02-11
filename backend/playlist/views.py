"""Playlist API views"""

import logging
from django.shortcuts import get_object_or_404
from django.db.models import Max
from rest_framework import status
from rest_framework.response import Response
from playlist.models import Playlist, PlaylistItem
from playlist.serializers import PlaylistSerializer, PlaylistItemSerializer
from common.views import ApiBaseView, AdminWriteOnly
from audio.models import Audio

logger = logging.getLogger(__name__)


class PlaylistListView(ApiBaseView):
    """Playlist list endpoint"""
    permission_classes = [AdminWriteOnly]

    def get(self, request):
        """Get playlist list"""
        playlists = Playlist.objects.filter(owner=request.user)
        serializer = PlaylistSerializer(playlists, many=True)
        return Response({'data': serializer.data})

    def post(self, request):
        """Subscribe to playlist - TubeArchivist pattern with Celery task"""
        from playlist.serializers import PlaylistSubscribeSerializer
        import uuid
        
        # Check playlist quota
        if not request.user.can_add_playlist:
            return Response(
                {'error': f'Playlist limit reached. Maximum {request.user.max_playlists} playlists allowed.'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        # Check if it's a URL subscription
        if 'url' in request.data:
            url_serializer = PlaylistSubscribeSerializer(data=request.data)
            url_serializer.is_valid(raise_exception=True)
            playlist_url = request.data['url']
            
            # Trigger async Celery task (TubeArchivist pattern)
            from task.tasks import subscribe_to_playlist
            task = subscribe_to_playlist.delay(request.user.id, playlist_url)
            
            return Response(
                {
                    'message': 'Playlist subscription task started',
                    'task_id': str(task.id)
                },
                status=status.HTTP_202_ACCEPTED
            )
        
        # Otherwise create custom playlist
        # Auto-generate required fields for custom playlists
        data = request.data.copy()
        if 'playlist_id' not in data:
            data['playlist_id'] = f'custom-{uuid.uuid4().hex[:12]}'
        if 'title' not in data and 'name' in data:
            data['title'] = data['name']
        if 'playlist_type' not in data:
            data['playlist_type'] = 'custom'
            
        serializer = PlaylistSerializer(data=data)
        serializer.is_valid(raise_exception=True)
        serializer.save(owner=request.user)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class PlaylistDetailView(ApiBaseView):
    """Playlist detail endpoint"""
    permission_classes = [AdminWriteOnly]

    def get(self, request, playlist_id):
        """Get playlist details with items"""
        playlist = get_object_or_404(Playlist, playlist_id=playlist_id, owner=request.user)
        
        # Check if items are requested
        include_items = request.query_params.get('include_items', 'false').lower() == 'true'
        
        serializer = PlaylistSerializer(playlist)
        response_data = serializer.data
        
        if include_items:
            # Get all playlist items with audio details
            items = PlaylistItem.objects.filter(playlist=playlist).select_related('audio').order_by('position')
            from audio.serializers import AudioSerializer
            response_data['items'] = [{
                'id': item.id,
                'position': item.position,
                'added_date': item.added_date,
                'audio': AudioSerializer(item.audio).data
            } for item in items]
        
        return Response(response_data)

    def post(self, request, playlist_id):
        """Trigger actions on playlist (e.g., download)"""
        playlist = get_object_or_404(Playlist, playlist_id=playlist_id, owner=request.user)
        action = request.data.get('action')
        
        if action == 'download':
            from task.tasks import download_playlist_task
            download_playlist_task.delay(playlist.id)
            return Response({'detail': 'Download task started'}, status=status.HTTP_202_ACCEPTED)
        
        return Response({'detail': 'Invalid action'}, status=status.HTTP_400_BAD_REQUEST)

    def delete(self, request, playlist_id):
        """Delete playlist"""
        playlist = get_object_or_404(Playlist, playlist_id=playlist_id, owner=request.user)
        playlist.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class PlaylistItemsView(ApiBaseView):
    """Manage items in a playlist"""
    
    def get(self, request, playlist_id):
        """Get all items in a playlist"""
        playlist = get_object_or_404(Playlist, playlist_id=playlist_id, owner=request.user)
        items = PlaylistItem.objects.filter(playlist=playlist).select_related('audio').order_by('position')
        from audio.serializers import AudioSerializer
        response_data = [{
            'id': item.id,
            'position': item.position,
            'added_date': item.added_date,
            'audio': AudioSerializer(item.audio).data
        } for item in items]
        return Response({'data': response_data})
    
    def post(self, request, playlist_id):
        """Add a track to a playlist"""
        try:
            playlist = get_object_or_404(Playlist, playlist_id=playlist_id, owner=request.user)
            
            youtube_id = request.data.get('youtube_id')
            if not youtube_id:
                return Response({'error': 'youtube_id is required'}, status=status.HTTP_400_BAD_REQUEST)
            
            # Get the audio track
            audio = get_object_or_404(Audio, youtube_id=youtube_id, owner=request.user)
            
            # Check if already in playlist
            if PlaylistItem.objects.filter(playlist=playlist, audio=audio).exists():
                return Response({'error': 'Track already in playlist'}, status=status.HTTP_400_BAD_REQUEST)
            
            # Get next position
            max_position = PlaylistItem.objects.filter(playlist=playlist).aggregate(Max('position'))['position__max']
            next_position = (max_position or 0) + 1
            
            # Add to playlist
            item = PlaylistItem.objects.create(
                playlist=playlist,
                audio=audio,
                position=next_position
            )
            
            # Update playlist item count
            playlist.item_count = PlaylistItem.objects.filter(playlist=playlist).count()
            playlist.downloaded_count = PlaylistItem.objects.filter(playlist=playlist, audio__file_path__isnull=False).exclude(audio__file_path='').count()
            playlist.save(update_fields=['item_count', 'downloaded_count'])
            
            from audio.serializers import AudioSerializer
            return Response({
                'id': item.id,
                'position': item.position,
                'added_date': item.added_date,
                'audio': AudioSerializer(item.audio).data
            }, status=status.HTTP_201_CREATED)
        except Exception as e:
            logger.exception(f"Error adding track to playlist {playlist_id}: {str(e)}")
            return Response({'error': 'Failed to add track to playlist'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    
    def delete(self, request, playlist_id):
        """Remove a track from a playlist"""
        playlist = get_object_or_404(Playlist, playlist_id=playlist_id, owner=request.user)
        
        youtube_id = request.data.get('youtube_id')
        if not youtube_id:
            return Response({'error': 'youtube_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        # Get the audio track
        audio = get_object_or_404(Audio, youtube_id=youtube_id, owner=request.user)
        
        # Remove from playlist
        deleted, _ = PlaylistItem.objects.filter(playlist=playlist, audio=audio).delete()
        
        if deleted == 0:
            return Response({'error': 'Track not in playlist'}, status=status.HTTP_404_NOT_FOUND)
        
        # Update playlist item count
        playlist.item_count = PlaylistItem.objects.filter(playlist=playlist).count()
        playlist.downloaded_count = PlaylistItem.objects.filter(playlist=playlist, audio__file_path__isnull=False).exclude(audio__file_path='').count()
        playlist.save(update_fields=['item_count', 'downloaded_count'])
        
        return Response(status=status.HTTP_204_NO_CONTENT)


class TrackPlaylistsView(ApiBaseView):
    """Find which playlists contain a specific track"""
    
    def get(self, request, youtube_id):
        """Get all playlists that contain a specific track"""
        try:
            # Get the audio track
            audio = get_object_or_404(Audio, youtube_id=youtube_id, owner=request.user)
            
            # Find all playlists containing this track
            playlist_items = PlaylistItem.objects.filter(
                audio=audio,
                playlist__owner=request.user
            ).select_related('playlist')
            
            playlists = []
            for item in playlist_items:
                playlists.append({
                    'id': item.playlist.id,
                    'playlist_id': item.playlist.playlist_id,
                    'title': item.playlist.title,
                    'playlist_type': item.playlist.playlist_type,
                    'thumbnail_url': item.playlist.thumbnail_url,
                    'item_count': item.playlist.item_count,
                    'position': item.position,
                })
            
            return Response({'data': playlists})
        except Exception as e:
            logger.exception(f"Error finding playlists for track {youtube_id}: {str(e)}")
            return Response({'error': 'Failed to find playlists for track'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
