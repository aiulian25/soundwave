"""Smart Radio / Auto-DJ API views"""

from django.db.models import Count, Q, F
from django.utils import timezone
from rest_framework.response import Response
from rest_framework import status
from common.views import ApiBaseView
from audio.models import Audio
from audio.models_radio import RadioSession, RadioTrackFeedback
from audio.serializers import AudioSerializer
from audio.serializers_radio import (
    RadioSessionSerializer,
    StartRadioSerializer,
    RadioFeedbackSerializer,
)
import random
import re


class RadioStartView(ApiBaseView):
    """Start a new radio session"""
    
    def post(self, request):
        serializer = StartRadioSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                {'error': 'Invalid data', 'details': serializer.errors},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        data = serializer.validated_data
        mode = data['mode']
        variety_level = data.get('variety_level', 50)
        
        # Get seed track/channel info
        seed_youtube_id = data.get('seed_youtube_id', '')
        seed_channel_id = data.get('seed_channel_id', '')
        seed_title = ''
        seed_artist = ''
        
        # Validate seed track exists
        if mode == 'track' and seed_youtube_id:
            try:
                seed_audio = Audio.objects.get(youtube_id=seed_youtube_id, owner=request.user)
                seed_title = seed_audio.title
                seed_artist = seed_audio.artist or seed_audio.channel_name
                seed_channel_id = seed_audio.channel_id
            except Audio.DoesNotExist:
                return Response(
                    {'error': 'Seed track not found'},
                    status=status.HTTP_404_NOT_FOUND
                )
        
        # For artist mode, get channel info
        if mode == 'artist' and seed_channel_id:
            channel_audio = Audio.objects.filter(
                channel_id=seed_channel_id, owner=request.user
            ).first()
            if channel_audio:
                seed_artist = channel_audio.artist or channel_audio.channel_name
                seed_title = f"Radio based on {seed_artist}"
        
        # For favorites/discovery/recent modes
        if mode == 'favorites':
            seed_title = "Favorites Mix"
            seed_artist = "Your favorite tracks"
        elif mode == 'discovery':
            seed_title = "Discovery Radio"
            seed_artist = "Explore your library"
        elif mode == 'recent':
            seed_title = "Recently Added"
            seed_artist = "Your newest tracks"
        
        # Create or update radio session
        session, created = RadioSession.objects.update_or_create(
            user=request.user,
            defaults={
                'mode': mode,
                'seed_youtube_id': seed_youtube_id,
                'seed_channel_id': seed_channel_id,
                'seed_title': seed_title,
                'seed_artist': seed_artist,
                'is_active': True,
                'current_youtube_id': seed_youtube_id,
                'played_youtube_ids': [seed_youtube_id] if seed_youtube_id else [],
                'skipped_youtube_ids': [],
                'variety_level': variety_level,
            }
        )
        
        # Get the first track (seed track or auto-selected)
        if mode == 'track' and seed_youtube_id:
            first_track = seed_audio
        else:
            first_track = self._get_first_track_for_mode(request.user, mode, seed_channel_id)
            if first_track:
                session.current_youtube_id = first_track.youtube_id
                session.played_youtube_ids = [first_track.youtube_id]
                session.save()
        
        session_data = RadioSessionSerializer(session).data
        
        return Response({
            'message': 'Radio started',
            'session': session_data,
            'first_track': AudioSerializer(first_track).data if first_track else None,
        })
    
    def _get_first_track_for_mode(self, user, mode, seed_channel_id=None):
        """Get the first track for non-track modes"""
        if mode == 'artist' and seed_channel_id:
            return Audio.objects.filter(
                owner=user, channel_id=seed_channel_id
            ).order_by('-play_count').first()
        elif mode == 'favorites':
            return Audio.objects.filter(
                owner=user, is_favorite=True
            ).order_by('?').first()
        elif mode == 'discovery':
            return Audio.objects.filter(
                owner=user, play_count__lt=3
            ).order_by('?').first()
        elif mode == 'recent':
            return Audio.objects.filter(
                owner=user
            ).order_by('-downloaded_date').first()
        return None


class RadioStopView(ApiBaseView):
    """Stop the current radio session"""
    
    def post(self, request):
        try:
            session = RadioSession.objects.get(user=request.user)
            session.is_active = False
            session.save()
            
            return Response({
                'message': 'Radio stopped',
                'tracks_played': len(session.played_youtube_ids),
                'tracks_skipped': len(session.skipped_youtube_ids),
            })
        except RadioSession.DoesNotExist:
            return Response({
                'message': 'No active radio session',
            })


