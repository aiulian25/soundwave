"""Audio API views"""

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from audio.models import Audio, AudioProgress
from audio.serializers import (
    AudioListSerializer,
    AudioSerializer,
    AudioProgressUpdateSerializer,
    PlayerSerializer,
)
from common.views import ApiBaseView, AdminWriteOnly


class AudioListView(ApiBaseView):
    """Audio list endpoint
    GET: returns list of audio files
    """

    def get(self, request):
        """Get audio list"""
        # Get query parameters
        channel_id = request.query_params.get('channel')
        playlist_id = request.query_params.get('playlist')
        status_filter = request.query_params.get('status')

        # Base queryset - filter by user
        queryset = Audio.objects.filter(owner=request.user)

        # Apply filters
        if channel_id:
            queryset = queryset.filter(channel_id=channel_id)
        if playlist_id:
            # TODO: Filter by playlist
            pass
        if status_filter:
            # TODO: Filter by play status
            pass

        # Pagination
        page_size = 50
        page = int(request.query_params.get('page', 1))
        start = (page - 1) * page_size
        end = start + page_size

        audio_list = queryset[start:end]
        serializer = AudioSerializer(audio_list, many=True)

        return Response({
            'data': serializer.data,
            'paginate': True
        })


class AudioDetailView(ApiBaseView):
    """Audio detail endpoint
    GET: returns single audio file details
    POST: trigger actions (download)
    DELETE: delete audio file
    """
    permission_classes = [AdminWriteOnly]

    def get(self, request, youtube_id):
        """Get audio details"""
        audio = get_object_or_404(Audio, youtube_id=youtube_id, owner=request.user)
        serializer = AudioSerializer(audio)
        return Response(serializer.data)
    
    def post(self, request, youtube_id):
        """Trigger actions on audio"""
        audio = get_object_or_404(Audio, youtube_id=youtube_id, owner=request.user)
        action = request.data.get('action')
        
        if action == 'download':
            # Check if already downloaded
            if audio.file_path:
                return Response(
                    {'detail': 'Audio already downloaded', 'status': 'already_downloaded'},
                    status=status.HTTP_200_OK
                )
            
            # Add to download queue
            from download.models import DownloadQueue
            from task.tasks import download_audio_task
            
            # Create download queue item
            queue_item, created = DownloadQueue.objects.get_or_create(
                owner=request.user,
                youtube_id=youtube_id,
                defaults={
                    'url': f'https://www.youtube.com/watch?v={youtube_id}',
                    'title': audio.title,
                    'channel_name': audio.channel_name,
                    'auto_start': True,
                }
            )
            
            # Trigger download task
            if created or queue_item.status == 'failed':
                download_audio_task.delay(queue_item.id)
                return Response(
                    {'detail': 'Download started', 'status': 'downloading'},
                    status=status.HTTP_202_ACCEPTED
                )
            else:
                return Response(
                    {'detail': 'Download already in progress', 'status': queue_item.status},
                    status=status.HTTP_200_OK
                )
        
        return Response(
            {'detail': 'Invalid action'},
            status=status.HTTP_400_BAD_REQUEST
        )

    def delete(self, request, youtube_id):
        """Delete audio file"""
        audio = get_object_or_404(Audio, youtube_id=youtube_id, owner=request.user)
        audio.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class AudioPlayerView(ApiBaseView):
    """Audio player endpoint
    GET: returns audio player data with stream URL
    """

    def get(self, request, youtube_id):
        """Get player data"""
        audio = get_object_or_404(Audio, youtube_id=youtube_id, owner=request.user)

        # Trigger lyrics fetch if not already fetched (async, non-blocking)
        try:
            if not hasattr(audio, 'lyrics') or not audio.lyrics.fetch_attempted:
                from audio.tasks_lyrics import fetch_lyrics_for_audio
                fetch_lyrics_for_audio.delay(youtube_id)
        except Exception:
            pass  # Don't block playback if lyrics fetch fails

        # Get user progress
        progress = None
        try:
            progress = AudioProgress.objects.get(user=request.user, audio=audio)
        except AudioProgress.DoesNotExist:
            pass

        # Build stream URL with proper encoding for special characters
        from urllib.parse import quote
        # Encode the file path, preserving forward slashes
        encoded_path = '/'.join(quote(part, safe='') for part in audio.file_path.split('/'))
        stream_url = f"/media/{encoded_path}"

        data = {
            'audio': AudioSerializer(audio).data,
            'stream_url': stream_url
        }
        if progress:
            data['progress'] = {
                'position': progress.position,
                'completed': progress.completed
            }

        return Response(data)


class AudioProgressView(ApiBaseView):
    """Audio progress endpoint
    POST: update playback progress
    """

    def post(self, request, youtube_id):
        """Update audio progress"""
        audio = get_object_or_404(Audio, youtube_id=youtube_id, owner=request.user)

        serializer = AudioProgressUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        progress, created = AudioProgress.objects.get_or_create(
            user=request.user,
            audio=audio,
            defaults={
                'position': serializer.validated_data['position'],
                'completed': serializer.validated_data.get('completed', False)
            }
        )

        if not created:
            progress.position = serializer.validated_data['position']
            progress.completed = serializer.validated_data.get('completed', False)
            progress.save()

        # Update audio play count
        if created or serializer.validated_data.get('completed'):
            audio.play_count += 1
            audio.save()

        return Response({
            'position': progress.position,
            'completed': progress.completed
        })


class AudioDownloadView(ApiBaseView):
    """Audio file download endpoint
    GET: download audio file to user's device
    """

    def get(self, request, youtube_id):
        """Download audio file with security checks"""
        from django.http import FileResponse, Http404
        import os
        from django.conf import settings
        from pathlib import Path
        
        # Security: Verify ownership
        audio = get_object_or_404(Audio, youtube_id=youtube_id, owner=request.user)
        
        if not audio.file_path:
            raise Http404("Audio file not available")
        
        # Security: Prevent path traversal attacks
        file_path = audio.file_path
        if '..' in file_path or file_path.startswith('/') or '\\' in file_path:
            raise Http404("Invalid file path")
        
        # Build and resolve full path
        full_path = Path(settings.MEDIA_ROOT) / file_path
        
        # Security: Verify the resolved path is within MEDIA_ROOT
        try:
            full_path = full_path.resolve()
            media_root = Path(settings.MEDIA_ROOT).resolve()
            full_path.relative_to(media_root)
        except (ValueError, OSError):
            raise Http404("Access denied")
        
        # Verify file exists and is a file (not directory)
        if not full_path.exists() or not full_path.is_file():
            raise Http404("Audio file not found on disk")
        
        # Get file extension and determine content type
        _, ext = os.path.splitext(str(full_path))
        content_type = 'audio/mpeg'  # Default
        if ext.lower() in ['.m4a', '.mp4']:
            content_type = 'audio/mp4'
        elif ext.lower() == '.opus':
            content_type = 'audio/opus'
        elif ext.lower() == '.webm':
            content_type = 'audio/webm'
        
        # Create safe filename for download
        safe_title = "".join(c for c in audio.title if c.isalnum() or c in (' ', '-', '_')).strip()
        if not safe_title:
            safe_title = f"audio_{youtube_id}"
        filename = f"{safe_title}{ext}"
        
        # Serve file with proper headers
        response = FileResponse(
            open(full_path, 'rb'),
            content_type=content_type,
            as_attachment=True,
            filename=filename
        )
        
        return response
