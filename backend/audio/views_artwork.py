"""Views for artwork and metadata management"""
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.shortcuts import get_object_or_404
from django.db.models import Prefetch

from audio.models import Audio, Channel
from audio.models_artwork import Artwork, MusicMetadata, ArtistInfo
from audio.serializers_artwork import (
    ArtworkSerializer,
    MusicMetadataSerializer,
    ArtistInfoSerializer,
    AudioWithArtworkSerializer,
    ChannelWithArtworkSerializer,
)
from audio.tasks_artwork import (
    fetch_metadata_for_audio,
    fetch_artwork_for_audio,
    fetch_artist_info,
    fetch_artist_artwork,
    download_artwork,
    embed_artwork_in_audio,
    update_id3_tags_from_metadata,
)


class ArtworkViewSet(viewsets.ModelViewSet):
    """ViewSet for managing artwork"""
    
    queryset = Artwork.objects.all()
    serializer_class = ArtworkSerializer
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        queryset = super().get_queryset()
        
        # Filter by audio
        audio_id = self.request.query_params.get('audio_id')
        if audio_id:
            queryset = queryset.filter(audio_id=audio_id)
        
        # Filter by channel
        channel_id = self.request.query_params.get('channel_id')
        if channel_id:
            queryset = queryset.filter(channel_id=channel_id)
        
        # Filter by type
        artwork_type = self.request.query_params.get('type')
        if artwork_type:
            queryset = queryset.filter(artwork_type=artwork_type)
        
        # Filter by source
        source = self.request.query_params.get('source')
        if source:
            queryset = queryset.filter(source=source)
        
        return queryset.order_by('-priority', '-created_at')
    
    @action(detail=True, methods=['post'])
    def download(self, request, pk=None):
        """Download artwork from URL"""
        artwork = self.get_object()
        download_artwork.delay(artwork.id)
        return Response({
            'message': 'Artwork download queued',
            'artwork_id': artwork.id
        })
    
    @action(detail=True, methods=['post'])
    def set_primary(self, request, pk=None):
        """Set artwork as primary"""
        artwork = self.get_object()
        
        # Unset other primary artworks
        if artwork.audio:
            Artwork.objects.filter(
                audio=artwork.audio,
                artwork_type=artwork.artwork_type
            ).update(is_primary=False)
        elif artwork.channel:
            Artwork.objects.filter(
                channel=artwork.channel,
                artwork_type=artwork.artwork_type
            ).update(is_primary=False)
        
        artwork.is_primary = True
        artwork.save()
        
        return Response({
            'message': 'Artwork set as primary',
            'artwork_id': artwork.id
        })


class MusicMetadataViewSet(viewsets.ModelViewSet):
    """ViewSet for managing music metadata"""
    
    queryset = MusicMetadata.objects.all()
    serializer_class = MusicMetadataSerializer
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        queryset = super().get_queryset()
        
        # Filter by audio
        audio_id = self.request.query_params.get('audio_id')
        if audio_id:
            queryset = queryset.filter(audio_id=audio_id)
        
        return queryset
    
    @action(detail=True, methods=['post'])
    def fetch_from_lastfm(self, request, pk=None):
        """Fetch metadata from Last.fm"""
        metadata = self.get_object()
        fetch_metadata_for_audio.delay(metadata.audio.id)
        return Response({
            'message': 'Metadata fetch queued',
            'audio_id': metadata.audio.id
        })
    
    @action(detail=True, methods=['post'])
    def update_id3_tags(self, request, pk=None):
        """Update ID3 tags in audio file"""
        metadata = self.get_object()
        update_id3_tags_from_metadata.delay(metadata.audio.id)
        return Response({
            'message': 'ID3 tags update queued',
            'audio_id': metadata.audio.id
        })


