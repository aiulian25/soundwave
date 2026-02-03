"""Stats API views"""

from datetime import datetime, timedelta
from django.db.models import Sum, Count, F
from django.db.models.functions import ExtractHour, ExtractWeekDay, TruncDate, TruncMonth, ExtractMonth
from django.utils import timezone
from rest_framework.response import Response
from rest_framework import status
from audio.models import Audio
from channel.models import Channel
from download.models import DownloadQueue
from stats.models import ListeningHistory, Achievement
from stats.achievements import AchievementService
from stats.serializers import (
    AudioStatsSerializer,
    ChannelStatsSerializer,
    DownloadStatsSerializer,
    ListeningInsightsSerializer,
    ListeningHistorySerializer,
    AchievementSerializer,
    AchievementProgressSerializer,
    YearlyWrappedSerializer,
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
        artist = audio.artist if audio.artist else audio.channel_name
        # Try to parse artist from title if it contains " - "
        if not audio.artist and ' - ' in audio.title:
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
            genre=audio.genre or '',
            duration_listened=duration_listened,
            completed=completed,
        )
        
        # Also update play count on the audio
        audio.play_count += 1
        audio.last_played = timezone.now()
        audio.save(update_fields=['play_count', 'last_played'])
        
        # Check for new achievements
        service = AchievementService(request.user)
        new_achievements = service.check_after_listen(audio)
        
        response_data = ListeningHistorySerializer(entry).data
        
        # Include new achievements if any
        if new_achievements:
            response_data['new_achievements'] = AchievementSerializer(new_achievements, many=True).data
        
        return Response(response_data, status=status.HTTP_201_CREATED)


class ListeningHistoryView(ApiBaseView):
    """View and manage listening history"""
    
    def get(self, request):
        """Get paginated listening history"""
        page = int(request.query_params.get('page', 1))
        page_size = int(request.query_params.get('page_size', 50))
        
        # Optional date filter for specific day
        date_filter = request.query_params.get('date')
        
        history = ListeningHistory.objects.filter(
            user=request.user
        ).select_related('audio').order_by('-listened_at')
        
        if date_filter:
            try:
                filter_date = datetime.strptime(date_filter, '%Y-%m-%d').date()
                history = history.filter(listened_at__date=filter_date)
            except ValueError:
                pass
        
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


class OnThisDayView(ApiBaseView):
    """Get listening history from the same day in previous periods"""
    
    def get(self, request):
        """Get tracks listened to on this day in the past"""
        user = request.user
        today = timezone.now()
        
        # Get dates to check
        periods = []
        
        # One year ago
        try:
            one_year_ago = today.replace(year=today.year - 1)
            periods.append({
                'label': 'One Year Ago',
                'date': one_year_ago,
                'key': 'one_year_ago'
            })
        except ValueError:
            # Handle leap year issues
            pass
        
        # One month ago
        one_month_ago = today - timedelta(days=30)
        periods.append({
            'label': 'One Month Ago',
            'date': one_month_ago,
            'key': 'one_month_ago'
        })
        
        # One week ago
        one_week_ago = today - timedelta(days=7)
        periods.append({
            'label': 'One Week Ago',
            'date': one_week_ago,
            'key': 'one_week_ago'
        })
        
        results = {}
        
        for period in periods:
            check_date = period['date'].date()
            history = ListeningHistory.objects.filter(
                user=user,
                listened_at__date=check_date
            ).select_related('audio').order_by('-listened_at')[:20]
            
            if history.exists():
                serializer = ListeningHistorySerializer(history, many=True)
                results[period['key']] = {
                    'label': period['label'],
                    'date': check_date.isoformat(),
                    'tracks': serializer.data,
                    'count': history.count()
                }
        
        return Response(results)


class AchievementsView(ApiBaseView):
    """View and manage achievements"""
    
    def get(self, request):
        """Get all user achievements"""
        include_progress = request.query_params.get('progress', 'false').lower() == 'true'
        unseen_only = request.query_params.get('unseen', 'false').lower() == 'true'
        
        if include_progress:
            # Return all achievements with progress
            progress = AchievementService.get_achievement_progress(request.user)
            serializer = AchievementProgressSerializer(progress, many=True)
            return Response(serializer.data)
        
        # Return unlocked achievements
        achievements = Achievement.objects.filter(user=request.user)
        
        if unseen_only:
            achievements = achievements.filter(seen=False)
        
        serializer = AchievementSerializer(achievements, many=True)
        return Response(serializer.data)
    
    def post(self, request):
        """Check for new achievements"""
        service = AchievementService(request.user)
        new_achievements = service.check_all_achievements()
        
        serializer = AchievementSerializer(new_achievements, many=True)
        return Response({
            'new_achievements': serializer.data,
            'total_new': len(new_achievements)
        })
    
    def patch(self, request):
        """Mark achievements as seen"""
        achievement_ids = request.data.get('ids', [])
        mark_all = request.data.get('all', False)
        
        if mark_all:
            count = Achievement.objects.filter(user=request.user, seen=False).update(seen=True)
        else:
            count = Achievement.objects.filter(
                user=request.user, 
                id__in=achievement_ids
            ).update(seen=True)
        
        return Response({'marked_seen': count})


