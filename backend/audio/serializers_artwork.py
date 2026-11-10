"""Serializers for artwork and metadata"""
from rest_framework import serializers
from audio.models import Audio
from audio.models_artwork import Artwork, MusicMetadata, ArtistInfo
from channel.models import Channel

ASSOCIATION_FIELDS = ('audio', 'channel')


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
        # local_path is only ever set by the download task; width/height describe that file.
        read_only_fields = ['id', 'fetched_date', 'local_path', 'width', 'height']

    def get_fields(self):
        """Scope related objects to the requester, so a foreign id is simply "does not exist"."""
        fields = super().get_fields()
        owner = self._signed_in_requester()
        fields['audio'].queryset = Audio.objects.filter(owner=owner)
        fields['channel'].queryset = Channel.objects.filter(owner=owner)
        return fields

    def _signed_in_requester(self):
        """The requesting account, or None, which owns nothing.

        Schema generation runs with an anonymous user, and filtering on that object raises.
        """
        requester = getattr(self.context.get('request'), 'user', None)
        if requester is None or not requester.is_authenticated:
            return None
        return requester

    def validate(self, attrs):
        if self.instance is not None:
            self._reject_reparenting(attrs)
            return attrs
        if bool(attrs.get('audio')) == bool(attrs.get('channel')):
            raise serializers.ValidationError('Artwork must belong to exactly one of audio or channel.')
        return attrs

    def _reject_reparenting(self, attrs):
        for field in ASSOCIATION_FIELDS:
            if field in attrs and attrs[field] != getattr(self.instance, field):
                raise serializers.ValidationError({field: 'Artwork cannot be moved to another owner object.'})


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
