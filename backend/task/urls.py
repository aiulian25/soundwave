"""Task URL patterns"""

from django.urls import path
from task.views import TaskListView, TaskCreateView, TaskDetailView

urlpatterns = [
    path('', TaskListView.as_view(), name='task-list'),
    path('create/', TaskCreateView.as_view(), name='task-create'),
    path('<str:task_id>/', TaskDetailView.as_view(), name='task-detail'),
]