class StreakView(ApiBaseView):
    """Get current streak information"""
    
    def get(self, request):
        """Get streak info including current, longest, and recent activity"""
        user = request.user
        
        # Get all dates with listening activity
        history = ListeningHistory.objects.filter(user=user)
        dates_with_listening = set(
            history.annotate(date=TruncDate('listened_at'))
            .values_list('date', flat=True)
            .distinct()
        )
        
        today = timezone.localtime().date()
        
        # Current streak
        current_streak = 0
        check_date = today
        while check_date in dates_with_listening:
            current_streak += 1
            check_date -= timedelta(days=1)
        
        # If no listening today, check yesterday
        listened_today = today in dates_with_listening
        if not listened_today:
            yesterday = today - timedelta(days=1)
            if yesterday in dates_with_listening:
                # Streak is at risk!
                current_streak = 0
                check_date = yesterday
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
                    longest_streak = max(longest_streak, streak)
                else:
                    streak = 1
            longest_streak = max(longest_streak, streak)
        
        # Recent 7 days activity
        recent_days = []
        for i in range(6, -1, -1):  # 6 days ago to today
            check_date = today - timedelta(days=i)
            day_history = history.filter(listened_at__date=check_date)
            recent_days.append({
                'date': check_date.isoformat(),
                'day_name': check_date.strftime('%a'),
                'has_activity': check_date in dates_with_listening,
                'tracks_played': day_history.count(),
            })
        
        # Streak milestones
        streak_milestones = [3, 7, 14, 30, 60, 90, 180, 365]
        next_milestone = None
        for milestone in streak_milestones:
            if current_streak < milestone:
                next_milestone = milestone
                break
        
        return Response({
            'current_streak': current_streak,
            'longest_streak': longest_streak,
            'listened_today': listened_today,
            'streak_at_risk': not listened_today and current_streak > 0,
            'next_milestone': next_milestone,
            'days_to_milestone': next_milestone - current_streak if next_milestone else None,
            'recent_days': recent_days,
        })


