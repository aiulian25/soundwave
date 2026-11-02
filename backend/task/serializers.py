"""Task serializers"""

from rest_framework import serializers


class TaskSerializer(serializers.Serializer):
    """Task status serializer"""
    task_id = serializers.CharField()
    task_name = serializers.CharField()
    status = serializers.CharField()
    result = serializers.JSONField(required=False)
    date_done = serializers.DateTimeField(required=False)
