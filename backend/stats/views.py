"""Stats API views"""

from datetime import datetime, timedelta
from django.db.models import Sum, Count, F
from django.db.models.functions import ExtractHour, ExtractWeekDay, TruncDate
from django.utils import timezone
from rest_framework.response import Response
from rest_framework import status
from audio.models import Audio
from channel.models import Channel
from download.models import DownloadQueue
from stats.models import ListeningHistory
from stats.serializers import (
    AudioStatsSerializer,
    ChannelStatsSerializer,
    DownloadStatsSerializer,
    ListeningInsightsSerializer,
    ListeningHistorySerializer,
)
from common.views import ApiBaseView


class AudioStatsView(ApiBaseView):
    """Audio statistics endpoint"""

    def get(self, request):
        """Get audio statistics"""
        stats = Audio.objects.filter(owner=request.user).aggregate(
            total_count=Count('id'),
            total_duration=Sum('duration'),
            total_size=Sum('file_size'),
            total_plays=Sum('play_count'),
        )

        # Handle None values
        stats = {k: v or 0 for k, v in stats.items()}

        serializer = AudioStatsSerializer(stats)
        return Response(serializer.data)


class ChannelStatsView(ApiBaseView):
    """Channel statistics endpoint"""

    def get(self, request):
        """Get channel statistics"""
        stats = {
            'total_channels': Channel.objects.filter(user=request.user).count(),
            'subscribed_channels': Channel.objects.filter(user=request.user, subscribed=True).count(),
        }

        serializer = ChannelStatsSerializer(stats)
        return Response(serializer.data)


class DownloadStatsView(ApiBaseView):
    """Download statistics endpoint"""

    def get(self, request):
        """Get download statistics"""
        stats = {
            'pending': DownloadQueue.objects.filter(user=request.user, status='pending').count(),
            'completed': DownloadQueue.objects.filter(user=request.user, status='completed').count(),
            'failed': DownloadQueue.objects.filter(user=request.user, status='failed').count(),
        }

        serializer = DownloadStatsSerializer(stats)
        return Response(serializer.data)


