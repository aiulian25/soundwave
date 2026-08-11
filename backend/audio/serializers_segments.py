"""Serializers for audio segments (F3)."""

from rest_framework import serializers

from audio.models_segments import AudioSegment


class AudioSegmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = AudioSegment
        fields = ['id', 'title', 'start_seconds', 'end_seconds', 'order']
        read_only_fields = fields
