"""Download serializers"""

from rest_framework import serializers
from download.claims import is_youtube_collection_url
from download.models import DownloadQueue
from common.url_security import check_public_http_url, message_for


MAX_URLS_PER_REQUEST = 100


def validate_download_url(value):
    """SSRF guard (APP-02): block non-http(s) and internal/non-routable targets."""
    ok, code = check_public_http_url(value)
    if not ok:
        # `code` is a stable identifier the SPA maps to a localized string.
        raise serializers.ValidationError(message_for(code), code=code)
    return value


def validate_single_item_url(value):
    """The queue downloads one track per row; collections have their own subscribe flows."""
    if is_youtube_collection_url(value):
        raise serializers.ValidationError('This is a playlist or channel. Subscribe to it instead.')
    return value


class DownloadQueueSerializer(serializers.ModelSerializer):
    """Download queue serializer"""

    class Meta:
        model = DownloadQueue
        exclude = ['claim_token', 'lease_expires_at', 'source_playlist_id', 'reserved_bytes']
        read_only_fields = ['added_date', 'started_date', 'completed_date']


class AddToDownloadSerializer(serializers.Serializer):
    """Add to download queue"""
    urls = serializers.ListField(
        child=serializers.URLField(validators=[validate_download_url, validate_single_item_url]),
        allow_empty=False,
        max_length=MAX_URLS_PER_REQUEST,
    )
    auto_start = serializers.BooleanField(default=False)
