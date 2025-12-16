"""App settings serializers"""

from rest_framework import serializers


class AppConfigSerializer(serializers.Serializer):
    """Application configuration"""
    app_name = serializers.CharField(default='SoundWave')
    version = serializers.CharField(default='1.0.0')
    sw_host = serializers.URLField()
    audio_quality = serializers.CharField(default='best')
    auto_update_ytdlp = serializers.BooleanField(default=False)
