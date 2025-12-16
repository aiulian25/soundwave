"""Channel API views"""

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from channel.models import Channel
from channel.serializers import ChannelSerializer
from common.views import ApiBaseView, AdminWriteOnly


class ChannelListView(ApiBaseView):
    """Channel list endpoint"""
    permission_classes = [AdminWriteOnly]

    def get(self, request):
        """Get channel list"""
        channels = Channel.objects.filter(owner=request.user, subscribed=True)
        serializer = ChannelSerializer(channels, many=True)
        return Response({'data': serializer.data, 'paginate': True})

    def post(self, request):
        """Subscribe to channel - TubeArchivist pattern with Celery task"""
        from channel.serializers import ChannelSubscribeSerializer
        
        # Check channel quota
        if not request.user.can_add_channel:
            return Response(
                {'error': f'Channel limit reached. Maximum {request.user.max_channels} channels allowed.'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        # Validate URL
        url_serializer = ChannelSubscribeSerializer(data=request.data)
        url_serializer.is_valid(raise_exception=True)
        channel_url = request.data['url']
        
        # Trigger async Celery task (TubeArchivist pattern)
        from task.tasks import subscribe_to_channel
        task = subscribe_to_channel.delay(request.user.id, channel_url)
        
        return Response(
            {
                'message': 'Channel subscription task started',
                'task_id': str(task.id)
            },
            status=status.HTTP_202_ACCEPTED
        )


class ChannelDetailView(ApiBaseView):
    """Channel detail endpoint"""
    permission_classes = [AdminWriteOnly]

    def get(self, request, channel_id):
        """Get channel details"""
        channel = get_object_or_404(Channel, channel_id=channel_id, owner=request.user)
        serializer = ChannelSerializer(channel)
        return Response(serializer.data)

    def delete(self, request, channel_id):
        """Unsubscribe from channel"""
        channel = get_object_or_404(Channel, channel_id=channel_id, owner=request.user)
        channel.subscribed = False
        channel.save()
        return Response(status=status.HTTP_204_NO_CONTENT)
