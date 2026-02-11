"""Audio API views"""

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView
from audio.models import Audio, AudioProgress
from audio.serializers import (
    AudioListSerializer,
    AudioSerializer,
    AudioProgressUpdateSerializer,
    PlayerSerializer,
)
from common.views import ApiBaseView, AdminWriteOnly

# Allowed URL prefixes for artwork fetching (SSRF protection)
# Only trusted external services are allowed
ALLOWED_ARTWORK_URL_PREFIXES = (
    'https://i.ytimg.com/',           # YouTube thumbnails
    'https://i3.ytimg.com/',          # YouTube thumbnails alt
    'https://i9.ytimg.com/',          # YouTube thumbnails alt
    'https://img.youtube.com/',       # YouTube thumbnails
    'https://coverartarchive.org/',   # MusicBrainz Cover Art Archive
    'http://coverartarchive.org/',    # MusicBrainz Cover Art Archive (HTTP)
    'https://assets.fanart.tv/',      # Fanart.tv
    'https://lastfm.freetls.fastly.net/',  # Last.fm images
)


def is_safe_artwork_url(url: str) -> bool:
    """Validate URL is from a trusted source to prevent SSRF attacks"""
    if not url:
        return False
    return any(url.startswith(prefix) for prefix in ALLOWED_ARTWORK_URL_PREFIXES)


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
        favorites = request.query_params.get('favorites')

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
        if favorites == 'true':
            queryset = queryset.filter(is_favorite=True)

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
        
        elif action == 'toggle_favorite':
            # Toggle favorite status
            audio.is_favorite = not audio.is_favorite
            audio.save()
            return Response({
                'message': 'Favorite status updated',
                'is_favorite': audio.is_favorite
            })
        
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
        
        # Include auth token in stream URL for browser media elements
        # Browser audio/video elements can't send Authorization headers
        from rest_framework.authtoken.models import Token
        try:
            token = Token.objects.get(user=request.user)
            stream_url = f"/media/{encoded_path}?token={token.key}"
        except Token.DoesNotExist:
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
    # Accept any content type to bypass DRF content negotiation for file downloads
    # This prevents 406 errors when clients request audio/* content types
    from rest_framework.renderers import BaseRenderer
    
    class PassthroughRenderer(BaseRenderer):
        """Renderer that passes through any content type"""
        media_type = '*/*'
        format = ''
        
        def render(self, data, accepted_media_type=None, renderer_context=None):
            return data
    
    renderer_classes = [PassthroughRenderer]

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


