"""Playlist API views"""

import logging
from django.shortcuts import get_object_or_404
from django.db import transaction
from django.db.models import Max
from rest_framework import status
from rest_framework.response import Response
from playlist.models import Playlist, PlaylistItem
from playlist.serializers import PlaylistSerializer, PlaylistItemSerializer, PlaylistTrackSerializer
from common.pagination import paginated_response
from common.search import matching, search_term
from common.views import ApiBaseView, AuthenticatedOwnerAccess
from audio.artwork_archive import PLAYLIST
from audio.models import Audio
from audio.views import kept_artwork_response
from download.claims import cancel_unfinished_downloads

logger = logging.getLogger(__name__)


PLAYLIST_SEARCH_FIELDS = ('title', 'channel_name')
# This list has no pages, so a search bounds it instead.
PLAYLIST_SEARCH_LIMIT = 50


# What `include_items=true` on the playlist itself still returns. Items are paged at
# `<playlist>/items/`; this keeps an app that was loaded before that change from showing nothing.
LEGACY_INCLUDED_ITEMS_LIMIT = 100


def _ordered_items(playlist):
    """`id` breaks ties, so two items sharing a position cannot swap between pages."""
    return PlaylistItem.objects.filter(playlist=playlist).select_related('audio').order_by('position', 'id')


class PlaylistListView(ApiBaseView):
    """Playlist list endpoint"""
    permission_classes = [AuthenticatedOwnerAccess]

    def get(self, request):
        """Get playlist list"""
        playlists = self.filter_owned(Playlist.objects.all())
        term = search_term(request)
        if term:
            playlists = matching(playlists, term, PLAYLIST_SEARCH_FIELDS)[:PLAYLIST_SEARCH_LIMIT]
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
        with transaction.atomic():
            account = type(request.user).objects.select_for_update().get(pk=request.user.pk)
            if not account.can_add_playlist:
                return Response(
                    {'error': f'Playlist limit reached. Maximum {account.max_playlists} playlists allowed.'},
                    status=status.HTTP_403_FORBIDDEN
                )
            serializer.save(owner=request.user)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class PlaylistDetailView(ApiBaseView):
    """Playlist detail endpoint"""
    permission_classes = [AuthenticatedOwnerAccess]

    def get(self, request, playlist_id):
        """Get playlist details with items"""
        playlist = get_object_or_404(Playlist, playlist_id=playlist_id, owner=request.user)
        
        # Check if items are requested
        include_items = request.query_params.get('include_items', 'false').lower() == 'true'
        
        serializer = PlaylistSerializer(playlist)
        response_data = serializer.data
        
        if include_items:
            # Only an app version loaded before items were paged still asks for this.
            first_items = _ordered_items(playlist)[:LEGACY_INCLUDED_ITEMS_LIMIT]
            response_data['items'] = PlaylistTrackSerializer(first_items, many=True).data
        
        return Response(response_data)

    def post(self, request, playlist_id):
        """Trigger actions on playlist (e.g., download, force_recheck)"""
        playlist = get_object_or_404(Playlist, playlist_id=playlist_id, owner=request.user)
        action = request.data.get('action')
        
        if action == 'download':
            from task.tasks import download_playlist_task
            download_playlist_task.delay(playlist.id)
            return Response({'detail': 'Download task started'}, status=status.HTTP_202_ACCEPTED)
        
        if action == 'force_recheck':
            from task.tasks import download_playlist_task
            download_playlist_task.delay(playlist.id, force=True)
            return Response({'detail': 'Force recheck task started'}, status=status.HTTP_202_ACCEPTED)
        
        return Response({'detail': 'Invalid action'}, status=status.HTTP_400_BAD_REQUEST)

    def delete(self, request, playlist_id):
        """Delete the playlist and its memberships and cancel unfinished work; its tracks stay in the library"""
        playlist = get_object_or_404(Playlist, playlist_id=playlist_id, owner=request.user)
        playlist_title = playlist.title
        cancel_unfinished_downloads(request.user, source_playlist_id=playlist.playlist_id)
        playlist.delete()

        return Response({
            'message': f'Playlist "{playlist_title}" deleted successfully. Its tracks were kept.'
        }, status=status.HTTP_200_OK)


class PlaylistArtworkView(ApiBaseView):
    """A playlist's cover, served from this server"""
    permission_classes = [AuthenticatedOwnerAccess]

    def get(self, request, playlist_id):
        playlist = get_object_or_404(Playlist, playlist_id=playlist_id, owner=request.user)
        return kept_artwork_response(PLAYLIST, playlist)