class ListeningInsightsView(ApiBaseView):
    """Personal listening analytics and insights"""
    
    def get(self, request):
        """Get comprehensive listening insights"""
        user = request.user
        
        # Time range - default to last 30 days, can be customized
        days = int(request.query_params.get('days', 30))
        start_date = timezone.now() - timedelta(days=days)
        
        history = ListeningHistory.objects.filter(
            user=user,
            listened_at__gte=start_date
        )
        
        # Summary stats
        summary = history.aggregate(
            total_listening_time=Sum('duration_listened'),
            total_tracks_played=Count('id'),
        )
        
        total_listening_time = summary['total_listening_time'] or 0
        total_tracks_played = summary['total_tracks_played'] or 0
        
        # Unique counts
        unique_tracks = history.values('audio').distinct().count()
        unique_artists = history.exclude(artist='').values('artist').distinct().count()
        
        # Average daily listening
        daily_stats = history.annotate(
            date=TruncDate('listened_at')
        ).values('date').annotate(
            duration=Sum('duration_listened')
        )
        active_days = daily_stats.count()
        avg_daily = total_listening_time // max(active_days, 1)
        
        # Top artists
        top_artists = history.exclude(artist='').values('artist').annotate(
            play_count=Count('id'),
            total_duration=Sum('duration_listened')
        ).order_by('-play_count')[:10]
        
        # Top channels
        top_channels = history.values('channel_name').annotate(
            play_count=Count('id'),
            total_duration=Sum('duration_listened')
        ).order_by('-play_count')[:10]
        
        # Top tracks
        top_tracks = history.values(
            'title', 'artist', 'audio__youtube_id', 'audio__thumbnail_url'
        ).annotate(
            play_count=Count('id'),
            total_duration=Sum('duration_listened')
        ).order_by('-play_count')[:10]
        
        top_tracks_formatted = [
            {
                'title': t['title'],
                'artist': t['artist'],
                'youtube_id': t['audio__youtube_id'],
                'thumbnail_url': t['audio__thumbnail_url'] or '',
                'play_count': t['play_count'],
                'total_duration': t['total_duration'] or 0,
            }
            for t in top_tracks
        ]
        
        # Listening by hour of day
        by_hour = history.annotate(
            hour=ExtractHour('listened_at')
        ).values('hour').annotate(
            play_count=Count('id'),
            total_duration=Sum('duration_listened')
        ).order_by('hour')
        
        # Fill in missing hours
        hours_dict = {h['hour']: h for h in by_hour}
        listening_by_hour = [
            hours_dict.get(h, {'hour': h, 'play_count': 0, 'total_duration': 0})
            for h in range(24)
        ]
        
        # Favorite hour
        favorite_hour = None
        if by_hour:
            max_hour = max(by_hour, key=lambda x: x['play_count'], default=None)
            if max_hour:
                favorite_hour = max_hour['hour']
        
        # Listening by day of week
        by_weekday = history.annotate(
            weekday=ExtractWeekDay('listened_at')
        ).values('weekday').annotate(
            play_count=Count('id'),
            total_duration=Sum('duration_listened')
        ).order_by('-play_count')
        
        day_names = ['', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
        favorite_day = ''
        if by_weekday:
            favorite_day = day_names[by_weekday[0]['weekday']] if by_weekday[0]['weekday'] <= 7 else ''
        
        # Daily listening trend (last N days)
        daily_listening = history.annotate(
            date=TruncDate('listened_at')
        ).values('date').annotate(
            play_count=Count('id'),
            total_duration=Sum('duration_listened')
        ).order_by('date')
        
        # Calculate streaks
        dates_with_listening = set(d['date'] for d in daily_listening)
        today = timezone.now().date()
        
        # Current streak
        current_streak = 0
        check_date = today
        while check_date in dates_with_listening:
            current_streak += 1
            check_date -= timedelta(days=1)
        
        # Longest streak
        longest_streak = 0
        if dates_with_listening:
            sorted_dates = sorted(dates_with_listening)
            streak = 1
            for i in range(1, len(sorted_dates)):
                if sorted_dates[i] - sorted_dates[i-1] == timedelta(days=1):
                    streak += 1
                else:
                    longest_streak = max(longest_streak, streak)
                    streak = 1
            longest_streak = max(longest_streak, streak)
        
        # Genre distribution
        genre_distribution = history.exclude(genre='').values('genre').annotate(
            play_count=Count('id'),
            total_duration=Sum('duration_listened')
        ).order_by('-play_count')[:10]
        
        # Recent history
        recent = history.select_related('audio').order_by('-listened_at')[:20]
        
        data = {
            'total_listening_time': total_listening_time,
            'total_tracks_played': total_tracks_played,
            'total_unique_tracks': unique_tracks,
            'total_unique_artists': unique_artists,
            'avg_daily_listening': avg_daily,
            'favorite_hour': favorite_hour,
            'favorite_day': favorite_day,
            'longest_streak': longest_streak,
            'current_streak': current_streak,
            'top_artists': list(top_artists),
            'top_channels': list(top_channels),
            'top_tracks': top_tracks_formatted,
            'listening_by_hour': listening_by_hour,
            'daily_listening': list(daily_listening),
            'genre_distribution': list(genre_distribution),
            'recent_history': recent,
        }
        
        serializer = ListeningInsightsSerializer(data)
        return Response(serializer.data)


class RecordListeningView(ApiBaseView):
    """Record a listening event"""
    
    def post(self, request):
        """Record when a user plays/listens to a track"""
        youtube_id = request.data.get('youtube_id')
        duration_listened = int(request.data.get('duration_listened', 0))
        completed = request.data.get('completed', False)
        
        if not youtube_id:
            return Response(
                {'error': 'youtube_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            audio = Audio.objects.get(owner=request.user, youtube_id=youtube_id)
        except Audio.DoesNotExist:
            return Response(
                {'error': 'Audio not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Extract artist from channel name or title
        artist = audio.channel_name
        # Try to parse artist from title if it contains " - "
        if ' - ' in audio.title:
            parts = audio.title.split(' - ', 1)
            if len(parts) == 2:
                artist = parts[0].strip()
        
        # Create listening history entry
        entry = ListeningHistory.objects.create(
            user=request.user,
            audio=audio,
            title=audio.title,
            artist=artist,
            channel_name=audio.channel_name,
            genre='',  # Can be populated from metadata if available
            duration_listened=duration_listened,
            completed=completed,
        )
        
        # Also update play count on the audio
        audio.play_count += 1
        audio.last_played = timezone.now()
        audio.save(update_fields=['play_count', 'last_played'])
        
        serializer = ListeningHistorySerializer(entry)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class ListeningHistoryView(ApiBaseView):
    """View and manage listening history"""
    
    def get(self, request):
        """Get paginated listening history"""
        page = int(request.query_params.get('page', 1))
        page_size = int(request.query_params.get('page_size', 50))
        
        history = ListeningHistory.objects.filter(
            user=request.user
        ).select_related('audio').order_by('-listened_at')
        
        total = history.count()
        offset = (page - 1) * page_size
        items = history[offset:offset + page_size]
        
        serializer = ListeningHistorySerializer(items, many=True)
        
        return Response({
            'results': serializer.data,
            'total': total,
            'page': page,
            'page_size': page_size,
            'total_pages': (total + page_size - 1) // page_size,
        })
    
    def delete(self, request):
        """Clear listening history"""
        days = request.query_params.get('days')
        
        qs = ListeningHistory.objects.filter(user=request.user)
        
        if days:
            cutoff = timezone.now() - timedelta(days=int(days))
            qs = qs.filter(listened_at__lt=cutoff)
        
        count, _ = qs.delete()
        
        return Response({'deleted': count})
