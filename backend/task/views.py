"""Task API views"""

from celery.result import AsyncResult
from rest_framework import status
from rest_framework.response import Response
from task.serializers import TaskSerializer, TaskCreateSerializer
from common.views import ApiBaseView, AdminOnly


class TaskListView(ApiBaseView):
    """Task list endpoint"""
    permission_classes = [AdminOnly]

    def get(self, request):
        """Get list of tasks"""
        # TODO: Implement task listing from Celery
        return Response({'data': []})


class TaskCreateView(ApiBaseView):
    """Task creation endpoint"""
    permission_classes = [AdminOnly]

    def post(self, request):
        """Create and run a task"""
        serializer = TaskCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        task_name = serializer.validated_data['task_name']
        params = serializer.validated_data.get('params', {})

        # Map task names to Celery tasks
        # TODO: Implement task dispatch

        return Response({
            'message': 'Task created',
            'task_name': task_name
        }, status=status.HTTP_202_ACCEPTED)


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