class ArtistInfoViewSet(viewsets.ModelViewSet):
    """ViewSet for managing artist information"""
    
    queryset = ArtistInfo.objects.all()
    serializer_class = ArtistInfoSerializer
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        queryset = super().get_queryset()
        
        # Filter by channel
        channel_id = self.request.query_params.get('channel_id')
        if channel_id:
            queryset = queryset.filter(channel_id=channel_id)
        
        return queryset
    
    @action(detail=True, methods=['post'])
    def fetch_from_lastfm(self, request, pk=None):
        """Fetch artist info from Last.fm"""
        artist_info = self.get_object()
        fetch_artist_info.delay(artist_info.channel.id)
        return Response({
            'message': 'Artist info fetch queued',
            'channel_id': artist_info.channel.id
        })


class AudioArtworkViewSet(viewsets.ViewSet):
    """ViewSet for audio artwork operations"""
    
    permission_classes = [IsAuthenticated]
    
    def retrieve(self, request, pk=None):
        """Get audio with all artwork"""
        audio = get_object_or_404(Audio, pk=pk)
        
        artwork = Artwork.objects.filter(audio=audio).order_by('-priority')
        try:
            metadata = MusicMetadata.objects.get(audio=audio)
        except MusicMetadata.DoesNotExist:
            metadata = None
        
        data = {
            'audio_id': audio.id,
            'audio_title': audio.audio_title,
            'artist': audio.channel.channel_name if audio.channel else 'Unknown Artist',
            'artwork': ArtworkSerializer(artwork, many=True).data,
            'metadata': MusicMetadataSerializer(metadata).data if metadata else None,
        }
        
        return Response(data)
    
    @action(detail=True, methods=['post'])
    def fetch_artwork(self, request, pk=None):
        """Fetch artwork for audio"""
        audio = get_object_or_404(Audio, pk=pk)
        fetch_artwork_for_audio.delay(audio.id)
        return Response({
            'message': 'Artwork fetch queued',
            'audio_id': audio.id
        })
    
    @action(detail=True, methods=['post'])
    def fetch_metadata(self, request, pk=None):
        """Fetch metadata for audio"""
        audio = get_object_or_404(Audio, pk=pk)
        fetch_metadata_for_audio.delay(audio.id)
        return Response({
            'message': 'Metadata fetch queued',
            'audio_id': audio.id
        })
    
    @action(detail=True, methods=['post'])
    def embed_artwork(self, request, pk=None):
        """Embed artwork in audio file"""
        audio = get_object_or_404(Audio, pk=pk)
        artwork_id = request.data.get('artwork_id')
        
        if artwork_id:
            embed_artwork_in_audio.delay(audio.id, artwork_id)
        else:
            embed_artwork_in_audio.delay(audio.id)
        
        return Response({
            'message': 'Artwork embed queued',
            'audio_id': audio.id
        })


class ChannelArtworkViewSet(viewsets.ViewSet):
    """ViewSet for channel artwork operations"""
    
    permission_classes = [IsAuthenticated]
    
    def retrieve(self, request, pk=None):
        """Get channel with all artwork"""
        channel = get_object_or_404(Channel, pk=pk)
        
        artwork = Artwork.objects.filter(channel=channel).order_by('-priority')
        try:
            artist_info = ArtistInfo.objects.get(channel=channel)
        except ArtistInfo.DoesNotExist:
            artist_info = None
        
        data = {
            'channel_id': channel.id,
            'channel_name': channel.channel_name,
            'artwork': ArtworkSerializer(artwork, many=True).data,
            'artist_info': ArtistInfoSerializer(artist_info).data if artist_info else None,
        }
        
        return Response(data)
    
    @action(detail=True, methods=['post'])
    def fetch_artwork(self, request, pk=None):
        """Fetch artwork for channel"""
        channel = get_object_or_404(Channel, pk=pk)
        fetch_artist_artwork.delay(channel.id)
        return Response({
            'message': 'Artist artwork fetch queued',
            'channel_id': channel.id
        })
    
    @action(detail=True, methods=['post'])
    def fetch_info(self, request, pk=None):
        """Fetch artist info for channel"""
        channel = get_object_or_404(Channel, pk=pk)
        fetch_artist_info.delay(channel.id)
        return Response({
            'message': 'Artist info fetch queued',
            'channel_id': channel.id
        })
