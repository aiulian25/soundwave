"""Task API views"""

from celery.result import AsyncResult
from rest_framework import status
from rest_framework.response import Response
from task.serializers import TaskSerializer
from common.views import ApiBaseView, AdminOnly

NOT_SUPPORTED_MESSAGE = 'Listing and starting tasks through this API is not supported.'


class TaskListView(ApiBaseView):
    """Task list endpoint"""
    permission_classes = [AdminOnly]

    def get(self, request):
        """Listing is not supported; an empty list would wrongly mean nothing is running."""
        return Response({'error': NOT_SUPPORTED_MESSAGE}, status=status.HTTP_501_NOT_IMPLEMENTED)


class TaskCreateView(ApiBaseView):
    """Task creation endpoint"""
    permission_classes = [AdminOnly]

    def post(self, request):
        """Starting tasks by name is not supported, and must not claim that one was created."""
        return Response({'error': NOT_SUPPORTED_MESSAGE}, status=status.HTTP_501_NOT_IMPLEMENTED)


class TaskDetailView(ApiBaseView):
    """Task detail endpoint"""
    permission_classes = [AdminOnly]

    def get(self, request, task_id):
        """Get task status"""
        result = AsyncResult(task_id)

        return Response({
            'task_id': task_id,
            'status': result.status,
            'result': result.result if result.ready() else None
        })
