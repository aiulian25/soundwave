"""Audio recommendations views"""

from django.db.models import Count, Sum, F, Q, Avg
from django.utils import timezone
from datetime import timedelta
from rest_framework.response import Response
from rest_framework import status
from common.views import ApiBaseView
from audio.models import Audio
from audio.serializers import AudioSerializer
import random
import re


class AudioRecommendationsView(ApiBaseView):
    """Get personalized audio recommendations based on listening history and current track context"""
    
    def get(self, request, youtube_id):
        try:
            # Get the current audio track
            current_audio = Audio.objects.get(youtube_id=youtube_id, owner=request.user)
        except Audio.DoesNotExist:
            return Response(
                {'error': 'Audio track not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        recommendations = []
        
        # 1. Same channel recommendations (50% weight) - PRIORITIZE SAME ARTIST
        same_channel_tracks = self.get_same_channel_recommendations(request.user, current_audio)
        recommendations.extend(same_channel_tracks[:5])
        
        # 2. Title/content similarity recommendations (25% weight) - Find similar content
        similar_content_tracks = self.get_similar_content_recommendations(request.user, current_audio)
        recommendations.extend(similar_content_tracks[:3])
        
        # 3. Similar duration/style tracks (15% weight)
        similar_duration_tracks = self.get_similar_duration_tracks(request.user, current_audio)
        recommendations.extend(similar_duration_tracks[:2])
        
        # 4. Favorited channels that match context (10% weight)
        contextual_favorites = self.get_contextual_favorite_tracks(request.user, current_audio)
        recommendations.extend(contextual_favorites[:1])
        
        # Remove duplicates while preserving order
        seen = set()
        unique_recommendations = []
        for track in recommendations:
            if track.id not in seen:
                seen.add(track.id)
                unique_recommendations.append(track)
        
        # Limit to 10 recommendations
        final_recommendations = unique_recommendations[:10]
        
        # If we have fewer than 10, fill with random tracks from user's library
        if len(final_recommendations) < 10:
            additional_tracks = self.get_random_tracks(
                request.user, 
                current_audio, 
                exclude_ids=seen,
                count=10 - len(final_recommendations)
            )
            final_recommendations.extend(additional_tracks)
        
        serializer = AudioSerializer(final_recommendations, many=True)
        return Response({
            'recommendations': serializer.data,
            'total': len(final_recommendations),
            'based_on': current_audio.title,
            'algorithm_weights': {
                'same_channel': 50,
                'similar_content': 25,  
                'similar_duration': 15,
                'contextual_favorites': 10
            }
        })
    
    def get_same_channel_recommendations(self, user, current_audio):
        """Get recommendations from the same channel as current track"""
        return Audio.objects.filter(
            owner=user,
            channel_id=current_audio.channel_id
        ).exclude(
            id=current_audio.id
        ).order_by('-play_count', '-published_date')
    
    def get_similar_content_recommendations(self, user, current_audio):
        """Get recommendations based on title keywords - find similar content"""
        # Extract keywords from title (remove common words)
        title_words = re.sub(r'[^\w\s]', '', current_audio.title.lower()).split()
        stop_words = {'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 
                      'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'been', 'be',
                      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
                      'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
                      'ought', 'used', 'official', 'video', 'audio', 'lyrics', 'hd', 'hq',
                      'full', 'album', 'live', 'version', 'remastered', 'remix'}
        
        keywords = [w for w in title_words if w not in stop_words and len(w) > 2]
        
        if not keywords:
            return []
        
        # Build Q objects for title matching
        q_objects = Q()
        for keyword in keywords[:5]:  # Use top 5 keywords
            q_objects |= Q(title__icontains=keyword)
        
        return Audio.objects.filter(
            owner=user
        ).filter(q_objects).exclude(
            id=current_audio.id,
            channel_id=current_audio.channel_id  # Exclude same channel (handled separately)
        ).order_by('-play_count')[:10]
    
    def get_similar_duration_tracks(self, user, current_audio):
        """Get tracks with similar duration (likely similar style/format)"""
        duration = current_audio.duration
        # Allow 20% variance in duration
        min_duration = int(duration * 0.8)
        max_duration = int(duration * 1.2)
        
        return Audio.objects.filter(
            owner=user,
            duration__gte=min_duration,
            duration__lte=max_duration
        ).exclude(
            id=current_audio.id,
            channel_id=current_audio.channel_id
        ).order_by('-play_count', '-published_date')[:10]
    
    def get_contextual_favorite_tracks(self, user, current_audio):
        """Get favorite tracks that might be contextually relevant"""
        # Get favorited tracks from different channels, preferring those with similar keywords
        title_words = re.sub(r'[^\w\s]', '', current_audio.title.lower()).split()
        
        favorites = Audio.objects.filter(
            owner=user,
            is_favorite=True
        ).exclude(
            id=current_audio.id,
            channel_id=current_audio.channel_id
        )
        
        # Try to find favorites with matching keywords first
        for word in title_words:
            if len(word) > 3:
                matching = favorites.filter(title__icontains=word)
                if matching.exists():
                    return matching.order_by('-play_count')[:5]
        
        # Fall back to any favorites
        return favorites.order_by('-play_count')[:5]
    
    def get_random_tracks(self, user, current_audio, exclude_ids, count):
        """Get random tracks to fill remaining recommendation slots"""
        available_tracks = Audio.objects.filter(
            owner=user
        ).exclude(
            Q(id=current_audio.id) | Q(id__in=exclude_ids)
        )
        
        # Get random tracks (limit query first for performance)
        track_count = available_tracks.count()
        if track_count == 0:
            return []
        
        # Get random sample
        random_indices = random.sample(
            range(min(track_count, 50)),  # Limit to 50 for performance
            min(count, track_count, 50)
        )
        
        tracks = list(available_tracks[:50])  # Convert to list for indexing
        return [tracks[i] for i in random_indices if i < len(tracks)]


class AudioSimilarTracksView(ApiBaseView):
    """Get tracks similar to the current one (simpler version)"""
    
    def get(self, request, youtube_id):
        try:
            current_audio = Audio.objects.get(youtube_id=youtube_id, owner=request.user)
        except Audio.DoesNotExist:
            return Response(
                {'error': 'Audio track not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Simple similarity: same channel, exclude current track
        similar_tracks = Audio.objects.filter(
            owner=request.user,
            channel_id=current_audio.channel_id
        ).exclude(
            id=current_audio.id
        ).order_by('-play_count', '-published_date')[:8]
        
        serializer = AudioSerializer(similar_tracks, many=True)
        return Response({
            'similar_tracks': serializer.data,
            'based_on_channel': current_audio.channel_name,
            'total': len(similar_tracks)
        })