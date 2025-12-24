"""Views for lyrics management"""
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.shortcuts import get_object_or_404

from audio.models import Audio
from audio.models_lyrics import Lyrics, LyricsCache
from audio.serializers_lyrics import (
    LyricsSerializer,
    LyricsUpdateSerializer,
    LyricsFetchSerializer,
    LyricsCacheSerializer,
)
from audio.lyrics_service import LyricsService
from audio.tasks_lyrics import fetch_lyrics_for_audio, fetch_lyrics_batch


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
