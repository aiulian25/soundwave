"""Download API views"""

from rest_framework import status
from rest_framework.response import Response
from download.models import DownloadQueue
from download.serializers import DownloadQueueSerializer, AddToDownloadSerializer
from common.views import ApiBaseView, AdminWriteOnly


class DownloadListView(ApiBaseView):
    """Download queue list endpoint"""
    permission_classes = [AdminWriteOnly]

    def get(self, request):
        """Get download queue"""
        status_filter = request.query_params.get('filter', 'pending')
        queryset = DownloadQueue.objects.filter(owner=request.user, status=status_filter)
        serializer = DownloadQueueSerializer(queryset, many=True)
        return Response({'data': serializer.data})

    def post(self, request):
        """Add to download queue"""
        serializer = AddToDownloadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        created_items = []
        for url in serializer.validated_data['urls']:
            item, created = DownloadQueue.objects.get_or_create(
                owner=request.user,
                url=url,
                defaults={'auto_start': serializer.validated_data['auto_start']}
            )
            created_items.append(item)

        response_serializer = DownloadQueueSerializer(created_items, many=True)
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

    def delete(self, request):
        """Clear download queue"""
        status_filter = request.query_params.get('filter', 'pending')
        DownloadQueue.objects.filter(owner=request.user, status=status_filter).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
