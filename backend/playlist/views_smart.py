"""Smart Playlist API views"""

import random

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from playlist.models_smart import RANDOM_ORDER, SmartPlaylist, SmartPlaylistRule, create_system_smart_playlists
from playlist.smart_rules import FIELD_TYPES, OPERATOR_GROUPS

from playlist.serializers_smart import (
    SmartPlaylistSerializer,
    SmartPlaylistCreateSerializer,
    SmartPlaylistUpdateSerializer,
    SmartPlaylistRuleSerializer,
    SmartPlaylistRulesReplaceSerializer,
    SmartPlaylistPreviewSerializer,
)
from audio.serializers import AudioSerializer
from common.views import ApiBaseView, AuthenticatedOwnerAccess

MAX_TRACKS_PAGE_SIZE = 100
PREVIEW_SIZE = 10
SHUFFLE_SEED_RANGE = 2 ** 31


def _shuffle_seed(request):
    """The order a random playlist is walked in; the client sends back the seed it was given."""
    raw_seed = request.query_params.get('seed')
    if raw_seed is None:
        return random.randrange(SHUFFLE_SEED_RANGE)
    try:
        return int(raw_seed)
    except ValueError as error:
        raise ValidationError({'seed': 'Must be a whole number.'}) from error


class SmartPlaylistListView(ApiBaseView):
    """Smart playlist list endpoint"""
    permission_classes = [AuthenticatedOwnerAccess]
    
    def get(self, request):
        """Get all smart playlists for the user"""
        # Ensure system playlists exist
        create_system_smart_playlists(request.user)
        
        smart_playlists = SmartPlaylist.objects.filter(owner=request.user)
        serializer = SmartPlaylistSerializer(smart_playlists, many=True)
        return Response({'data': serializer.data})
    
    def post(self, request):
        """Create a new smart playlist"""
        serializer = SmartPlaylistCreateSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        smart_playlist = serializer.save(owner=request.user)
        
        return Response(
            SmartPlaylistSerializer(smart_playlist).data,
            status=status.HTTP_201_CREATED
        )


