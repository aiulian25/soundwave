"""Views for local audio files"""

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.parsers import MultiPartParser, FormParser
from django.utils import timezone
from django.db.models import Q

from audio.models_local import LocalAudio, LocalAudioPlaylist, LocalAudioPlaylistItem
from audio.serializers_local import (
    LocalAudioSerializer,
    LocalAudioUploadSerializer,
    LocalAudioPlaylistSerializer,
    LocalAudioPlaylistItemSerializer,
)
from common.permissions import IsOwnerOrAdmin


class LocalAudioViewSet(viewsets.ModelViewSet):
    """ViewSet for managing local audio files"""
    permission_classes = [IsAuthenticated, IsOwnerOrAdmin]
    parser_classes = [MultiPartParser, FormParser]
    
    def get_serializer_class(self):
        if self.action == 'create':
            return LocalAudioUploadSerializer
        return LocalAudioSerializer
    
    def get_queryset(self):
        """Filter by user"""
        queryset = LocalAudio.objects.all()
        
        # Regular users see only their files
        if not (self.request.user.is_admin or self.request.user.is_superuser):
            queryset = queryset.filter(owner=self.request.user)
        
        # Search filter
        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(title__icontains=search) |
                Q(artist__icontains=search) |
                Q(album__icontains=search) |
                Q(genre__icontains=search)
            )
        
        # Filter by artist
        artist = self.request.query_params.get('artist')
        if artist:
            queryset = queryset.filter(artist__icontains=artist)
        
        # Filter by album
        album = self.request.query_params.get('album')
        if album:
            queryset = queryset.filter(album__icontains=album)
        
        # Filter by genre
        genre = self.request.query_params.get('genre')
        if genre:
            queryset = queryset.filter(genre__icontains=genre)
        
        # Filter by favorites
        favorites = self.request.query_params.get('favorites')
        if favorites == 'true':
            queryset = queryset.filter(is_favorite=True)
        
        # Filter by tags
        tags = self.request.query_params.get('tags')
        if tags:
            tag_list = tags.split(',')
            for tag in tag_list:
                queryset = queryset.filter(tags__contains=[tag.strip()])
        
        return queryset.order_by('-uploaded_date')
    
    def perform_create(self, serializer):
        """Set owner on creation"""
        user = self.request.user
        
        # Check storage quota
        if not (user.is_admin or user.is_superuser):
            if user.storage_used_gb >= user.storage_quota_gb:
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied(f"Storage quota exceeded ({user.storage_used_gb:.1f} / {user.storage_quota_gb} GB)")
        
        local_audio = serializer.save(owner=user)
        
        # Update user storage
        file_size_gb = local_audio.file_size / (1024 ** 3)
        user.storage_used_gb += file_size_gb
        user.save()
    
    def perform_destroy(self, instance):
        """Update storage on deletion"""
        user = instance.owner
        file_size_gb = instance.file_size / (1024 ** 3)
        
        # Delete the instance
        instance.delete()
        
        # Update user storage
        user.storage_used_gb = max(0, user.storage_used_gb - file_size_gb)
        user.save()
    
    @action(detail=True, methods=['post'])
    def play(self, request, pk=None):
        """Increment play count"""
        audio = self.get_object()
        audio.play_count += 1
        audio.last_played = timezone.now()
        audio.save()
        
        return Response({'message': 'Play count updated'})
    
    @action(detail=True, methods=['post'])
    def toggle_favorite(self, request, pk=None):
        """Toggle favorite status"""
        audio = self.get_object()
        audio.is_favorite = not audio.is_favorite
        audio.save()
        
        return Response({
            'message': 'Favorite status updated',
            'is_favorite': audio.is_favorite
        })
    
    @action(detail=False, methods=['get'])
    def artists(self, request):
        """Get list of artists"""
        queryset = self.get_queryset()
        artists = queryset.values_list('artist', flat=True).distinct().order_by('artist')
        artists = [a for a in artists if a]  # Remove empty strings
        
        return Response(artists)
    
    @action(detail=False, methods=['get'])
    def albums(self, request):
        """Get list of albums"""
        queryset = self.get_queryset()
        albums = queryset.values('album', 'artist').distinct().order_by('album')
        albums = [a for a in albums if a['album']]  # Remove empty albums
        
        return Response(albums)
    
    @action(detail=False, methods=['get'])
    def genres(self, request):
        """Get list of genres"""
        queryset = self.get_queryset()
        genres = queryset.values_list('genre', flat=True).distinct().order_by('genre')
        genres = [g for g in genres if g]  # Remove empty strings
        
        return Response(genres)
    
    @action(detail=False, methods=['get'])
    def stats(self, request):
        """Get statistics"""
        queryset = self.get_queryset()
        
        stats = {
            'total_files': queryset.count(),
            'total_artists': queryset.values('artist').distinct().count(),
            'total_albums': queryset.values('album').distinct().count(),
            'total_duration': sum(a.duration or 0 for a in queryset),
            'total_size_mb': sum(a.file_size for a in queryset) / (1024 * 1024),
            'favorites': queryset.filter(is_favorite=True).count(),
        }
        
        return Response(stats)


