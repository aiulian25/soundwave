"""Common serializers"""

from rest_framework import serializers


class ErrorResponseSerializer(serializers.Serializer):
    """Error response"""
    error = serializers.CharField()
    details = serializers.DictField(required=False)


class AsyncTaskResponseSerializer(serializers.Serializer):
    """Async task response"""
    task_id = serializers.CharField()
    message = serializers.CharField()
    status = serializers.CharField()
