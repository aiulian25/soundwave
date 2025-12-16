"""Admin views for user management"""
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, IsAdminUser
from django.db.models import Count, Sum, Q
from django.contrib.auth import get_user_model

from user.models import UserYouTubeAccount
from user.serializers_admin import (
    UserDetailSerializer,
    UserCreateSerializer,
    UserUpdateSerializer,
    UserStatsSerializer,
    UserYouTubeAccountSerializer,
    UserYouTubeAccountCreateSerializer,
)
from channel.models import Channel
from playlist.models import Playlist
from audio.models import Audio

User = get_user_model()


class IsAdminOrSelf(IsAuthenticated):
    """Permission: Admin can access all, users can access only their own data"""
    
    def has_object_permission(self, request, view, obj):
        if request.user.is_admin or request.user.is_superuser:
            return True
        if hasattr(obj, 'owner'):
            return obj.owner == request.user
        if hasattr(obj, 'user'):
            return obj.user == request.user
        return obj == request.user


class UserManagementViewSet(viewsets.ModelViewSet):
    """Admin viewset for managing users"""
    queryset = User.objects.all()
    permission_classes = [IsAdminUser]
    
    def get_serializer_class(self):
        if self.action == 'create':
            return UserCreateSerializer
        elif self.action in ['update', 'partial_update']:
            return UserUpdateSerializer
        return UserDetailSerializer
    
    def get_queryset(self):
        """Filter users based on permissions"""
        queryset = User.objects.all()
        
        # Admin sees all, regular users see only themselves
        if not (self.request.user.is_admin or self.request.user.is_superuser):
            queryset = queryset.filter(id=self.request.user.id)
        
        # Add annotations
        queryset = queryset.annotate(
            channels_count=Count('channels', distinct=True),
            playlists_count=Count('playlists', distinct=True),
            audio_count=Count('audio_files', distinct=True),
        )
        
        return queryset.order_by('-date_joined')
    
    @action(detail=True, methods=['get'])
    def stats(self, request, pk=None):
        """Get detailed statistics for a user"""
        user = self.get_object()
        
        stats = {
            'total_channels': Channel.objects.filter(owner=user).count(),
            'active_channels': Channel.objects.filter(owner=user, subscribed=True).count(),
            'total_playlists': Playlist.objects.filter(owner=user).count(),
            'subscribed_playlists': Playlist.objects.filter(owner=user, subscribed=True).count(),
            'total_audio_files': Audio.objects.filter(owner=user).count(),
            'storage_used_gb': user.storage_used_gb,
            'storage_quota_gb': user.storage_quota_gb,
            'storage_percent': user.storage_percent_used,
            'youtube_accounts': UserYouTubeAccount.objects.filter(user=user).count(),
        }
        
        serializer = UserStatsSerializer(stats)
        return Response(serializer.data)
    
    @action(detail=True, methods=['post'])
    def reset_storage(self, request, pk=None):
        """Reset user storage usage"""
        user = self.get_object()
        user.storage_used_gb = 0.0
        user.save()
        return Response({'message': 'Storage reset successfully'})
    
    @action(detail=True, methods=['post'])
    def reset_2fa(self, request, pk=None):
        """Reset user 2FA"""
        user = self.get_object()
        user.two_factor_enabled = False
        user.two_factor_secret = ''
        user.backup_codes = []
        user.save()
        return Response({'message': '2FA reset successfully'})
    
    @action(detail=True, methods=['post'])
    def toggle_active(self, request, pk=None):
        """Toggle user active status"""
        user = self.get_object()
        user.is_active = not user.is_active
        user.save()
        return Response({
            'message': f'User {"activated" if user.is_active else "deactivated"}',
            'is_active': user.is_active
        })
    
    @action(detail=True, methods=['get'])
    def channels(self, request, pk=None):
        """Get user's channels"""
        user = self.get_object()
        channels = Channel.objects.filter(owner=user).values(
            'id', 'channel_name', 'channel_id', 'subscribed', 'video_count'
        )
        return Response(channels)
    
    @action(detail=True, methods=['get'])
    def playlists(self, request, pk=None):
        """Get user's playlists"""
        user = self.get_object()
        playlists = Playlist.objects.filter(owner=user).values(
            'id', 'title', 'playlist_id', 'subscribed', 'playlist_type'
        )
        return Response(playlists)
    
    @action(detail=False, methods=['get'])
    def system_stats(self, request):
        """Get system-wide statistics"""
        total_users = User.objects.count()
        active_users = User.objects.filter(is_active=True).count()
        admin_users = User.objects.filter(Q(is_admin=True) | Q(is_superuser=True)).count()
        
        total_channels = Channel.objects.count()
        total_playlists = Playlist.objects.count()
        total_audio = Audio.objects.count()
        
        total_storage = User.objects.aggregate(
            used=Sum('storage_used_gb'),
            quota=Sum('storage_quota_gb')
        )
        
        return Response({
            'users': {
                'total': total_users,
                'active': active_users,
                'admin': admin_users,
            },
            'content': {
                'channels': total_channels,
                'playlists': total_playlists,
                'audio_files': total_audio,
            },
            'storage': {
                'used_gb': total_storage['used'] or 0,
                'quota_gb': total_storage['quota'] or 0,
            }
        })


class UserYouTubeAccountViewSet(viewsets.ModelViewSet):
    """ViewSet for managing user YouTube accounts"""
    permission_classes = [IsAdminOrSelf]
    
    def get_serializer_class(self):
        if self.action == 'create':
            return UserYouTubeAccountCreateSerializer
        return UserYouTubeAccountSerializer
    
    def get_queryset(self):
        """Filter by user"""
        queryset = UserYouTubeAccount.objects.all()
        
        # Regular users see only their accounts
        if not (self.request.user.is_admin or self.request.user.is_superuser):
            queryset = queryset.filter(user=self.request.user)
        
        # Filter by user_id if provided
        user_id = self.request.query_params.get('user_id')
        if user_id:
            queryset = queryset.filter(user_id=user_id)
        
        return queryset.order_by('-created_date')
    
    def perform_create(self, serializer):
        """Set user from request"""
        serializer.save(user=self.request.user)
    
    @action(detail=True, methods=['post'])
    def verify(self, request, pk=None):
        """Verify YouTube account credentials"""
        account = self.get_object()
        # TODO: Implement actual verification logic
        from django.utils import timezone
        account.last_verified = timezone.now()
        account.save()
        return Response({'message': 'Account verified successfully'})
    
    @action(detail=True, methods=['post'])
    def toggle_active(self, request, pk=None):
        """Toggle account active status"""
        account = self.get_object()
        account.is_active = not account.is_active
        account.save()
        return Response({
            'message': f'Account {"activated" if account.is_active else "deactivated"}',
            'is_active': account.is_active
        })