class PlaylistItemsView(ApiBaseView):
    """Manage items in a playlist"""
    
    def get(self, request, playlist_id):
        """One page of the playlist's tracks, in playlist order"""
        playlist = get_object_or_404(Playlist, playlist_id=playlist_id, owner=request.user)
        return paginated_response(request, _ordered_items(playlist), PlaylistTrackSerializer)
    
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
            
            playlist.refresh_local_counts()
            
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
        
        playlist.refresh_local_counts()
        
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
                    'thumbnail_url': item.playlist.artwork_url,
                    'item_count': item.playlist.item_count,
                    'position': item.position,
                })
            
            return Response({'data': playlists})
        except Exception as e:
            logger.exception(f"Error finding playlists for track {youtube_id}: {str(e)}")
            return Response({'error': 'Failed to find playlists for track'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# Maximum tracks a single synchronous playlist export will process. Each track is one
# in-request ffmpeg pass, so the cap bounds how long one export can occupy a worker.
MAX_EXPORT_TRACKS = 50

# One in-flight export per user at a time (best-effort cache lock); the timeout is a
# safety release in case a worker dies mid-export.
_EXPORT_LOCK_TIMEOUT_SECONDS = 900

_ZIP_CONTENT_TYPE = 'application/zip'
_OMITTED_COUNT_HEADER = 'X-Export-Omitted'
_WARNED_COUNT_HEADER = 'X-Export-Warned'


class PlaylistExportView(ApiBaseView):
    """Export all downloaded tracks in a playlist as a single ZIP (F13)."""
    permission_classes = [AuthenticatedOwnerAccess]

    def post(self, request, playlist_id):
        """Convert each downloaded track to the requested format and stream a ZIP."""
        from django.conf import settings
        from django.core.cache import cache
        from audio.export import exportable_playlist_tracks, sanitize_export_filename, write_playlist_zip
        from audio.export_limits import (
            ExportRefused,
            ScratchFileResponse,
            estimated_export_bytes,
            new_scratch_dir,
            refuse_if_no_room,
            release_slot,
            remove_scratch_dir,
            take_sync_slot,
        )
        from audio.models_export import ACTIVE_STATUSES, ExportJob
        from audio.serializers import EXPORT_OPTIONS_ERROR, ExportOptionsSerializer
        from audio.tasks import build_playlist_export

        playlist = get_object_or_404(Playlist, playlist_id=playlist_id, owner=request.user)

        options = ExportOptionsSerializer(data=request.data)
        if not options.is_valid():
            return Response({'error': EXPORT_OPTIONS_ERROR}, status=status.HTTP_400_BAD_REQUEST)
        target_format = options.validated_data['format']

        exportable = exportable_playlist_tracks(playlist)

        if not exportable:
            return Response(
                {'error': 'Playlist has no downloaded tracks to export'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if len(exportable) > MAX_EXPORT_TRACKS:
            return Response(
                {'error': f'Playlist too large to export ({len(exportable)} tracks; limit is {MAX_EXPORT_TRACKS}).'},
                status=status.HTTP_400_BAD_REQUEST
            )

        estimated_bytes = estimated_export_bytes(exportable, options.validated_data['format'], options.validated_data['quality'])
        try:
            refuse_if_no_room(estimated_bytes)
        except ExportRefused as refused:
            return Response({'error': refused.message}, status=refused.status)

        busy_message = 'An export is already in progress. Please wait for it to finish.'
        if ExportJob.objects.filter(owner=request.user, status__in=ACTIVE_STATUSES).exists():
            return Response({'error': busy_message}, status=status.HTTP_429_TOO_MANY_REQUESTS)

        if estimated_bytes > settings.EXPORT_SYNC_MAX_BYTES:
            job = ExportJob.objects.create(
                owner=request.user,
                playlist=playlist,
                options=options.validated_data,
                tracks_total=len(exportable),
            )
            transaction.on_commit(lambda: build_playlist_export.delay(str(job.pk)))
            return Response({'job_id': str(job.pk), 'status': job.status}, status=status.HTTP_202_ACCEPTED)

        # Best-effort guard: one synchronous export per user at a time, so a single user
        # cannot tie up multiple workers with concurrent multi-track ffmpeg runs.
        lock_key = f'playlist_export_lock:{request.user.id}'
        if not cache.add(lock_key, True, timeout=_EXPORT_LOCK_TIMEOUT_SECONDS):
            return Response({'error': busy_message}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        try:
            slot = take_sync_slot()
        except ExportRefused as refused:
            cache.delete(lock_key)
            return Response({'error': refused.message}, status=refused.status)

        scratch = new_scratch_dir()

        def tidy_up():
            remove_scratch_dir(scratch)
            release_slot(slot)
            cache.delete(lock_key)

        try:
            outcome = write_playlist_zip(
                exportable,
                options.validated_data,
                scratch,
                sanitize_export_filename(playlist.title, playlist.playlist_id),
            )
        except Exception:
            tidy_up()
            raise

        if outcome.exported_count == 0:
            tidy_up()
            return Response(
                {'error': 'No tracks could be exported'},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY
            )

        response = ScratchFileResponse(
            open(outcome.path, 'rb'),
            as_attachment=True,
            filename=outcome.path.name,
            content_type=_ZIP_CONTENT_TYPE,
            cleanup=tidy_up,
        )
        response[_OMITTED_COUNT_HEADER] = str(len(outcome.omitted))
        response[_WARNED_COUNT_HEADER] = str(len(outcome.warnings))
        return response
