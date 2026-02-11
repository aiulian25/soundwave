"""Serializers for local audio files"""

from rest_framework import serializers
from audio.models_local import LocalAudio, LocalAudioPlaylist, LocalAudioPlaylistItem


class LocalAudioSerializer(serializers.ModelSerializer):
    """Serializer for local audio files"""
    file_size_mb = serializers.FloatField(read_only=True)
    duration_formatted = serializers.CharField(read_only=True)
    file_url = serializers.SerializerMethodField()
    cover_art_url = serializers.SerializerMethodField()
    
    class Meta:
        model = LocalAudio
        fields = [
            'id',
            'title',
            'artist',
            'album',
            'year',
            'genre',
            'track_number',
            'file',
            'file_url',
            'file_size',
            'file_size_mb',
            'duration',
            'duration_formatted',
            'audio_format',
            'bitrate',
            'sample_rate',
            'channels',
            'cover_art',
            'cover_art_url',
            'original_filename',
            'uploaded_date',
            'modified_date',
            'play_count',
            'last_played',
            'tags',
            'notes',
            'is_favorite',
        ]
        read_only_fields = [
            'id',
            'file_size',
            'duration',
            'audio_format',
            'bitrate',
            'sample_rate',
            'channels',
            'original_filename',
            'uploaded_date',
            'modified_date',
            'play_count',
            'last_played',
        ]
    
    def get_file_url(self, obj):
        """Get full URL for audio file"""
        request = self.context.get('request')
        if obj.file and request:
            return request.build_absolute_uri(obj.file.url)
        return None
    
    def get_cover_art_url(self, obj):
        """Get full URL for cover art"""
        request = self.context.get('request')
        if obj.cover_art and request:
            return request.build_absolute_uri(obj.cover_art.url)
        return None


class LocalAudioUploadSerializer(serializers.ModelSerializer):
    """Serializer for uploading local audio files"""
    # Make title optional - will be extracted from ID3 tags if not provided
    title = serializers.CharField(required=False, allow_blank=True, max_length=500)
    
    # Allowed audio file extensions and MIME types
    ALLOWED_EXTENSIONS = {'mp3', 'flac', 'm4a', 'ogg', 'opus', 'wav', 'wma', 'aac', 'webm'}
    ALLOWED_MIME_TYPES = {
        'audio/mpeg', 'audio/mp3', 'audio/flac', 'audio/x-flac',
        'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/ogg',
        'audio/opus', 'audio/wav', 'audio/x-wav', 'audio/x-ms-wma',
        'audio/aac', 'audio/webm'
    }
    
    class Meta:
        model = LocalAudio
        fields = [
            'file',
            'title',
            'artist',
            'album',
            'year',
            'genre',
            'track_number',
            'cover_art',
            'tags',
            'notes',
        ]
    
    def validate_file(self, value):
        """Validate uploaded audio file type and size"""
        # Check file extension
        if '.' not in value.name:
            raise serializers.ValidationError("File must have an extension")
        
        file_extension = value.name.rsplit('.', 1)[-1].lower()
        if file_extension not in self.ALLOWED_EXTENSIONS:
            raise serializers.ValidationError(
                f"Invalid file type. Allowed: {', '.join(sorted(self.ALLOWED_EXTENSIONS))}"
            )
        
        # Check content type if available
        if hasattr(value, 'content_type') and value.content_type:
            # Allow application/octet-stream since browsers may not detect audio types
            if value.content_type != 'application/octet-stream' and value.content_type not in self.ALLOWED_MIME_TYPES:
                raise serializers.ValidationError(
                    f"Invalid content type: {value.content_type}"
                )
        
        # Check file size (max 500MB)
        max_size = 500 * 1024 * 1024
        if value.size > max_size:
            raise serializers.ValidationError(
                f"File too large. Maximum size is 500MB."
            )
        
        return value
    
    def create(self, validated_data):
        """Extract metadata and create local audio"""
        file = validated_data['file']
        
        # Set original filename
        validated_data['original_filename'] = file.name
        validated_data['file_size'] = file.size
        
        # Extract audio format from filename
        file_extension = file.name.split('.')[-1].lower()
        validated_data['audio_format'] = file_extension
        
        # Try to extract metadata using mutagen
        try:
            from mutagen import File as MutagenFile
            audio_file = MutagenFile(file)
            
            if audio_file:
                # Get duration
                if hasattr(audio_file.info, 'length'):
                    validated_data['duration'] = int(audio_file.info.length)
                
                # Get bitrate
                if hasattr(audio_file.info, 'bitrate'):
                    validated_data['bitrate'] = int(audio_file.info.bitrate / 1000)  # Convert to kbps
                
                # Get sample rate
                if hasattr(audio_file.info, 'sample_rate'):
                    validated_data['sample_rate'] = audio_file.info.sample_rate
                
                # Get channels
                if hasattr(audio_file.info, 'channels'):
                    validated_data['channels'] = audio_file.info.channels
                
                # Extract ID3 tags if not provided
                if not validated_data.get('title'):
                    validated_data['title'] = audio_file.get('TIT2', [file.name])[0] if hasattr(audio_file, 'get') else file.name
                
                if not validated_data.get('artist'):
                    validated_data['artist'] = audio_file.get('TPE1', [''])[0] if hasattr(audio_file, 'get') else ''
                
                if not validated_data.get('album'):
                    validated_data['album'] = audio_file.get('TALB', [''])[0] if hasattr(audio_file, 'get') else ''
        except Exception as e:
            # If metadata extraction fails, use filename as title
            if not validated_data.get('title'):
                validated_data['title'] = file.name
        
        return super().create(validated_data)


class LocalAudioPlaylistItemSerializer(serializers.ModelSerializer):
    """Serializer for playlist items"""
    audio_data = LocalAudioSerializer(source='audio', read_only=True)
    
    class Meta:
        model = LocalAudioPlaylistItem
        fields = ['id', 'audio', 'audio_data', 'position', 'added_date']
        read_only_fields = ['id', 'added_date']


class LocalAudioPlaylistSerializer(serializers.ModelSerializer):
    """Serializer for local audio playlists"""
    items = LocalAudioPlaylistItemSerializer(many=True, read_only=True)
    items_count = serializers.SerializerMethodField()
    cover_image_url = serializers.SerializerMethodField()
    
    class Meta:
        model = LocalAudioPlaylist
        fields = [
            'id',
            'title',
            'description',
            'cover_image',
            'cover_image_url',
            'created_date',
            'modified_date',
            'items',
            'items_count',
        ]
        read_only_fields = ['id', 'created_date', 'modified_date']
    
    def get_items_count(self, obj):
        """Get number of items in playlist"""
        return obj.items.count()
    
    def get_cover_image_url(self, obj):
        """Get full URL for cover image"""
        request = self.context.get('request')
        if obj.cover_image and request:
            return request.build_absolute_uri(obj.cover_image.url)
        return None
