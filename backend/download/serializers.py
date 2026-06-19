"""Download serializers"""

from rest_framework import serializers
from download.models import DownloadQueue
from common.url_security import check_public_http_url, message_for


def validate_download_url(value):
    """SSRF guard (APP-02): block non-http(s) and internal/non-routable targets."""
    ok, code = check_public_http_url(value)
    if not ok:
        # `code` is a stable identifier the SPA maps to a localized string.
        raise serializers.ValidationError(message_for(code), code=code)
    return value


class DownloadQueueSerializer(serializers.ModelSerializer):
    """Download queue serializer"""

    class Meta:
        model = DownloadQueue
        fields = '__all__'
        read_only_fields = ['added_date', 'started_date', 'completed_date']


class AddToDownloadSerializer(serializers.Serializer):
    """Add to download queue"""
    urls = serializers.ListField(
        child=serializers.URLField(validators=[validate_download_url]),
        allow_empty=False
    )
    auto_start = serializers.BooleanField(default=False)