class LocalAudioPlaylistViewSet(viewsets.ModelViewSet):
    """ViewSet for managing local audio playlists"""
    permission_classes = [IsAuthenticated, IsOwnerOrAdmin]
    serializer_class = LocalAudioPlaylistSerializer
    
    def get_queryset(self):
        """Filter by user"""
        queryset = LocalAudioPlaylist.objects.prefetch_related('items__audio')
        
        # Regular users see only their playlists
        if not (self.request.user.is_admin or self.request.user.is_superuser):
            queryset = queryset.filter(owner=self.request.user)
        
        return queryset.order_by('-created_date')
    
    def perform_create(self, serializer):
        """Set owner on creation"""
        serializer.save(owner=self.request.user)
    
    @action(detail=True, methods=['post'])
    def add_item(self, request, pk=None):
        """Add audio to playlist"""
        playlist = self.get_object()
        audio_id = request.data.get('audio_id')
        
        if not audio_id:
            return Response(
                {'error': 'audio_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            audio = LocalAudio.objects.get(id=audio_id, owner=request.user)
        except LocalAudio.DoesNotExist:
            return Response(
                {'error': 'Audio not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Get next position
        last_item = playlist.items.order_by('-position').first()
        position = (last_item.position + 1) if last_item else 0
        
        # Create item
        item, created = LocalAudioPlaylistItem.objects.get_or_create(
            playlist=playlist,
            audio=audio,
            defaults={'position': position}
        )
        
        if not created:
            return Response(
                {'error': 'Audio already in playlist'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        serializer = LocalAudioPlaylistItemSerializer(item, context={'request': request})
        return Response(serializer.data, status=status.HTTP_201_CREATED)
    
    @action(detail=True, methods=['post'])
    def remove_item(self, request, pk=None):
        """Remove audio from playlist"""
        playlist = self.get_object()
        audio_id = request.data.get('audio_id')
        
        if not audio_id:
            return Response(
                {'error': 'audio_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            item = LocalAudioPlaylistItem.objects.get(
                playlist=playlist,
                audio_id=audio_id
            )
            item.delete()
            return Response({'message': 'Item removed from playlist'})
        except LocalAudioPlaylistItem.DoesNotExist:
            return Response(
                {'error': 'Item not found in playlist'},
                status=status.HTTP_404_NOT_FOUND
            )
    
    @action(detail=True, methods=['post'])
    def reorder(self, request, pk=None):
        """Reorder playlist items"""
        playlist = self.get_object()
        item_order = request.data.get('item_order', [])
        
        if not item_order:
            return Response(
                {'error': 'item_order is required (array of item IDs)'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Update positions
        for position, item_id in enumerate(item_order):
            LocalAudioPlaylistItem.objects.filter(
                playlist=playlist,
                id=item_id
            ).update(position=position)
        
        return Response({'message': 'Playlist reordered'})
