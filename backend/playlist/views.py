"""Playlist API views"""

import logging
from django.shortcuts import get_object_or_404
from django.db import transaction
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
        playlists = self.filter_owned(Playlist.objects.all())
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
        """Delete playlist and all associated audio files"""
        playlist = get_object_or_404(Playlist, playlist_id=playlist_id, owner=request.user)
        playlist_title = playlist.title

        # Delete all audio entries linked to this playlist. Audio.delete() also removes
        # local files from disk, and dependent playlist items are removed via cascade.
        audio_files = Audio.objects.filter(
            owner=request.user,
            playlist_items__playlist=playlist,
        ).distinct()

        deleted_audio_count = 0
        with transaction.atomic():
            for audio in audio_files.iterator():
                audio.delete()
                deleted_audio_count += 1

            playlist.delete()

        return Response({
            'message': (
                f'Playlist "{playlist_title}" deleted successfully. '
                f'Removed {deleted_audio_count} audio files.'
            )
        }, status=status.HTTP_200_OK)


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


# Maximum tracks a single synchronous playlist export will process. Each track is one
# in-request ffmpeg pass, so the cap bounds how long one export can occupy a worker.
MAX_EXPORT_TRACKS = 50

# One in-flight export per user at a time (best-effort cache lock); the timeout is a
# safety release in case a worker dies mid-export.
_EXPORT_LOCK_TIMEOUT_SECONDS = 900

_ZIP_CONTENT_TYPE = 'application/zip'


def _unique_zip_arcname(audio, target_format, used_names):
    """Build a collision-free, path-safe archive name for a track."""
    from audio.export import sanitize_export_filename
    base = sanitize_export_filename(audio.title, f"audio_{audio.youtube_id or audio.id}")
    arcname = f"{base}.{target_format}"
    index = 2
    while arcname in used_names:
        arcname = f"{base} ({index}).{target_format}"
        index += 1
    used_names.add(arcname)
    return arcname


class PlaylistExportView(ApiBaseView):
    """Export all downloaded tracks in a playlist as a single ZIP (F13)."""
    permission_classes = [AdminWriteOnly]

    def post(self, request, playlist_id):
        """Convert each downloaded track to the requested format and stream a ZIP."""
        import shutil
        import tempfile
        import zipfile
        from pathlib import Path
        from django.core.cache import cache
        from django.http import FileResponse
        from audio.export import (
            export_track_to_file,
            sanitize_export_filename,
            AudioConversionError,
            ExportSourceUnavailable,
            SUPPORTED_EXPORT_FORMATS,
        )

        playlist = get_object_or_404(Playlist, playlist_id=playlist_id, owner=request.user)

        target_format = str(request.data.get('format', 'mp3')).lower()
        quality = request.data.get('quality', 'high')
        embed_lyrics = request.data.get('embed_lyrics', True)
        embed_artwork = request.data.get('embed_artwork', True)

        if target_format not in SUPPORTED_EXPORT_FORMATS:
            return Response(
                {'error': 'Invalid format. Supported: mp3, flac'},
                status=status.HTTP_400_BAD_REQUEST
            )

        items = (
            PlaylistItem.objects
            .filter(playlist=playlist)
            .select_related('audio')
            .order_by('position')
        )
        exportable = [item.audio for item in items if item.audio and item.audio.file_path]

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

        # Best-effort guard: one synchronous export per user at a time, so a single user
        # cannot tie up multiple workers with concurrent multi-track ffmpeg runs.
        lock_key = f'playlist_export_lock:{request.user.id}'
        if not cache.add(lock_key, True, timeout=_EXPORT_LOCK_TIMEOUT_SECONDS):
            return Response(
                {'error': 'An export is already in progress. Please wait for it to finish.'},
                status=status.HTTP_429_TOO_MANY_REQUESTS
            )

        temp_dir = tempfile.mkdtemp()
        try:
            work_dir = Path(temp_dir) / 'tracks'
            work_dir.mkdir()
            zip_base = sanitize_export_filename(playlist.title, playlist.playlist_id)
            zip_path = Path(temp_dir) / f"{zip_base}.zip"

            used_names = set()
            exported_count = 0
            with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_STORED) as archive:
                for audio in exportable:
                    arcname = _unique_zip_arcname(audio, target_format, used_names)
                    try:
                        written = export_track_to_file(
                            audio,
                            target_format,
                            quality,
                            work_dir,
                            embed_lyrics=embed_lyrics,
                            embed_artwork=embed_artwork,
                            filename=arcname,
                        )
                    except (AudioConversionError, ExportSourceUnavailable) as exc:
                        logger.warning("[PlaylistExport] Skipping '%s': %s", audio.title, exc)
                        continue
                    archive.write(written, arcname=arcname)
                    written.unlink(missing_ok=True)  # free disk as the ZIP grows
                    exported_count += 1

            if exported_count == 0:
                return Response(
                    {'error': 'No tracks could be exported'},
                    status=status.HTTP_422_UNPROCESSABLE_ENTITY
                )

            zip_handle = open(zip_path, 'rb')
            response = FileResponse(
                zip_handle,
                as_attachment=True,
                filename=f"{zip_base}.zip",
                content_type=_ZIP_CONTENT_TYPE,
            )
            return response
        finally:
            # Runs on every path (success, 422, error). On success the ZIP fd is already
            # open, so removing the temp dir is safe — the inode stays alive on Linux
            # until the response finishes streaming.
            shutil.rmtree(temp_dir, ignore_errors=True)
            cache.delete(lock_key)
