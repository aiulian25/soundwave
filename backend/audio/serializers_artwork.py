"""Serializers for artwork and metadata"""
from rest_framework import serializers
from audio.models_artwork import Artwork, MusicMetadata, ArtistInfo


class ArtworkSerializer(serializers.ModelSerializer):
    """Serializer for Artwork model"""
    
    class Meta:
        model = Artwork
        fields = [
            'id',
            'audio',
            'channel',
            'artwork_type',
            'source',
            'url',
            'local_path',
            'width',
            'height',
            'priority',
            'is_primary',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at']


class MusicMetadataSerializer(serializers.ModelSerializer):
    """Serializer for MusicMetadata model"""
    
    class Meta:
        model = MusicMetadata
        fields = [
            'id',
            'audio',
            'album_name',
            'album_artist',
            'release_year',
            'track_number',
            'disc_number',
            'genre',
            'tags',
            'lastfm_url',
            'lastfm_mbid',
            'play_count',
            'listeners',
            'fanart_artist_id',
            'fanart_album_id',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class ArtistInfoSerializer(serializers.ModelSerializer):
    """Serializer for ArtistInfo model"""
    
    class Meta:
        model = ArtistInfo
        fields = [
            'id',
            'channel',
            'bio',
            'bio_summary',
            'lastfm_url',
            'lastfm_mbid',
            'lastfm_listeners',
            'lastfm_playcount',
            'tags',
            'fanart_id',
            'similar_artists',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class AudioWithArtworkSerializer(serializers.Serializer):
    """Serializer for audio with artwork"""
    audio_id = serializers.IntegerField()
    audio_title = serializers.CharField()
    artist = serializers.CharField()
    artwork = ArtworkSerializer(many=True)
    metadata = MusicMetadataSerializer(required=False)


class ChannelWithArtworkSerializer(serializers.Serializer):
    """Serializer for channel with artwork"""
    channel_id = serializers.IntegerField()
    channel_name = serializers.CharField()
    artwork = ArtworkSerializer(many=True)
    artist_info = ArtistInfoSerializer(required=False)
