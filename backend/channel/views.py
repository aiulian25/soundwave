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
        import logging
        logger = logging.getLogger(__name__)
        logger.info(f"GET channel list - User: {request.user}, Auth: {request.user.is_authenticated}")
        
        channels = Channel.objects.filter(owner=request.user, subscribed=True)
        serializer = ChannelSerializer(channels, many=True)
        return Response({'data': serializer.data, 'paginate': True})

    def post(self, request):
        """Subscribe to channel - TubeArchivist pattern with Celery task"""
        from channel.serializers import ChannelSubscribeSerializer
        import logging
        logger = logging.getLogger(__name__)
        
        # Log request details
        logger.error(f"=== CHANNEL SUBSCRIBE START ===")
        logger.error(f"User: {request.user}")
        logger.error(f"Is authenticated: {request.user.is_authenticated}")
        logger.error(f"Request data: {request.data}")
        
        # Check channel quota
        if not request.user.can_add_channel:
            logger.error(f"User exceeded channel limit: {request.user.max_channels}")
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
        """Get channel details with audio files"""
        from audio.models import Audio
        from audio.serializers import AudioSerializer
        
        channel = get_object_or_404(Channel, channel_id=channel_id, owner=request.user)
        serializer = ChannelSerializer(channel)
        
        # Get audio files for this channel
        audio_files = Audio.objects.filter(
            owner=request.user, 
            channel_id=channel_id
        ).order_by('-published_date')
        
        audio_serializer = AudioSerializer(audio_files, many=True)
        
        # Combine channel data with audio files
        data = serializer.data
        data['audio_files'] = audio_serializer.data
        data['audio_count'] = audio_files.count()
        
        return Response(data)

    def delete(self, request, channel_id):
        """Delete channel and all associated audio files"""
        from audio.models import Audio
        
        channel = get_object_or_404(Channel, channel_id=channel_id, owner=request.user)
        
        # Find and delete all audio files associated with this channel
        audio_files = Audio.objects.filter(
            owner=request.user,
            channel_id=channel_id
        )
        
        deleted_count = 0
        for audio in audio_files:
            audio.delete()  # This will trigger our custom delete method
            deleted_count += 1
        
        # Delete the channel itself
        channel.delete()
        
        return Response({
            'message': f'Channel deleted successfully. Removed {deleted_count} audio files.'
        }, status=status.HTTP_200_OK)
