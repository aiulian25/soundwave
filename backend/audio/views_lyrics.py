"""Views for lyrics management"""
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.shortcuts import get_object_or_404
from django.http import HttpResponse

from audio.models import Audio
from audio.models_lyrics import Lyrics, LyricsCache
from audio.serializers_lyrics import (
    LyricsSerializer,
    LyricsUpdateSerializer,
    LyricsFetchSerializer,
    LyricsCacheSerializer,
)
from audio.lyrics_service import LyricsService, LRCLIBClient, clean_title_for_lyrics
from audio.tasks_lyrics import fetch_lyrics_for_audio, fetch_lyrics_batch
from common.views import ApiBaseView


class LyricsDownloadView(ApiBaseView):
    """Separate view for downloading lyrics as files"""
    
    def get(self, request, youtube_id):
        """Download lyrics as .lrc or .txt file"""
        import re
        
        audio = get_object_or_404(Audio, youtube_id=youtube_id)
        
        try:
            lyrics = Lyrics.objects.get(audio=audio)
        except Lyrics.DoesNotExist:
            return Response(
                {'error': 'No lyrics found for this track'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Get format from query params - use 'type' instead of 'format' to avoid DRF content negotiation conflict
        format_type = request.query_params.get('type', 'auto') if hasattr(request, 'query_params') else request.GET.get('type', 'auto')
        
        # Clean filename
        safe_title = re.sub(r'[^\w\s\-]', '', audio.title)[:100].strip()
        safe_artist = re.sub(r'[^\w\s\-]', '', audio.channel_name)[:50].strip()
        base_filename = f"{safe_artist} - {safe_title}" if safe_artist else safe_title
        
        if format_type == 'lrc' or (format_type == 'auto' and lyrics.synced_lyrics):
            # Download as LRC
            if not lyrics.synced_lyrics:
                return Response(
                    {'error': 'No synced lyrics available for LRC format'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            # Add metadata header to LRC
            lrc_content = f"[ti:{audio.title}]\n"
            lrc_content += f"[ar:{audio.channel_name}]\n"
            if lyrics.language:
                lrc_content += f"[la:{lyrics.language}]\n"
            lrc_content += f"[by:SoundWave]\n"
            lrc_content += f"\n{lyrics.synced_lyrics}"
            
            response = HttpResponse(lrc_content, content_type='text/plain; charset=utf-8')
            response['Content-Disposition'] = f'attachment; filename="{base_filename}.lrc"'
            return response
        else:
            # Download as TXT
            if not lyrics.plain_lyrics and not lyrics.synced_lyrics:
                return Response(
                    {'error': 'No lyrics available'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            # Use plain lyrics or strip timestamps from synced
            if lyrics.plain_lyrics:
                txt_content = lyrics.plain_lyrics
            else:
                # Strip timestamps from synced lyrics
                txt_content = re.sub(r'\[\d{2}:\d{2}\.\d{2,3}\]', '', lyrics.synced_lyrics)
                txt_content = '\n'.join(line.strip() for line in txt_content.split('\n') if line.strip())
            
            # Add header
            header = f"{audio.title}\n{audio.channel_name}\n{'=' * 40}\n\n"
            txt_content = header + txt_content
            
            response = HttpResponse(txt_content, content_type='text/plain; charset=utf-8')
            response['Content-Disposition'] = f'attachment; filename="{base_filename}.txt"'
            return response


class LyricsViewSet(viewsets.ModelViewSet):
    """ViewSet for managing lyrics"""
    
    permission_classes = [IsAuthenticated]
    serializer_class = LyricsSerializer
    lookup_field = 'audio__youtube_id'
    lookup_url_kwarg = 'youtube_id'
    
    def get_queryset(self):
        """Get lyrics queryset"""
        return Lyrics.objects.select_related('audio').all()
    
    def retrieve(self, request, youtube_id=None):
        """Get lyrics for a specific audio track"""
        audio = get_object_or_404(Audio, youtube_id=youtube_id)
        
        # Get or create lyrics entry
        lyrics, created = Lyrics.objects.get_or_create(audio=audio)
        
        # If no lyrics and not attempted, trigger fetch
        if not lyrics.fetch_attempted:
            # Trigger async fetch
            fetch_lyrics_for_audio.delay(youtube_id)
            
        serializer = self.get_serializer(lyrics)
        return Response(serializer.data)
    
    @action(detail=True, methods=['post'])
    def fetch(self, request, youtube_id=None):
        """Manually fetch lyrics for an audio track"""
        audio = get_object_or_404(Audio, youtube_id=youtube_id)
        
        # Validate request data
        fetch_serializer = LyricsFetchSerializer(data=request.data)
        fetch_serializer.is_valid(raise_exception=True)
        
        force = fetch_serializer.validated_data.get('force', False)
        
        # Fetch lyrics synchronously
        service = LyricsService()
        lyrics = service.fetch_and_store_lyrics(audio, force=force)
        
        serializer = self.get_serializer(lyrics)
        return Response(serializer.data)
    
    @action(detail=True, methods=['put', 'patch'])
    def update_lyrics(self, request, youtube_id=None):
        """Manually update lyrics for an audio track"""
        audio = get_object_or_404(Audio, youtube_id=youtube_id)
        lyrics, created = Lyrics.objects.get_or_create(audio=audio)
        
        # Validate and update
        update_serializer = LyricsUpdateSerializer(data=request.data)
        update_serializer.is_valid(raise_exception=True)
        
        # Update fields
        if 'synced_lyrics' in update_serializer.validated_data:
            lyrics.synced_lyrics = update_serializer.validated_data['synced_lyrics']
        if 'plain_lyrics' in update_serializer.validated_data:
            lyrics.plain_lyrics = update_serializer.validated_data['plain_lyrics']
        if 'is_instrumental' in update_serializer.validated_data:
            lyrics.is_instrumental = update_serializer.validated_data['is_instrumental']
        if 'language' in update_serializer.validated_data:
            lyrics.language = update_serializer.validated_data['language']
        
        lyrics.source = 'manual'
        lyrics.fetch_attempted = True
        lyrics.save()
        
        serializer = self.get_serializer(lyrics)
        return Response(serializer.data)
    
    @action(detail=True, methods=['get'])
    def suggestions(self, request, youtube_id=None):
        """Get lyrics suggestions from LRCLIB for an audio track"""
        audio = get_object_or_404(Audio, youtube_id=youtube_id)
        
        # Get query from params or use cleaned title
        query = request.query_params.get('q', '')
        
        if not query:
            # Use cleaned title for search
            clean_track, clean_artist = clean_title_for_lyrics(audio.title, audio.channel_name)
            query = clean_track
            artist = clean_artist
        else:
            artist = request.query_params.get('artist', audio.channel_name)
        
        # Search for suggestions
        client = LRCLIBClient()
        suggestions = client.search_lyrics_suggestions(query, artist)
        
        return Response({
            'query': query,
            'artist': artist,
            'audio_title': audio.title,
            'audio_duration': round(audio.duration),
            'suggestions': suggestions,
            'count': len(suggestions),
        })
    
    @action(detail=True, methods=['post'])
    def apply_suggestion(self, request, youtube_id=None):
        """Apply a selected lyrics suggestion to an audio track"""
        audio = get_object_or_404(Audio, youtube_id=youtube_id)
        lyrics, created = Lyrics.objects.get_or_create(audio=audio)
        
        # Get suggestion data from request
        synced_lyrics = request.data.get('synced_lyrics', '')
        plain_lyrics = request.data.get('plain_lyrics', '')
        instrumental = request.data.get('instrumental', False)
        language = request.data.get('language', '')
        track_name = request.data.get('track_name', '')
        artist_name = request.data.get('artist_name', '')
        
        # Update lyrics
        lyrics.synced_lyrics = synced_lyrics
        lyrics.plain_lyrics = plain_lyrics
        lyrics.is_instrumental = instrumental
        lyrics.language = language
        lyrics.source = f'lrclib (manual: {track_name} - {artist_name})' if track_name else 'lrclib (manual)'
        lyrics.fetch_attempted = True
        lyrics.save()
        
        serializer = self.get_serializer(lyrics)
        return Response(serializer.data)
    
    @action(detail=True, methods=['delete'])
    def delete_lyrics(self, request, youtube_id=None):
        """Delete lyrics for an audio track"""
        audio = get_object_or_404(Audio, youtube_id=youtube_id)
        
        try:
            lyrics = Lyrics.objects.get(audio=audio)
            lyrics.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        except Lyrics.DoesNotExist:
            return Response(
                {'message': 'No lyrics found for this track'},
                status=status.HTTP_404_NOT_FOUND
            )
    
    @action(detail=False, methods=['post'])
    def fetch_batch(self, request):
        """Fetch lyrics for multiple audio tracks"""
        youtube_ids = request.data.get('youtube_ids', [])
        
        if not youtube_ids:
            return Response(
                {'error': 'youtube_ids is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Trigger async batch fetch
        fetch_lyrics_batch.delay(youtube_ids)
        
        return Response({
            'message': f'Fetching lyrics for {len(youtube_ids)} tracks',
            'youtube_ids': youtube_ids,
        })
    
    @action(detail=False, methods=['post'])
    def fetch_all_missing(self, request):
        """Fetch lyrics for all audio without lyrics"""
        from audio.tasks_lyrics import auto_fetch_lyrics
        
        limit = request.data.get('limit', 50)
        
        # Trigger async task
        result = auto_fetch_lyrics.delay(limit=limit)
        
        return Response({
            'message': f'Fetching lyrics for up to {limit} tracks without lyrics',
            'task_id': result.id,
        })
    
    @action(detail=False, methods=['get'])
    def stats(self, request):
        """Get lyrics statistics"""
        total_audio = Audio.objects.filter(downloaded=True).count()
        total_lyrics = Lyrics.objects.filter(fetch_attempted=True).count()
        with_synced = Lyrics.objects.exclude(synced_lyrics='').count()
        with_plain = Lyrics.objects.exclude(plain_lyrics='').count()
        instrumental = Lyrics.objects.filter(is_instrumental=True).count()
        failed = Lyrics.objects.filter(
            fetch_attempted=True,
            synced_lyrics='',
            plain_lyrics='',
            is_instrumental=False
        ).count()
        
        return Response({
            'total_audio': total_audio,
            'total_lyrics_attempted': total_lyrics,
            'with_synced_lyrics': with_synced,
            'with_plain_lyrics': with_plain,
            'instrumental': instrumental,
            'failed': failed,
            'coverage_percentage': round((with_synced + with_plain + instrumental) / total_audio * 100, 1) if total_audio > 0 else 0,
        })


class LyricsCacheViewSet(viewsets.ReadOnlyModelViewSet):
    """ViewSet for viewing lyrics cache"""
    
    permission_classes = [IsAuthenticated]
    serializer_class = LyricsCacheSerializer
    queryset = LyricsCache.objects.all()
    
    @action(detail=False, methods=['post'])
    def cleanup(self, request):
        """Clean up old cache entries"""
        from audio.tasks_lyrics import cleanup_lyrics_cache
        
        days_old = request.data.get('days_old', 30)
        result = cleanup_lyrics_cache.delay(days_old=days_old)
        
        return Response({
            'message': f'Cleaning up cache entries older than {days_old} days',
            'task_id': result.id,
        })
    
    @action(detail=False, methods=['get'])
    def stats(self, request):
        """Get cache statistics"""
        total = LyricsCache.objects.count()
        not_found = LyricsCache.objects.filter(not_found=True).count()
        with_synced = LyricsCache.objects.exclude(synced_lyrics='').count()
        with_plain = LyricsCache.objects.exclude(plain_lyrics='').count()
        
        return Response({
            'total_entries': total,
            'not_found_entries': not_found,
            'with_synced_lyrics': with_synced,
            'with_plain_lyrics': with_plain,
            'hit_rate': round((with_synced + with_plain) / total * 100, 1) if total > 0 else 0,
        })
