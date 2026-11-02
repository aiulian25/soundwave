"""Views for cross-device playback sync"""

from rest_framework.response import Response
from rest_framework import status
from common.views import ApiBaseView
from audio.models_playback_sync import PlaybackSession
from audio.models import Audio
from audio.serializers import AudioSerializer
from user.models import UserConfig
from audio.serializers_playback_sync import (
    PlaybackSessionSerializer,
    PlaybackSyncUpdateSerializer,
)


class PlaybackSyncView(ApiBaseView):
    """
    API endpoint for cross-device playback synchronization.
    
    GET: Retrieve the user's last playback session
    POST: Update/save the current playback state
    DELETE: Clear the playback session

    One session per user, and the last write wins: devices do not merge, and resuming
    elsewhere simply takes over when that device next writes.
    """
    
    def get(self, request):
        """
        Get the user's current playback session.
        
        Returns:
            - 200: Session data with audio details
            - 404: No active session found
        """
        try:
            session = PlaybackSession.objects.get(user=request.user)
            
            # Check if the track still exists in user's library
            audio_exists = Audio.objects.filter(
                youtube_id=session.youtube_id,
                owner=request.user
            ).exists()
            
            if not audio_exists:
                # Track was deleted, clear the session
                session.delete()
                return Response(
                    {'message': 'No active playback session'},
                    status=status.HTTP_404_NOT_FOUND
                )
            
            serializer = PlaybackSessionSerializer(session)
            return Response({
                'session': serializer.data,
                'has_session': True,
            })
            
        except PlaybackSession.DoesNotExist:
            return Response(
                {'message': 'No active playback session', 'has_session': False},
                status=status.HTTP_404_NOT_FOUND
            )
    
    def post(self, request):
        """
        Update the user's playback session.
        
        This is called periodically (every 10-15 seconds) to sync playback state.
        Only syncs if playing or if explicitly saving position.
        """
        try:
            serializer = PlaybackSyncUpdateSerializer(data=request.data)
            if not serializer.is_valid():
                return Response(
                    {'error': 'Invalid data', 'details': serializer.errors},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            data = serializer.validated_data
            
            # A tab still open from before the owner opted out must not keep writing.
            opted_out = UserConfig.objects.filter(user=request.user, playback_sync_enabled=False).exists()
            if opted_out:
                return Response(
                    {'error': 'Playback sync is disabled'},
                    status=status.HTTP_409_CONFLICT
                )
            
            # Skip sync if no youtube_id (can happen at track end)
            if not data.get('youtube_id'):
                return Response({'message': 'No track to sync'})
            
            # Verify the track exists in user's library
            if not Audio.objects.filter(
                youtube_id=data['youtube_id'],
                owner=request.user
            ).exists():
                return Response(
                    {'error': 'Track not found in library'},
                    status=status.HTTP_404_NOT_FOUND
                )
            
            # Update or create the session
            session, created = PlaybackSession.objects.update_or_create(
                user=request.user,
                defaults={
                    'youtube_id': data['youtube_id'],
                    'position': data['position'],
                    'duration': data.get('duration', 0),
                    'is_playing': data.get('is_playing', False),
                    'volume': data.get('volume', 100),
                    'queue_youtube_ids': data.get('queue_youtube_ids', []),
                    'queue_index': data.get('queue_index', 0),
                    'device_id': data.get('device_id', ''),
                    'device_name': data.get('device_name', ''),
                }
            )
            
            return Response({
                'message': 'Playback session synced',
                'created': created,
                'updated_at': session.updated_at,
            })
        except Exception as e:
            import logging
            logger = logging.getLogger(__name__)
            logger.error(f'Playback sync error: {e}', exc_info=True)
            return Response(
                {'error': 'Sync failed'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
    
    def delete(self, request):
        """
        Clear the user's playback session.
        
        Called when user explicitly stops playback or clears history.
        """
        deleted, _ = PlaybackSession.objects.filter(user=request.user).delete()
        
        return Response({
            'message': 'Playback session cleared' if deleted else 'No session to clear',
            'deleted': deleted > 0,
        })


class PlaybackSyncQueueView(ApiBaseView):
    """The saved queue as tracks, for resuming on another device."""

    def get(self, request):
        session = PlaybackSession.objects.filter(user=request.user).first()
        if session is None:
            return Response(
                {'message': 'No active playback session'},
                status=status.HTTP_404_NOT_FOUND
            )

        saved_ids = session.queue_youtube_ids
        tracks_by_id = {
            audio.youtube_id: audio
            for audio in Audio.objects.filter(owner=request.user, youtube_id__in=set(saved_ids))
        }
        positions_kept = [position for position, youtube_id in enumerate(saved_ids) if youtube_id in tracks_by_id]
        tracks = [tracks_by_id[saved_ids[position]] for position in positions_kept]

        return Response({
            'data': AudioSerializer(tracks, many=True).data,
            'index': self._current_index(session, positions_kept),
            'missing': len(saved_ids) - len(positions_kept),
        })

    @staticmethod
    def _current_index(session, positions_kept):
        """Where the current track landed, or None if the queue does not contain it."""
        saved_ids = session.queue_youtube_ids
        is_at_saved_place = session.queue_index in positions_kept and saved_ids[session.queue_index] == session.youtube_id
        if is_at_saved_place:
            return positions_kept.index(session.queue_index)
        for index, position in enumerate(positions_kept):
            if saved_ids[position] == session.youtube_id:
                return index
        return None


class PlaybackSyncStatusView(ApiBaseView):
    """
    Quick check if user has an active playback session.
    Lightweight endpoint for initial app load.
    """
    
    def get(self, request):
        """Check if user has an active playback session"""
        try:
            session = PlaybackSession.objects.get(user=request.user)
            
            # Verify track still exists
            audio_exists = Audio.objects.filter(
                youtube_id=session.youtube_id,
                owner=request.user
            ).exists()
            
            if not audio_exists:
                session.delete()
                return Response({'has_session': False})
            
            return Response({
                'has_session': True,
                'youtube_id': session.youtube_id,
                'position': session.position,
                'seconds_since_update': session.seconds_since_update,
            })
            
        except PlaybackSession.DoesNotExist:
            return Response({'has_session': False})