class SmartPlaylistDetailView(ApiBaseView):
    """Smart playlist detail endpoint"""
    permission_classes = [AuthenticatedOwnerAccess]
    
    def get(self, request, playlist_id):
        """Get smart playlist details with tracks"""
        smart_playlist = get_object_or_404(SmartPlaylist, id=playlist_id, owner=request.user)
        
        # Check if tracks are requested
        include_tracks = request.query_params.get('include_tracks', 'false').lower() == 'true'
        
        response_data = SmartPlaylistSerializer(smart_playlist).data
        
        if include_tracks:
            tracks = smart_playlist.tracks_page(0, MAX_TRACKS_PAGE_SIZE)
            response_data['tracks'] = AudioSerializer(tracks, many=True).data
        
        return Response(response_data)
    
    def put(self, request, playlist_id):
        """Update a smart playlist"""
        smart_playlist = get_object_or_404(SmartPlaylist, id=playlist_id, owner=request.user)
        
        serializer = SmartPlaylistUpdateSerializer(
            smart_playlist,
            data=request.data,
            context={'request': request},
            partial=True
        )
        serializer.is_valid(raise_exception=True)
        smart_playlist = serializer.save()
        
        return Response(SmartPlaylistSerializer(smart_playlist).data)
    
    def delete(self, request, playlist_id):
        """Delete a smart playlist"""
        smart_playlist = get_object_or_404(SmartPlaylist, id=playlist_id, owner=request.user)
        
        # Don't allow deleting system playlists
        if smart_playlist.is_system:
            return Response(
                {'error': 'Cannot delete system smart playlists'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        smart_playlist.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class SmartPlaylistTracksView(ApiBaseView):
    """Get tracks for a smart playlist"""
    
    def get(self, request, playlist_id):
        """Get tracks matching the smart playlist rules"""
        smart_playlist = get_object_or_404(SmartPlaylist, id=playlist_id, owner=request.user)
        
        # Pagination: fall back to defaults on non-numeric input and clamp page_size
        # so a client can't request an unbounded result set.
        try:
            page = max(1, int(request.query_params.get('page', 1)))
        except (TypeError, ValueError):
            page = 1
        try:
            page_size = min(MAX_TRACKS_PAGE_SIZE, max(1, int(request.query_params.get('page_size', 50))))
        except (TypeError, ValueError):
            page_size = 50
        start = (page - 1) * page_size
        end = start + page_size
        
        # Get total count before pagination
        total_count = smart_playlist.get_track_count()
        
        shuffle_seed = _shuffle_seed(request) if smart_playlist.order_by == RANDOM_ORDER else None
        tracks = smart_playlist.tracks_page(start, end, shuffle_seed)
        
        serializer = AudioSerializer(tracks, many=True)
        
        return Response({
            'data': serializer.data,
            'playlist': {
                'id': smart_playlist.id,
                'name': smart_playlist.name,
                'description': smart_playlist.description,
                'icon': smart_playlist.icon,
                'color': smart_playlist.color,
                'is_system': smart_playlist.is_system,
                'invalid_rule_ids': smart_playlist.invalid_rule_ids(),
            },
            'total_count': total_count,
            'page': page,
            'page_size': page_size,
            'has_more': end < total_count,
            'next': page + 1 if end < total_count else None,
            'seed': shuffle_seed,
        })


class SmartPlaylistRulesView(ApiBaseView):
    """Manage rules for a smart playlist"""
    permission_classes = [AuthenticatedOwnerAccess]
    
    def get(self, request, playlist_id):
        """Get rules for a smart playlist"""
        smart_playlist = get_object_or_404(SmartPlaylist, id=playlist_id, owner=request.user)
        rules = smart_playlist.rules.all()
        serializer = SmartPlaylistRuleSerializer(rules, many=True)
        return Response({'data': serializer.data})
    
    def post(self, request, playlist_id):
        """Add a rule to a smart playlist"""
        smart_playlist = get_object_or_404(SmartPlaylist, id=playlist_id, owner=request.user)
        
        # Don't allow modifying system playlists
        if smart_playlist.is_system:
            return Response(
                {'error': 'Cannot modify rules of system smart playlists'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        serializer = SmartPlaylistRuleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        # Set order to be last
        max_order = smart_playlist.rules.count()
        rule = serializer.save(smart_playlist=smart_playlist, order=max_order)
        smart_playlist.forget_cached_count()
        
        return Response(SmartPlaylistRuleSerializer(rule).data, status=status.HTTP_201_CREATED)
    
    def put(self, request, playlist_id):
        """Replace all rules for a smart playlist"""
        smart_playlist = get_object_or_404(SmartPlaylist, id=playlist_id, owner=request.user)
        
        # Don't allow modifying system playlists
        if smart_playlist.is_system:
            return Response(
                {'error': 'Cannot modify rules of system smart playlists'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        replacement = SmartPlaylistRulesReplaceSerializer(data=request.data)
        replacement.is_valid(raise_exception=True)
        created_rules = smart_playlist.replace_rules(replacement.validated_data['rules'])

        serializer = SmartPlaylistRuleSerializer(created_rules, many=True)
        return Response({'data': serializer.data})


class SmartPlaylistChoicesView(ApiBaseView):
    """Get available choices for creating smart playlist rules"""
    
    def get(self, request):
        """Return available field, operator, and order_by choices"""
        fields = [
            {'value': value, 'label': label}
            for value, label in SmartPlaylistRule.FIELD_CHOICES
        ]
        
        operators = [
            {'value': value, 'label': label}
            for value, label in SmartPlaylistRule.OPERATOR_CHOICES
        ]
        
        order_by_options = [
            {'value': value, 'label': label}
            for value, label in SmartPlaylist.ORDER_BY_CHOICES
        ]
        
        return Response({
            'fields': fields,
            'operators': operators,
            'order_by_options': order_by_options,
            'field_types': FIELD_TYPES,
            'operator_groups': OPERATOR_GROUPS,
        })


class SmartPlaylistPreviewView(ApiBaseView):
    """Preview tracks that would match given rules (without saving)"""
    
    def post(self, request):
        """Preview matching tracks for given rules"""
        draft = SmartPlaylistPreviewSerializer(data=request.data)
        draft.is_valid(raise_exception=True)
        fields = draft.validated_data

        rules = [SmartPlaylistRule(**rule_data) for rule_data in fields['rules']]
        playlist = SmartPlaylist(
            owner=request.user,
            match_mode=fields['match_mode'],
            order_by=fields['order_by'],
            limit=fields['limit'],
        )

        return Response({
            'total_count': playlist.get_track_count(rules),
            'preview': AudioSerializer(playlist.tracks_page(0, PREVIEW_SIZE, rules=rules), many=True).data,
        })
