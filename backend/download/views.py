"""Download API views"""

from django.db.models import Count
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
        """Add to download queue and optionally auto-start downloads"""
        serializer = AddToDownloadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        created_items = []
        auto_start = serializer.validated_data.get('auto_start', False)
        
        for url in serializer.validated_data['urls']:
            item, created = DownloadQueue.objects.get_or_create(
                owner=request.user,
                url=url,
                defaults={'auto_start': auto_start}
            )
            created_items.append(item)
            
            # Auto-start download if requested and item is new
            if auto_start and created and item.status == 'pending':
                from task.tasks import download_audio_task
                download_audio_task.delay(item.id)

        response_serializer = DownloadQueueSerializer(created_items, many=True)
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

    def delete(self, request):
        """Clear download queue"""
        status_filter = request.query_params.get('filter', 'pending')
        DownloadQueue.objects.filter(owner=request.user, status=status_filter).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class RetryFailedView(ApiBaseView):
    """Retry failed downloads"""
    
    def post(self, request):
        """Retry all failed downloads or a specific one"""
        download_id = request.data.get('id')
        
        if download_id:
            # Retry specific download
            try:
                download = DownloadQueue.objects.get(
                    id=download_id,
                    owner=request.user,
                    status='failed'
                )
                download.status = 'pending'
                download.error_message = f'Manual retry: {download.error_message or ""}'
                download.save()
                
                from task.tasks import download_audio_task
                download_audio_task.delay(download.id)
                
                return Response({
                    'detail': 'Download queued for retry',
                    'id': download.id
                })
            except DownloadQueue.DoesNotExist:
                return Response(
                    {'error': 'Download not found or not failed'},
                    status=status.HTTP_404_NOT_FOUND
                )
        else:
            # Retry all failed downloads
            failed = DownloadQueue.objects.filter(
                owner=request.user,
                status='failed'
            )
            
            count = 0
            for download in failed:
                download.status = 'pending'
                download.error_message = f'Manual retry: {download.error_message or ""}'
                download.save()
                
                from task.tasks import download_audio_task
                download_audio_task.delay(download.id)
                count += 1
            
            return Response({
                'detail': f'Queued {count} downloads for retry',
                'count': count
            })


class DownloadStatusView(ApiBaseView):
    """Get comprehensive download status"""
    
    def get(self, request):
        """Get status counts and recent activity"""
        user = request.user
        
        # Get counts by status
        status_counts = DownloadQueue.objects.filter(
            owner=user
        ).values('status').annotate(count=Count('id'))
        
        counts = {item['status']: item['count'] for item in status_counts}
        
        # Get recent activity
        recent = DownloadQueue.objects.filter(
            owner=user
        ).order_by('-added_date')[:10]
        
        serializer = DownloadQueueSerializer(recent, many=True)
        
        return Response({
            'counts': {
                'pending': counts.get('pending', 0),
                'downloading': counts.get('downloading', 0),
                'completed': counts.get('completed', 0),
                'failed': counts.get('failed', 0),
            },
            'total': sum(counts.values()),
            'recent': serializer.data,
        })
