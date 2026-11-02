"""Smart Playlist serializers"""

from django.db import transaction
from rest_framework import serializers
from playlist.models_smart import SmartPlaylist, SmartPlaylistRule
from playlist.smart_rules import InvalidRule, compile_rule

MAX_TRACK_LIMIT = 1_000_000
TRACK_LIMIT_BOUNDS = {'min_value': 1, 'max_value': MAX_TRACK_LIMIT}


class SmartPlaylistRuleSerializer(serializers.ModelSerializer):
    """Serializer for smart playlist rules"""
    field_display = serializers.CharField(source='get_field_display', read_only=True)
    operator_display = serializers.CharField(source='get_operator_display', read_only=True)
    
    class Meta:
        model = SmartPlaylistRule
        fields = ['id', 'field', 'field_display', 'operator', 'operator_display', 'value', 'value_2', 'order']
        read_only_fields = ['id', 'order']

    def validate(self, attrs):
        try:
            compile_rule(attrs.get('field'), attrs.get('operator'), attrs.get('value', ''), attrs.get('value_2', ''))
        except InvalidRule as error:
            raise serializers.ValidationError({error.target: [error.code]}) from error
        return attrs


class SmartPlaylistSerializer(serializers.ModelSerializer):
    """Serializer for smart playlists"""
    rules = SmartPlaylistRuleSerializer(many=True, read_only=True)
    track_count = serializers.SerializerMethodField()
    invalid_rule_ids = serializers.SerializerMethodField()
    match_mode_display = serializers.CharField(source='get_match_mode_display', read_only=True)
    order_by_display = serializers.CharField(source='get_order_by_display', read_only=True)
    
    class Meta:
        model = SmartPlaylist
        fields = [
            'id', 'name', 'description', 'icon', 'color',
            'match_mode', 'match_mode_display',
            'order_by', 'order_by_display', 'limit',
            'is_system', 'preset_type',
            'rules', 'invalid_rule_ids', 'track_count',
            'cached_count', 'cache_updated',
            'created_date', 'last_updated'
        ]
        read_only_fields = ['id', 'owner', 'is_system', 'preset_type', 'cached_count', 'cache_updated', 'created_date', 'last_updated']
    
    def get_invalid_rule_ids(self, obj):
        return obj.invalid_rule_ids()

    def get_track_count(self, obj):
        """Get current track count - use cache if recent, otherwise calculate"""
        from django.utils import timezone
        from datetime import timedelta
        
        # If cache is recent (less than 5 minutes old), use it
        if obj.cache_updated and obj.cache_updated > timezone.now() - timedelta(minutes=5):
            return obj.cached_count
        
        # Otherwise calculate and update cache
        count = obj.get_track_count()
        # Update cache in background (don't block response)
        try:
            obj.cached_count = count
            obj.cache_updated = timezone.now()
            obj.save(update_fields=['cached_count', 'cache_updated'])
        except Exception:
            pass  # Don't fail if cache update fails
        return count


class SmartPlaylistCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating smart playlists with rules"""
    rules = SmartPlaylistRuleSerializer(many=True, required=False)
    
    class Meta:
        model = SmartPlaylist
        fields = ['name', 'description', 'icon', 'color', 'match_mode', 'order_by', 'limit', 'rules']
        extra_kwargs = {'limit': TRACK_LIMIT_BOUNDS}
    
    def validate_name(self, value):
        """Ensure unique name per user"""
        user = self.context['request'].user
        if SmartPlaylist.objects.filter(owner=user, name=value).exists():
            raise serializers.ValidationError("A smart playlist with this name already exists.")
        return value
    
    def create(self, validated_data):
        rules_data = validated_data.pop('rules', [])
        with transaction.atomic():
            smart_playlist = SmartPlaylist.objects.create(**validated_data)
            smart_playlist.replace_rules(rules_data)
        return smart_playlist


class SmartPlaylistUpdateSerializer(serializers.ModelSerializer):
    """Serializer for updating smart playlists"""
    rules = SmartPlaylistRuleSerializer(many=True, required=False)
    
    class Meta:
        model = SmartPlaylist
        fields = ['name', 'description', 'icon', 'color', 'match_mode', 'order_by', 'limit', 'rules']
        extra_kwargs = {'limit': TRACK_LIMIT_BOUNDS}
    
    def validate_name(self, value):
        """Ensure unique name per user"""
        user = self.context['request'].user
        instance = self.instance
        if SmartPlaylist.objects.filter(owner=user, name=value).exclude(pk=instance.pk).exists():
            raise serializers.ValidationError("A smart playlist with this name already exists.")
        return value
    
    def update(self, instance, validated_data):
        # Check if this is a system playlist (limited editing)
        if instance.is_system:
            # Only allow updating order_by and limit for system playlists
            allowed_fields = ['order_by', 'limit']
            for field in list(validated_data.keys()):
                if field not in allowed_fields and field != 'rules':
                    del validated_data[field]
        
        rules_data = validated_data.pop('rules', None)
        
        with transaction.atomic():
            for attr, value in validated_data.items():
                setattr(instance, attr, value)
            instance.cache_updated = None
            instance.save()

            # Update rules if provided (only for non-system playlists)
            if rules_data is not None and not instance.is_system:
                instance.replace_rules(rules_data)

        return instance


class SmartPlaylistRulesReplaceSerializer(serializers.Serializer):
    """A whole new rule set. An empty list clears the rules; leaving it out is an error."""
    rules = SmartPlaylistRuleSerializer(many=True)


class SmartPlaylistPreviewSerializer(serializers.Serializer):
    """An unsaved draft, held to the same rules as a save."""
    rules = SmartPlaylistRuleSerializer(many=True, required=False, default=list)
    match_mode = serializers.ChoiceField(choices=SmartPlaylist.MATCH_MODE_CHOICES, default='all')
    order_by = serializers.ChoiceField(choices=SmartPlaylist.ORDER_BY_CHOICES, default='-downloaded_date')
    limit = serializers.IntegerField(required=False, allow_null=True, default=None, **TRACK_LIMIT_BOUNDS)


class SmartPlaylistRuleChoicesSerializer(serializers.Serializer):
    """Serializer for returning available rule choices"""
    fields = serializers.ListField(child=serializers.DictField())
    operators = serializers.ListField(child=serializers.DictField())
    order_by_options = serializers.ListField(child=serializers.DictField())
