"""Channel API views"""

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from audio.artwork_archive import CHANNEL
from audio.views import kept_artwork_response
from channel.models import Channel
from channel.serializers import ChannelSerializer, ChannelSyncDepthSerializer
from download.claims import cancel_unfinished_downloads
from common.pagination import paginated_response
from common.search import matching, search_term
from common.views import ApiBaseView, AuthenticatedOwnerAccess


CHANNEL_SEARCH_FIELDS = ('channel_name',)


class ChannelListView(ApiBaseView):
    """Channel list endpoint"""
    permission_classes = [AuthenticatedOwnerAccess]

    def get(self, request):
        """Get channel list"""
        import logging
        logger = logging.getLogger(__name__)
        logger.info(f"GET channel list - User: {request.user}, Auth: {request.user.is_authenticated}")
        
        channels = self.filter_owned(Channel.objects.filter(subscribed=True)).order_by('channel_name', 'pk')
        channels = matching(channels, search_term(request), CHANNEL_SEARCH_FIELDS)
        return paginated_response(request, channels, ChannelSerializer)

    def post(self, request):
        """Subscribe to channel - TubeArchivist pattern with Celery task"""
        from channel.serializers import ChannelSubscribeSerializer
        import logging
        import os
        logger = logging.getLogger(__name__)
        
        # Debug logging only if explicitly enabled
        if os.environ.get('DEBUG_LOGGING', '').lower() == 'true':
            logger.debug(f"Channel subscribe - User: {request.user}")
        
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
    permission_classes = [AuthenticatedOwnerAccess]

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

    def patch(self, request, channel_id):
        """Update per-channel sync settings (currently the sync depth)."""
        channel = get_object_or_404(Channel, channel_id=channel_id, owner=request.user)
        serializer = ChannelSyncDepthSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        channel.sync_depth = serializer.validated_data['sync_depth']
        channel.save(update_fields=['sync_depth'])
        return Response(ChannelSerializer(channel).data)

    def delete(self, request, channel_id):
        """Unsubscribe: stops syncing and cancels unfinished work; its tracks stay in the library"""
        channel = get_object_or_404(Channel, channel_id=channel_id, owner=request.user)
        cancel_unfinished_downloads(request.user, channel_name=channel.channel_name)
        channel.delete()
        
        return Response({
            'message': 'Unsubscribed from channel. Its tracks were kept.'
        }, status=status.HTTP_200_OK)


class ChannelArtworkView(ApiBaseView):
    """A channel's picture, served from this server"""
    permission_classes = [AuthenticatedOwnerAccess]

    def get(self, request, channel_id):
        channel = get_object_or_404(Channel, channel_id=channel_id, owner=request.user)
        return kept_artwork_response(CHANNEL, channel)


class ChannelSyncView(ApiBaseView):
    """Trigger an immediate sync (deep backfill) for a single channel."""
    permission_classes = [AuthenticatedOwnerAccess]

    def post(self, request, channel_id):
        """Queue a sync for the channel using its stored sync_depth."""
        channel = get_object_or_404(Channel, channel_id=channel_id, owner=request.user)

        if channel.sync_status == 'syncing':
            return Response(
                {'message': 'Channel is already syncing'},
                status=status.HTTP_409_CONFLICT
            )

        from task.tasks import download_channel_task
        task = download_channel_task.delay(channel.id)
        return Response(
            {'message': 'Channel sync started', 'task_id': str(task.id)},
            status=status.HTTP_202_ACCEPTED
        )