class RadioStatusView(ApiBaseView):
    """Get current radio session status"""
    
    def get(self, request):
        try:
            session = RadioSession.objects.get(user=request.user)
            
            # Get current track details
            current_track = None
            if session.current_youtube_id:
                try:
                    audio = Audio.objects.get(
                        youtube_id=session.current_youtube_id,
                        owner=request.user
                    )
                    current_track = AudioSerializer(audio).data
                except Audio.DoesNotExist:
                    pass
            
            return Response({
                'has_session': True,
                'session': RadioSessionSerializer(session).data,
                'current_track': current_track,
            })
        except RadioSession.DoesNotExist:
            return Response({
                'has_session': False,
                'session': None,
                'current_track': None,
            })


class RadioNextTrackView(ApiBaseView):
    """Get the next track for the radio"""
    
    def get(self, request):
        try:
            session = RadioSession.objects.get(user=request.user, is_active=True)
        except RadioSession.DoesNotExist:
            return Response(
                {'error': 'No active radio session'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Get next track based on mode and learning
        next_track, reason = self._get_next_track(request.user, session)
        
        if not next_track:
            return Response(
                {'error': 'No more tracks available', 'suggestion': 'Download more music or reset radio'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Update session
        session.add_to_history(next_track.youtube_id, was_skipped=False)
        
        return Response({
            'track': AudioSerializer(next_track).data,
            'queue_position': len(session.played_youtube_ids),
            'total_played': len(session.played_youtube_ids),
            'radio_mode': session.mode,
            'seed_title': session.seed_title,
            'reason': reason,
        })
    
    def _get_next_track(self, user, session):
        """Smart track selection based on mode, history, and learning"""
        excluded_ids = session.get_excluded_ids()
        variety = session.variety_level / 100.0  # 0.0 to 1.0
        
        # Get base queryset excluding already played/skipped
        base_qs = Audio.objects.filter(owner=user).exclude(
            youtube_id__in=excluded_ids
        )
        
        # Apply channel preferences (boost liked, reduce disliked)
        if session.disliked_channels:
            # Reduce chance of disliked channels but don't fully exclude
            if random.random() > 0.2:  # 80% chance to exclude disliked channels
                base_qs = base_qs.exclude(channel_id__in=session.disliked_channels)
        
        candidates = []
        reasons = []
        
        if session.mode == 'track':
            candidates, reasons = self._get_track_mode_candidates(user, session, base_qs, variety)
        elif session.mode == 'artist':
            candidates, reasons = self._get_artist_mode_candidates(user, session, base_qs, variety)
        elif session.mode == 'favorites':
            candidates, reasons = self._get_favorites_mode_candidates(user, session, base_qs, variety)
        elif session.mode == 'discovery':
            candidates, reasons = self._get_discovery_mode_candidates(user, session, base_qs, variety)
        elif session.mode == 'recent':
            candidates, reasons = self._get_recent_mode_candidates(user, session, base_qs, variety)
        
        # If we have candidates, pick one with weighted randomness
        if candidates:
            # Boost liked channels
            weighted_candidates = []
            weighted_reasons = []
            for track, reason in zip(candidates, reasons):
                weight = 1
                if track.channel_id in session.liked_channels:
                    weight = 2  # Double chance for liked channels
                if track.is_favorite:
                    weight += 1  # Bonus for favorites
                for _ in range(weight):
                    weighted_candidates.append(track)
                    weighted_reasons.append(reason)
            
            if weighted_candidates:
                idx = random.randrange(len(weighted_candidates))
                return weighted_candidates[idx], weighted_reasons[idx]
        
        # Fallback: any track from library
        fallback = base_qs.order_by('?').first()
        return fallback, "Random from library" if fallback else None
    
    def _get_track_mode_candidates(self, user, session, base_qs, variety):
        """Get candidates for track-based radio"""
        candidates = []
        reasons = []
        
        # Get seed track for reference
        seed_audio = None
        if session.seed_youtube_id:
            try:
                seed_audio = Audio.objects.get(youtube_id=session.seed_youtube_id, owner=user)
            except Audio.DoesNotExist:
                pass
        
        # 1. Same channel/artist (high priority when variety is low)
        if seed_audio and random.random() > variety * 0.7:
            same_channel = base_qs.filter(channel_id=seed_audio.channel_id).order_by('-play_count')[:5]
            for track in same_channel:
                candidates.append(track)
                reasons.append(f"Same artist: {track.channel_name}")
        
        # 2. Similar content (keywords from title)
        if seed_audio:
            similar = self._find_similar_by_title(seed_audio, base_qs)[:5]
            for track in similar:
                candidates.append(track)
                reasons.append("Similar content")
        
        # 3. Similar duration
        if seed_audio:
            duration = seed_audio.duration
            similar_duration = base_qs.filter(
                duration__gte=int(duration * 0.7),
                duration__lte=int(duration * 1.3)
            ).order_by('-play_count')[:3]
            for track in similar_duration:
                candidates.append(track)
                reasons.append("Similar length")
        
        # 4. From liked channels
        if session.liked_channels:
            liked_tracks = base_qs.filter(channel_id__in=session.liked_channels).order_by('?')[:3]
            for track in liked_tracks:
                candidates.append(track)
                reasons.append("From a channel you like")
        
        # 5. Add some variety/randomness based on variety level
        if variety > 0.3:
            random_count = int(variety * 5)
            random_tracks = base_qs.order_by('?')[:random_count]
            for track in random_tracks:
                candidates.append(track)
                reasons.append("Discover something new")
        
        return candidates, reasons
    
    def _get_artist_mode_candidates(self, user, session, base_qs, variety):
        """Get candidates for artist-based radio"""
        candidates = []
        reasons = []
        
        # Primary: tracks from the seed artist/channel
        if session.seed_channel_id:
            artist_tracks = base_qs.filter(channel_id=session.seed_channel_id).order_by('-play_count')
            for track in artist_tracks[:8]:
                candidates.append(track)
                reasons.append(f"By {session.seed_artist}")
        
        # Add variety from similar artists (based on title keywords)
        if variety > 0.2 and session.seed_channel_id:
            # Get typical titles from this artist to find similar content
            artist_titles = Audio.objects.filter(
                owner=user, channel_id=session.seed_channel_id
            ).values_list('title', flat=True)[:5]
            
            for title in artist_titles:
                similar = self._find_similar_by_title_string(title, base_qs.exclude(channel_id=session.seed_channel_id))[:2]
                for track in similar:
                    candidates.append(track)
                    reasons.append("Similar style")
        
        return candidates, reasons
    
    def _get_favorites_mode_candidates(self, user, session, base_qs, variety):
        """Get candidates for favorites mix"""
        candidates = []
        reasons = []
        
        # Primary: favorite tracks
        favorites = base_qs.filter(is_favorite=True).order_by('?')
        for track in favorites[:8]:
            candidates.append(track)
            reasons.append("One of your favorites")
        
        # Add some non-favorites for discovery
        if variety > 0.3:
            non_favorites = base_qs.filter(is_favorite=False).order_by('-play_count')[:3]
            for track in non_favorites:
                candidates.append(track)
                reasons.append("Popular in your library")
        
        return candidates, reasons
    
    def _get_discovery_mode_candidates(self, user, session, base_qs, variety):
        """Get candidates for discovery mode - find underplayed tracks"""
        candidates = []
        reasons = []
        
        # Primary: rarely played tracks
        rarely_played = base_qs.filter(play_count__lt=3).order_by('?')
        for track in rarely_played[:6]:
            candidates.append(track)
            reasons.append("Rediscover this track")
        
        # Never played
        never_played = base_qs.filter(play_count=0).order_by('?')
        for track in never_played[:4]:
            candidates.append(track)
            reasons.append("You haven't played this yet")
        
        # Mix in some favorites to keep it enjoyable
        favorites = base_qs.filter(is_favorite=True).order_by('?')[:2]
        for track in favorites:
            candidates.append(track)
            reasons.append("A favorite to keep things fresh")
        
        return candidates, reasons
    
    def _get_recent_mode_candidates(self, user, session, base_qs, variety):
        """Get candidates for recently added mode"""
        candidates = []
        reasons = []
        
        # Primary: recently downloaded
        recent = base_qs.order_by('-downloaded_date')
        for track in recent[:8]:
            candidates.append(track)
            reasons.append("Recently added")
        
        # Mix in some older favorites
        if variety > 0.4:
            favorites = base_qs.filter(is_favorite=True).order_by('?')[:2]
            for track in favorites:
                candidates.append(track)
                reasons.append("An old favorite")
        
        return candidates, reasons
    
    def _find_similar_by_title(self, seed_audio, queryset):
        """Find tracks with similar title keywords"""
        return self._find_similar_by_title_string(seed_audio.title, queryset)
    
    def _find_similar_by_title_string(self, title, queryset):
        """Find tracks with similar title keywords from a string"""
        # Extract keywords
        title_words = re.sub(r'[^\w\s]', '', title.lower()).split()
        stop_words = {
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
            'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'been', 'be',
            'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
            'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
            'ought', 'used', 'official', 'video', 'audio', 'lyrics', 'hd', 'hq',
            'full', 'album', 'live', 'version', 'remastered', 'remix', 'ft', 'feat'
        }
        
        keywords = [w for w in title_words if w not in stop_words and len(w) > 2]
        
        if not keywords:
            return queryset.none()
        
        # Build Q objects
        q_objects = Q()
        for keyword in keywords[:4]:
            q_objects |= Q(title__icontains=keyword)
        
        return queryset.filter(q_objects)


class RadioSkipView(ApiBaseView):
    """Report that a track was skipped"""
    
    def post(self, request):
        try:
            session = RadioSession.objects.get(user=request.user, is_active=True)
        except RadioSession.DoesNotExist:
            return Response(
                {'error': 'No active radio session'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        youtube_id = request.data.get('youtube_id')
        listen_duration = request.data.get('listen_duration', 0)
        track_duration = request.data.get('track_duration', 0)
        
        if not youtube_id:
            return Response(
                {'error': 'youtube_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Get track info for learning
        try:
            audio = Audio.objects.get(youtube_id=youtube_id, owner=request.user)
            channel_id = audio.channel_id
            
            # Learn from skip - if skipped early, mark channel as less preferred
            if track_duration > 0 and listen_duration / track_duration < 0.3:
                session.learn_from_channel(channel_id, positive=False)
            
        except Audio.DoesNotExist:
            channel_id = ''
        
        # Record skip
        session.add_to_history(youtube_id, was_skipped=True)
        
        # Store feedback for future learning
        RadioTrackFeedback.objects.create(
            user=request.user,
            youtube_id=youtube_id,
            channel_id=channel_id,
            feedback_type='skipped',
            seed_youtube_id=session.seed_youtube_id,
            radio_mode=session.mode,
            listen_duration=listen_duration,
            track_duration=track_duration,
        )
        
        return Response({
            'message': 'Skip recorded',
            'learning_applied': True,
        })


class RadioLikeView(ApiBaseView):
    """Report that user liked a track during radio (favorited or played through)"""
    
    def post(self, request):
        try:
            session = RadioSession.objects.get(user=request.user, is_active=True)
        except RadioSession.DoesNotExist:
            return Response(
                {'error': 'No active radio session'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        youtube_id = request.data.get('youtube_id')
        feedback_type = request.data.get('feedback_type', 'played')  # 'played', 'liked', 'repeated'
        listen_duration = request.data.get('listen_duration', 0)
        track_duration = request.data.get('track_duration', 0)
        
        if not youtube_id:
            return Response(
                {'error': 'youtube_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Get track info for learning
        try:
            audio = Audio.objects.get(youtube_id=youtube_id, owner=request.user)
            channel_id = audio.channel_id
            
            # Learn from positive interaction
            session.learn_from_channel(channel_id, positive=True)
            
        except Audio.DoesNotExist:
            channel_id = ''
        
        # Store feedback
        RadioTrackFeedback.objects.create(
            user=request.user,
            youtube_id=youtube_id,
            channel_id=channel_id,
            feedback_type=feedback_type,
            seed_youtube_id=session.seed_youtube_id,
            radio_mode=session.mode,
            listen_duration=listen_duration,
            track_duration=track_duration,
        )
        
        return Response({
            'message': 'Feedback recorded',
            'learning_applied': True,
        })


class RadioSettingsView(ApiBaseView):
    """Update radio settings"""
    
    def get(self, request):
        """Get current radio settings"""
        try:
            session = RadioSession.objects.get(user=request.user)
            return Response({
                'variety_level': session.variety_level,
                'max_history_size': session.max_history_size,
                'liked_channels_count': len(session.liked_channels),
                'disliked_channels_count': len(session.disliked_channels),
            })
        except RadioSession.DoesNotExist:
            return Response({
                'variety_level': 50,
                'max_history_size': 50,
                'liked_channels_count': 0,
                'disliked_channels_count': 0,
            })
    
    def post(self, request):
        """Update radio settings"""
        try:
            session = RadioSession.objects.get(user=request.user)
        except RadioSession.DoesNotExist:
            return Response(
                {'error': 'No radio session exists'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        variety_level = request.data.get('variety_level')
        if variety_level is not None:
            session.variety_level = max(0, min(100, int(variety_level)))
        
        max_history = request.data.get('max_history_size')
        if max_history is not None:
            session.max_history_size = max(10, min(200, int(max_history)))
        
        # Option to reset learning
        if request.data.get('reset_learning'):
            session.liked_channels = []
            session.disliked_channels = []
        
        session.save()
        
        return Response({
            'message': 'Settings updated',
            'variety_level': session.variety_level,
            'max_history_size': session.max_history_size,
        })