class AudioExportView(ApiBaseView):
    """Export audio file with format conversion and full metadata embedding
    GET: Get export options for the track
    POST: Export audio with specified format and options
    """
    from rest_framework.renderers import BaseRenderer
    
    class PassthroughRenderer(BaseRenderer):
        """Renderer that passes through any content type"""
        media_type = '*/*'
        format = ''
        
        def render(self, data, accepted_media_type=None, renderer_context=None):
            return data
    
    renderer_classes = [PassthroughRenderer]
    
    def get(self, request, youtube_id):
        """Get export options for a track"""
        audio = get_object_or_404(Audio, youtube_id=youtube_id, owner=request.user)
        
        if not audio.file_path:
            return Response(
                {'error': 'Audio file not available'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Check for lyrics
        has_lyrics = False
        has_synced_lyrics = False
        try:
            from audio.models_lyrics import Lyrics
            lyrics = Lyrics.objects.get(audio=audio)
            has_lyrics = bool(lyrics.plain_lyrics or lyrics.synced_lyrics)
            has_synced_lyrics = bool(lyrics.synced_lyrics)
            print(f"[Export GET] Found lyrics for {youtube_id}: has_lyrics={has_lyrics}, has_synced={has_synced_lyrics}, source={lyrics.source}")
        except Lyrics.DoesNotExist:
            print(f"[Export GET] No lyrics found for {youtube_id}")
        except Exception as e:
            print(f"[Export GET] Error checking lyrics for {youtube_id}: {e}")
        
        # Check for artwork
        has_artwork = bool(audio.cover_art_url or audio.thumbnail_url)
        artwork_sources = []
        if audio.cover_art_url:
            artwork_sources.append({'type': 'cover_art', 'url': audio.cover_art_url, 'label': 'Album Cover'})
        if audio.thumbnail_url:
            artwork_sources.append({'type': 'thumbnail', 'url': audio.thumbnail_url, 'label': 'YouTube Thumbnail'})
        
        # Check for uploaded artwork
        try:
            from audio.models_artwork import Artwork
            artworks = Artwork.objects.filter(audio=audio).order_by('-priority')
            for art in artworks:
                artwork_sources.append({
                    'type': art.artwork_type,
                    'url': art.url,
                    'label': f'{art.get_artwork_type_display()} ({art.source})',
                    'priority': art.priority,
                })
        except:
            pass
        
        return Response({
            'youtube_id': youtube_id,
            'title': audio.title,
            'artist': audio.artist or audio.channel_name,
            'album': audio.album or '',
            'current_format': audio.audio_format,
            'available_formats': ['mp3', 'flac'],
            'has_lyrics': has_lyrics,
            'has_synced_lyrics': has_synced_lyrics,
            'has_artwork': has_artwork,
            'artwork_sources': artwork_sources,
            'metadata': {
                'title': audio.title,
                'artist': audio.artist or audio.channel_name,
                'album': audio.album,
                'year': audio.year,
                'genre': audio.genre,
                'track_number': audio.track_number,
            }
        })
    
    def post(self, request, youtube_id):
        """Export audio with specified format and embedded metadata"""
        import subprocess
        import tempfile
        import shutil
        from django.http import FileResponse
        from django.conf import settings
        from pathlib import Path
        
        audio = get_object_or_404(Audio, youtube_id=youtube_id, owner=request.user)
        
        if not audio.file_path:
            return Response(
                {'error': 'Audio file not available'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Get export options
        target_format = request.data.get('format', 'mp3').lower()
        embed_lyrics = request.data.get('embed_lyrics', True)
        embed_artwork = request.data.get('embed_artwork', True)
        artwork_url = request.data.get('artwork_url', '')  # Custom artwork URL
        quality = request.data.get('quality', 'high')  # high, medium, low
        
        if target_format not in ['mp3', 'flac']:
            return Response(
                {'error': 'Invalid format. Supported: mp3, flac'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Build source path
        source_path = Path(settings.MEDIA_ROOT) / audio.file_path
        if not source_path.exists():
            return Response(
                {'error': 'Source audio file not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Get lyrics if requested
        plain_lyrics = None
        synced_lyrics = None
        if embed_lyrics:
            try:
                from audio.models_lyrics import Lyrics
                lyrics_obj = Lyrics.objects.get(audio=audio)
                plain_lyrics = lyrics_obj.plain_lyrics
                synced_lyrics = lyrics_obj.synced_lyrics
            except:
                pass
        
        # Get artwork
        cover_art_data = None
        if embed_artwork:
            import requests as http_requests
            
            # Priority: custom URL > cover_art_url > thumbnail
            art_url = artwork_url or audio.cover_art_url or audio.thumbnail_url
            
            # SSRF protection: validate URL is from allowed sources
            if art_url and is_safe_artwork_url(art_url):
                try:
                    resp = http_requests.get(art_url, timeout=10)
                    if resp.status_code == 200:
                        cover_art_data = resp.content
                except Exception:
                    pass  # Silently fail - don't expose error details
        
        # Create temporary file for conversion
        temp_dir = tempfile.mkdtemp()
        try:
            safe_title = "".join(c for c in audio.title if c.isalnum() or c in (' ', '-', '_')).strip()[:100]
            if not safe_title:
                safe_title = f"audio_{youtube_id}"
            
            output_filename = f"{safe_title}.{target_format}"
            output_path = Path(temp_dir) / output_filename
            
            # Determine if conversion is needed
            source_ext = source_path.suffix.lower()
            needs_conversion = (
                (target_format == 'mp3' and source_ext != '.mp3') or
                (target_format == 'flac' and source_ext != '.flac')
            )
            
            if needs_conversion:
                # Use ffmpeg for conversion
                ffmpeg_cmd = ['ffmpeg', '-y', '-i', str(source_path)]
                
                if target_format == 'mp3':
                    # Quality settings for MP3
                    if quality == 'high':
                        ffmpeg_cmd.extend(['-codec:a', 'libmp3lame', '-b:a', '320k'])
                    elif quality == 'medium':
                        ffmpeg_cmd.extend(['-codec:a', 'libmp3lame', '-b:a', '192k'])
                    else:
                        ffmpeg_cmd.extend(['-codec:a', 'libmp3lame', '-b:a', '128k'])
                elif target_format == 'flac':
                    ffmpeg_cmd.extend(['-codec:a', 'flac', '-compression_level', '8'])
                
                ffmpeg_cmd.append(str(output_path))
                
                result = subprocess.run(ffmpeg_cmd, capture_output=True, text=True, timeout=300)
                if result.returncode != 0:
                    print(f"FFmpeg error: {result.stderr}")
                    return Response(
                        {'error': 'Audio conversion failed'},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR
                    )
            else:
                # Just copy the file
                shutil.copy2(source_path, output_path)
            
            # Write metadata tags including lyrics and artwork
            from audio.tag_writer import write_metadata_to_file
            
            write_metadata_to_file(
                file_path=str(output_path),
                title=audio.title,
                artist=audio.artist or audio.channel_name,
                album=audio.album,
                year=audio.year,
                genre=audio.genre,
                track_number=audio.track_number,
                cover_art_data=cover_art_data,
                lyrics=plain_lyrics,
                synced_lyrics=synced_lyrics,
            )
            
            # Determine content type
            content_type = 'audio/mpeg' if target_format == 'mp3' else 'audio/flac'
            
            # Read the file into memory to return it
            with open(output_path, 'rb') as f:
                file_data = f.read()
            
            # Create response
            from django.http import HttpResponse
            response = HttpResponse(file_data, content_type=content_type)
            response['Content-Disposition'] = f'attachment; filename="{output_filename}"'
            response['Content-Length'] = len(file_data)
            
            return response
            
        finally:
            # Clean up temp directory
            try:
                shutil.rmtree(temp_dir)
            except:
                pass


class MetadataSearchView(ApiBaseView):
    """Search for metadata from online sources
    GET: search for metadata matches
    """

    def get(self, request, youtube_id):
        """Search metadata for an audio track"""
        from audio.metadata_fetcher import metadata_fetcher
        from dataclasses import asdict
        
        audio = get_object_or_404(Audio, youtube_id=youtube_id, owner=request.user)
        
        # Get optional search parameters
        title = request.query_params.get('title', audio.title)
        artist = request.query_params.get('artist', audio.artist or audio.channel_name)
        
        # Search MusicBrainz
        results = metadata_fetcher.search_musicbrainz(
            title=title,
            artist=artist,
            channel_name=audio.channel_name
        )
        
        return Response({
            'results': [asdict(r) for r in results],
            'current': {
                'title': audio.title,
                'artist': audio.artist,
                'album': audio.album,
                'year': audio.year,
                'genre': audio.genre,
                'cover_art_url': audio.cover_art_url,
                'musicbrainz_id': audio.musicbrainz_id,
                'metadata_source': audio.metadata_source,
            }
        })


class MetadataApplyView(ApiBaseView):
    """Apply metadata from search result or manual input
    POST: apply metadata to audio track
    """

    def post(self, request, youtube_id):
        """Apply metadata to audio track"""
        from django.utils import timezone
        from audio.metadata_fetcher import metadata_fetcher
        from audio.tag_writer import write_metadata_to_file
        
        audio = get_object_or_404(Audio, youtube_id=youtube_id, owner=request.user)
        
        data = request.data
        musicbrainz_id = data.get('musicbrainz_id')
        
        # If MusicBrainz ID provided, fetch full details
        if musicbrainz_id:
            result = metadata_fetcher.get_recording_details(musicbrainz_id)
            if result:
                audio.artist = result.artist or audio.artist
                audio.album = result.album or audio.album
                audio.year = result.year or audio.year
                audio.genre = result.genre or audio.genre
                audio.track_number = result.track_number or audio.track_number
                audio.cover_art_url = result.cover_art_url or audio.cover_art_url
                audio.musicbrainz_id = musicbrainz_id
                audio.metadata_source = 'musicbrainz'
                audio.metadata_updated = timezone.now()
                audio.save()
                
                # Write tags to the actual audio file
                if audio.file_path:
                    write_metadata_to_file(
                        file_path=audio.file_path,
                        title=audio.title,
                        artist=audio.artist,
                        album=audio.album,
                        year=audio.year,
                        genre=audio.genre,
                        track_number=audio.track_number,
                        cover_art_url=audio.cover_art_url,
                    )
                
                return Response({
                    'message': 'Metadata applied from MusicBrainz',
                    'audio': AudioSerializer(audio).data
                })
            else:
                return Response(
                    {'error': 'Could not fetch details from MusicBrainz'},
                    status=status.HTTP_400_BAD_REQUEST
                )
        
        # Manual metadata application
        if 'artist' in data:
            audio.artist = data['artist']
        if 'album' in data:
            audio.album = data['album']
        if 'year' in data:
            audio.year = data.get('year')
        if 'genre' in data:
            audio.genre = data['genre']
        if 'track_number' in data:
            audio.track_number = data.get('track_number')
        if 'cover_art_url' in data:
            audio.cover_art_url = data['cover_art_url']
        
        audio.metadata_source = data.get('source', 'manual')
        audio.metadata_updated = timezone.now()
        audio.save()
        
        # Write tags to the actual audio file
        if audio.file_path:
            write_metadata_to_file(
                file_path=audio.file_path,
                title=audio.title,
                artist=audio.artist,
                album=audio.album,
                year=audio.year,
                genre=audio.genre,
                track_number=audio.track_number,
                cover_art_url=audio.cover_art_url,
            )
        
        return Response({
            'message': 'Metadata updated',
            'audio': AudioSerializer(audio).data
        })


class MetadataAutoFetchView(ApiBaseView):
    """Auto-fetch best matching metadata
    POST: automatically fetch and apply best metadata match
    """

    def post(self, request, youtube_id):
        """Auto-fetch metadata for an audio track"""
        from django.utils import timezone
        from audio.metadata_fetcher import metadata_fetcher
        from audio.tag_writer import write_metadata_to_file
        
        audio = get_object_or_404(Audio, youtube_id=youtube_id, owner=request.user)
        
        # Search MusicBrainz
        results = metadata_fetcher.search_musicbrainz(
            title=audio.title,
            artist=audio.artist or audio.channel_name,
            channel_name=audio.channel_name
        )
        
        if not results:
            return Response({
                'message': 'No metadata found',
                'audio': AudioSerializer(audio).data
            })
        
        # Take the best match (highest confidence)
        best_match = results[0]
        
        # Only apply if confidence is reasonable
        if best_match.confidence < 0.5:
            return Response({
                'message': 'No confident match found',
                'best_match': {
                    'title': best_match.title,
                    'artist': best_match.artist,
                    'confidence': best_match.confidence
                },
                'audio': AudioSerializer(audio).data
            })
        
        # Get full details if we have a MusicBrainz ID
        if best_match.musicbrainz_id:
            result = metadata_fetcher.get_recording_details(best_match.musicbrainz_id)
            if result:
                best_match = result
        
        # Apply metadata
        audio.artist = best_match.artist or audio.artist
        audio.album = best_match.album or audio.album
        audio.year = best_match.year or audio.year
        audio.genre = best_match.genre or audio.genre
        audio.track_number = best_match.track_number or audio.track_number
        audio.cover_art_url = best_match.cover_art_url or audio.cover_art_url
        audio.musicbrainz_id = best_match.musicbrainz_id or audio.musicbrainz_id
        audio.metadata_source = 'musicbrainz'
        audio.metadata_updated = timezone.now()
        audio.save()
        
        # Write tags to the actual audio file
        if audio.file_path:
            write_metadata_to_file(
                file_path=audio.file_path,
                title=audio.title,
                artist=audio.artist,
                album=audio.album,
                year=audio.year,
                genre=audio.genre,
                track_number=audio.track_number,
                cover_art_url=audio.cover_art_url,
            )
        
        return Response({
            'message': 'Metadata applied',
            'confidence': best_match.confidence,
            'audio': AudioSerializer(audio).data
        })


class ArtworkProxyView(APIView):
    """Proxy artwork images to avoid CORS issues for Media Session API
    
    This view allows unauthenticated access because the Media Session API
    cannot pass authentication headers when fetching artwork URLs.
    Security is maintained because:
    1. Only serves publicly available artwork URLs (YouTube thumbnails, etc.)
    2. Does not expose any user data
    3. The youtube_id must exist in the database
    4. URLs are validated to prevent SSRF attacks
    """
    authentication_classes = []
    permission_classes = []
    
    def get(self, request, youtube_id):
        """Proxy artwork for a track"""
        import requests as http_requests
        from django.http import HttpResponse
        
        # Allow any user's audio since this doesn't expose sensitive data
        audio = get_object_or_404(Audio, youtube_id=youtube_id)
        
        # Get artwork URL
        artwork_url = audio.cover_art_url or audio.thumbnail_url
        
        if not artwork_url:
            return Response(
                {'error': 'No artwork available'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # SSRF protection: validate URL is from allowed sources
        if not is_safe_artwork_url(artwork_url):
            return Response(
                {'error': 'Invalid artwork source'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        try:
            # Fetch the image
            resp = http_requests.get(artwork_url, timeout=10)
            if resp.status_code == 200:
                # Determine content type
                content_type = resp.headers.get('content-type', 'image/jpeg')
                
                # Return image with CORS headers
                response = HttpResponse(resp.content, content_type=content_type)
                response['Access-Control-Allow-Origin'] = '*'
                response['Cache-Control'] = 'public, max-age=86400'  # Cache for 1 day
                return response
            else:
                return Response(
                    {'error': 'Failed to fetch artwork'},
                    status=status.HTTP_502_BAD_GATEWAY
                )
        except Exception:
            # Don't expose exception details in response
            return Response(
                {'error': 'Error fetching artwork'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
