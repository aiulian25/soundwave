"""Achievement checking and unlocking service"""

from datetime import timedelta
from django.db.models import Sum, Count
from django.db.models.functions import TruncDate, ExtractHour, ExtractWeekDay
from django.utils import timezone
from stats.models import Achievement, ListeningHistory, ListeningStreak
from audio.models import Audio


class AchievementService:
    """Service to check and unlock achievements"""
    
    def __init__(self, user):
        self.user = user
        self.new_achievements = []
    
    def check_all_achievements(self):
        """Check and unlock all applicable achievements"""
        self.new_achievements = []
        
        # Get current stats
        stats = self._get_user_stats()
        
        # Check track milestones
        self._check_track_milestones(stats['total_tracks'])
        
        # Check time milestones  
        self._check_time_milestones(stats['total_hours'])
        
        # Check streak milestones
        self._check_streak_milestones(stats['current_streak'], stats['longest_streak'])
        
        # Check variety achievements
        self._check_artist_milestones(stats['unique_artists'])
        self._check_channel_milestones(stats['unique_channels'])
        
        # Check special achievements
        self._check_special_achievements(stats)
        
        return self.new_achievements
    
    def check_after_listen(self, audio):
        """Check achievements after a listening event - lighter weight check"""
        self.new_achievements = []
        
        # Get lightweight stats for immediate checks
        total_tracks = ListeningHistory.objects.filter(user=self.user).count()
        
        # Check track milestones
        self._check_track_milestones(total_tracks)
        
        # Check time-of-day achievements
        now = timezone.localtime()
        hour = now.hour
        
        if 0 <= hour < 5:  # Midnight to 5 AM
            self._unlock_achievement('night_owl')
        if 4 <= hour < 6:  # 4-6 AM
            self._unlock_achievement('early_bird')
        
        # Check streak (update streak record)
        self._update_streak_record()
        
        return self.new_achievements
    
    def _get_user_stats(self):
        """Get comprehensive user stats for achievement checking"""
        history = ListeningHistory.objects.filter(user=self.user)
        
        # Basic counts
        total_tracks = history.count()
        total_seconds = history.aggregate(total=Sum('duration_listened'))['total'] or 0
        total_hours = total_seconds / 3600
        
        # Unique counts
        unique_artists = history.exclude(artist='').values('artist').distinct().count()
        unique_channels = history.values('channel_name').distinct().count()
        unique_genres = history.exclude(genre='').values('genre').distinct().count()
        
        # Completed tracks
        completed_tracks = history.filter(completed=True).count()
        
        # Library size
        library_size = Audio.objects.filter(owner=self.user).count()
        
        # Calculate streaks
        current_streak, longest_streak = self._calculate_streaks()
        
        # Weekend listening
        weekend_tracks = history.annotate(
            weekday=ExtractWeekDay('listened_at')
        ).filter(weekday__in=[1, 7]).count()  # Sunday=1, Saturday=7
        
        # Top artist play count
        top_artist_plays = 0
        top_artist = history.exclude(artist='').values('artist').annotate(
            plays=Count('id')
        ).order_by('-plays').first()
        if top_artist:
            top_artist_plays = top_artist['plays']
        
        return {
            'total_tracks': total_tracks,
            'total_hours': total_hours,
            'unique_artists': unique_artists,
            'unique_channels': unique_channels,
            'unique_genres': unique_genres,
            'completed_tracks': completed_tracks,
            'library_size': library_size,
            'current_streak': current_streak,
            'longest_streak': longest_streak,
            'weekend_tracks': weekend_tracks,
            'top_artist_plays': top_artist_plays,
            'top_artist': top_artist['artist'] if top_artist else None,
        }
    
    def _calculate_streaks(self):
        """Calculate current and longest listening streaks"""
        # Get all dates with listening activity
        history = ListeningHistory.objects.filter(user=self.user)
        dates_with_listening = set(
            history.annotate(date=TruncDate('listened_at'))
            .values_list('date', flat=True)
            .distinct()
        )
        
        if not dates_with_listening:
            return 0, 0
        
        today = timezone.localtime().date()
        
        # Current streak - count backwards from today
        current_streak = 0
        check_date = today
        while check_date in dates_with_listening:
            current_streak += 1
            check_date -= timedelta(days=1)
        
        # If no listening today, check if streak continues from yesterday
        if today not in dates_with_listening:
            yesterday = today - timedelta(days=1)
            if yesterday in dates_with_listening:
                current_streak = 0
                check_date = yesterday
                while check_date in dates_with_listening:
                    current_streak += 1
                    check_date -= timedelta(days=1)
        
        # Longest streak
        sorted_dates = sorted(dates_with_listening)
        longest_streak = 1
        current_run = 1
        
        for i in range(1, len(sorted_dates)):
            if sorted_dates[i] - sorted_dates[i-1] == timedelta(days=1):
                current_run += 1
                longest_streak = max(longest_streak, current_run)
            else:
                current_run = 1
        
        return current_streak, longest_streak
    
    def _update_streak_record(self):
        """Update the daily streak record"""
        today = timezone.localtime().date()
        
        streak_record, created = ListeningStreak.objects.get_or_create(
            user=self.user,
            date=today,
            defaults={'tracks_played': 1, 'duration_listened': 0}
        )
        
        if not created:
            streak_record.tracks_played += 1
            streak_record.save(update_fields=['tracks_played'])
        
        # Check streak achievements based on current streak
        current_streak, _ = self._calculate_streaks()
        self._check_streak_milestones(current_streak, current_streak)
    
    def _check_track_milestones(self, total_tracks):
        """Check track listening milestones"""
        thresholds = [
            (10, 'tracks_10'),
            (50, 'tracks_50'),
            (100, 'tracks_100'),
            (500, 'tracks_500'),
            (1000, 'tracks_1000'),
            (5000, 'tracks_5000'),
            (10000, 'tracks_10000'),
        ]
        
        for threshold, achievement_type in thresholds:
            if total_tracks >= threshold:
                self._unlock_achievement(achievement_type)
    
    def _check_time_milestones(self, total_hours):
        """Check listening time milestones"""
        thresholds = [
            (1, 'hours_1'),
            (10, 'hours_10'),
            (24, 'hours_24'),
            (100, 'hours_100'),
            (500, 'hours_500'),
            (1000, 'hours_1000'),
        ]
        
        for threshold, achievement_type in thresholds:
            if total_hours >= threshold:
                self._unlock_achievement(achievement_type)
    
    def _check_streak_milestones(self, current_streak, longest_streak):
        """Check streak milestones"""
        max_streak = max(current_streak, longest_streak)
        thresholds = [
            (3, 'streak_3'),
            (7, 'streak_7'),
            (14, 'streak_14'),
            (30, 'streak_30'),
            (60, 'streak_60'),
            (90, 'streak_90'),
            (180, 'streak_180'),
            (365, 'streak_365'),
        ]
        
        for threshold, achievement_type in thresholds:
            if max_streak >= threshold:
                self._unlock_achievement(achievement_type)
    
    def _check_artist_milestones(self, unique_artists):
        """Check artist variety milestones"""
        thresholds = [
            (10, 'artists_10'),
            (50, 'artists_50'),
            (100, 'artists_100'),
            (500, 'artists_500'),
        ]
        
        for threshold, achievement_type in thresholds:
            if unique_artists >= threshold:
                self._unlock_achievement(achievement_type)
    
    def _check_channel_milestones(self, unique_channels):
        """Check channel variety milestones"""
        thresholds = [
            (5, 'channels_5'),
            (25, 'channels_25'),
            (50, 'channels_50'),
            (100, 'channels_100'),
        ]
        
        for threshold, achievement_type in thresholds:
            if unique_channels >= threshold:
                self._unlock_achievement(achievement_type)
    
    def _check_special_achievements(self, stats):
        """Check special/misc achievements"""
        # Genre Master - 10+ genres
        if stats['unique_genres'] >= 10:
            self._unlock_achievement('genre_master')
        
        # Completionist - 100 completed tracks
        if stats['completed_tracks'] >= 100:
            self._unlock_achievement('completionist')
        
        # Collector - 500+ tracks in library
        if stats['library_size'] >= 500:
            self._unlock_achievement('collector')
        
        # Superfan - 50+ plays of a single artist
        if stats['top_artist_plays'] >= 50 and stats['top_artist']:
            self._unlock_achievement('superfan', {'artist': stats['top_artist']})
        
        # Weekend Warrior - check weekend listening
        if stats['weekend_tracks'] >= 50:
            self._unlock_achievement('weekend_warrior')
    
    def _unlock_achievement(self, achievement_type, context=None):
        """Unlock an achievement if not already unlocked"""
        existing = Achievement.objects.filter(
            user=self.user,
            achievement_type=achievement_type
        ).exists()
        
        if not existing:
            achievement = Achievement.objects.create(
                user=self.user,
                achievement_type=achievement_type,
                context=context or {}
            )
            self.new_achievements.append(achievement)
            return achievement
        return None
    
    @staticmethod
    def get_achievement_progress(user):
        """Get progress towards all achievements"""
        service = AchievementService(user)
        stats = service._get_user_stats()
        details = Achievement.get_achievement_details()
        
        unlocked = set(
            Achievement.objects.filter(user=user).values_list('achievement_type', flat=True)
        )
        
        progress = []
        
        for achievement_type, info in details.items():
            is_unlocked = achievement_type in unlocked
            
            # Calculate progress based on type
            current_value = 0
            if achievement_type.startswith('tracks_'):
                current_value = stats['total_tracks']
            elif achievement_type.startswith('hours_'):
                current_value = stats['total_hours']
            elif achievement_type.startswith('streak_'):
                current_value = max(stats['current_streak'], stats['longest_streak'])
            elif achievement_type.startswith('artists_'):
                current_value = stats['unique_artists']
            elif achievement_type.startswith('channels_'):
                current_value = stats['unique_channels']
            elif achievement_type == 'genre_master':
                current_value = stats['unique_genres']
            elif achievement_type == 'completionist':
                current_value = stats['completed_tracks']
            elif achievement_type == 'collector':
                current_value = stats['library_size']
            elif achievement_type == 'superfan':
                current_value = stats['top_artist_plays']
            elif achievement_type == 'weekend_warrior':
                current_value = stats['weekend_tracks']
            elif achievement_type in ['night_owl', 'early_bird']:
                current_value = 1 if is_unlocked else 0
            
            threshold = info.get('threshold', 1)
            progress_percent = min(100, int((current_value / threshold) * 100)) if threshold > 0 else 100
            
            progress.append({
                'type': achievement_type,
                'name': info['name'],
                'icon': info['icon'],
                'description': info['description'],
                'threshold': threshold,
                'current': current_value,
                'progress': progress_percent,
                'unlocked': is_unlocked,
            })
        
        return progress
