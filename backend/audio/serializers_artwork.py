"""Serializers for artwork and metadata"""
from rest_framework import serializers
from audio.models_artwork import Artwork, MusicMetadata, ArtistInfo


class ArtworkSerializer(serializers.ModelSerializer):
    """Serializer for Artwork model"""
    
    class Meta:
        model = Artwork
        # Artwork's timestamp field is `fetched_date` (there is no created_at).
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
            'fetched_date',
        ]
        read_only_fields = ['id', 'fetched_date']


class MusicMetadataSerializer(serializers.ModelSerializer):
    """Serializer for MusicMetadata model"""
    
    class Meta:
        model = MusicMetadata
        # MusicMetadata's primary key is `audio` (OneToOneField, primary_key=True) —
        # it has no `id`, and its timestamp field is `last_updated`.
        fields = [
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
            'metadata_fetched',
            'last_updated',
        ]
        read_only_fields = ['audio', 'last_updated']


class ArtistInfoSerializer(serializers.ModelSerializer):
    """Serializer for ArtistInfo model"""
    
    class Meta:
        model = ArtistInfo
        # NOTE: ArtistInfo's primary key is `channel` (OneToOneField, primary_key=True)
        # — it has no `id`, and its timestamp field is `last_updated`. Referencing
        # non-existent fields here previously crashed schema generation (APP-12) and
        # any serialization of this model.
        fields = [
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
            'metadata_fetched',
            'last_updated',
        ]
        read_only_fields = ['channel', 'last_updated']


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