class YearlyWrappedView(ApiBaseView):
    """Yearly Wrapped - Spotify-style year in review"""
    
    def get(self, request):
        """Get yearly wrapped summary"""
        year = int(request.query_params.get('year', timezone.now().year))
        user = request.user
        
        # Get all listening history for the year
        start_date = datetime(year, 1, 1, tzinfo=timezone.utc)
        end_date = datetime(year, 12, 31, 23, 59, 59, tzinfo=timezone.utc)
        
        history = ListeningHistory.objects.filter(
            user=user,
            listened_at__gte=start_date,
            listened_at__lte=end_date
        )
        
        if not history.exists():
            return Response({
                'error': f'No listening data found for {year}',
                'year': year
            }, status=status.HTTP_404_NOT_FOUND)
        
        # Basic stats
        total_seconds = history.aggregate(total=Sum('duration_listened'))['total'] or 0
        total_minutes = total_seconds // 60
        total_tracks = history.count()
        unique_tracks = history.values('audio').distinct().count()
        unique_artists = history.exclude(artist='').values('artist').distinct().count()
        unique_channels = history.values('channel_name').distinct().count()
        
        # Streaks for the year
        dates_with_listening = set(
            history.annotate(date=TruncDate('listened_at'))
            .values_list('date', flat=True)
            .distinct()
        )
        total_listening_days = len(dates_with_listening)
        
        # Calculate longest streak for the year
        longest_streak = 0
        if dates_with_listening:
            sorted_dates = sorted(dates_with_listening)
            streak = 1
            for i in range(1, len(sorted_dates)):
                if sorted_dates[i] - sorted_dates[i-1] == timedelta(days=1):
                    streak += 1
                    longest_streak = max(longest_streak, streak)
                else:
                    streak = 1
            longest_streak = max(longest_streak, streak)
        
        # Top artist
        top_artists = history.exclude(artist='').values('artist').annotate(
            play_count=Count('id'),
            total_duration=Sum('duration_listened')
        ).order_by('-play_count')[:5]
        
        top_artist = None
        if top_artists:
            top_artist = {
                'artist': top_artists[0]['artist'],
                'play_count': top_artists[0]['play_count'],
                'total_minutes': (top_artists[0]['total_duration'] or 0) // 60
            }
        
        # Top channel
        top_channels = history.values('channel_name').annotate(
            play_count=Count('id'),
            total_duration=Sum('duration_listened')
        ).order_by('-play_count')[:1]
        
        top_channel = None
        if top_channels:
            top_channel = {
                'channel_name': top_channels[0]['channel_name'],
                'play_count': top_channels[0]['play_count'],
                'total_minutes': (top_channels[0]['total_duration'] or 0) // 60
            }
        
        # Top tracks
        top_tracks = history.values(
            'title', 'artist', 'audio__youtube_id', 'audio__thumbnail_url'
        ).annotate(
            play_count=Count('id'),
            total_duration=Sum('duration_listened')
        ).order_by('-play_count')[:5]
        
        top_track = None
        if top_tracks:
            top_track = {
                'title': top_tracks[0]['title'],
                'artist': top_tracks[0]['artist'],
                'youtube_id': top_tracks[0]['audio__youtube_id'],
                'thumbnail_url': top_tracks[0]['audio__thumbnail_url'] or '',
                'play_count': top_tracks[0]['play_count'],
            }
        
        top_5_tracks = [
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
        
        top_5_artists = [
            {
                'artist': a['artist'],
                'play_count': a['play_count'],
                'total_duration': a['total_duration'] or 0,
            }
            for a in top_artists
        ]
        
        # Peak month
        monthly_data = history.annotate(
            month=ExtractMonth('listened_at')
        ).values('month').annotate(
            play_count=Count('id'),
            total_duration=Sum('duration_listened')
        ).order_by('month')
        
        month_names = ['', 'January', 'February', 'March', 'April', 'May', 'June',
                       'July', 'August', 'September', 'October', 'November', 'December']
        
        peak_month = ''
        monthly_minutes = []
        max_month_plays = 0
        
        for m in range(1, 13):
            month_data = next((d for d in monthly_data if d['month'] == m), None)
            minutes = (month_data['total_duration'] // 60) if month_data else 0
            plays = month_data['play_count'] if month_data else 0
            monthly_minutes.append({
                'month': month_names[m],
                'month_num': m,
                'minutes': minutes,
                'plays': plays
            })
            if plays > max_month_plays:
                max_month_plays = plays
                peak_month = month_names[m]
        
        # Peak day of week
        day_names = ['', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
        by_weekday = history.annotate(
            weekday=ExtractWeekDay('listened_at')
        ).values('weekday').annotate(
            play_count=Count('id')
        ).order_by('-play_count')
        
        peak_day = ''
        if by_weekday:
            peak_day = day_names[by_weekday[0]['weekday']] if by_weekday[0]['weekday'] <= 7 else ''
        
        # Peak hour
        by_hour = history.annotate(
            hour=ExtractHour('listened_at')
        ).values('hour').annotate(
            play_count=Count('id')
        ).order_by('-play_count')
        
        peak_hour = by_hour[0]['hour'] if by_hour else None
        
        # Listening personality
        personality = self._determine_listening_personality(
            total_tracks, unique_artists, peak_hour, longest_streak
        )
        
        # Achievements unlocked this year
        achievements_unlocked = Achievement.objects.filter(
            user=user,
            unlocked_at__gte=start_date,
            unlocked_at__lte=end_date
        ).count()
        
        data = {
            'year': year,
            'total_minutes_listened': total_minutes,
            'total_tracks_played': total_tracks,
            'total_unique_tracks': unique_tracks,
            'total_unique_artists': unique_artists,
            'total_unique_channels': unique_channels,
            'longest_streak': longest_streak,
            'total_listening_days': total_listening_days,
            'top_artist': top_artist,
            'top_channel': top_channel,
            'top_track': top_track,
            'top_5_artists': top_5_artists,
            'top_5_tracks': top_5_tracks,
            'listening_personality': personality,
            'peak_month': peak_month,
            'peak_day_of_week': peak_day,
            'peak_hour': peak_hour,
            'monthly_minutes': monthly_minutes,
            'achievements_unlocked': achievements_unlocked,
        }
        
        serializer = YearlyWrappedSerializer(data)
        return Response(serializer.data)
    
    def _determine_listening_personality(self, total_tracks, unique_artists, peak_hour, longest_streak):
        """Determine a fun listening personality based on habits"""
        if longest_streak >= 30:
            return "🔥 Streak Master - Your consistency is legendary!"
        elif peak_hour and 0 <= peak_hour < 6:
            return "🦉 Night Owl - The night is your symphony"
        elif peak_hour and 5 <= peak_hour < 9:
            return "🐦 Early Bird - Music starts your day right"
        elif unique_artists > 100:
            return "🌍 Musical Explorer - You love discovering new sounds"
        elif unique_artists < 20 and total_tracks > 500:
            return "💖 Devoted Fan - Loyalty is your middle name"
        elif total_tracks > 2000:
            return "🎵 Audio Addict - Music is your constant companion"
        elif total_tracks > 500:
            return "🎧 Dedicated Listener - Music is a big part of your life"
        else:
            return "🌱 Rising Star - Your musical journey is just beginning"
