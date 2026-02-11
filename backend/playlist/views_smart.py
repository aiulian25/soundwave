"""Smart Playlist API views"""

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from playlist.models_smart import SmartPlaylist, SmartPlaylistRule, create_system_smart_playlists

# Valid choices for input validation (prevent injection via unvalidated fields)
ALLOWED_FIELDS = {choice[0] for choice in SmartPlaylistRule.FIELD_CHOICES}
ALLOWED_OPERATORS = {choice[0] for choice in SmartPlaylistRule.OPERATOR_CHOICES}
ALLOWED_ORDER_BY = {choice[0] for choice in SmartPlaylist.ORDER_BY_CHOICES}

from playlist.serializers_smart import (
    SmartPlaylistSerializer,
    SmartPlaylistCreateSerializer,
    SmartPlaylistUpdateSerializer,
    SmartPlaylistRuleSerializer,
)
from audio.serializers import AudioSerializer
from common.views import ApiBaseView, AdminWriteOnly


class SmartPlaylistListView(ApiBaseView):
    """Smart playlist list endpoint"""
    permission_classes = [AdminWriteOnly]
    
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
    permission_classes = [AdminWriteOnly]
    
    def get(self, request, playlist_id):
        """Get smart playlist details with tracks"""
        smart_playlist = get_object_or_404(SmartPlaylist, id=playlist_id, owner=request.user)
        
        # Check if tracks are requested
        include_tracks = request.query_params.get('include_tracks', 'false').lower() == 'true'
        
        response_data = SmartPlaylistSerializer(smart_playlist).data
        
        if include_tracks:
            # Get matching tracks
            tracks = smart_playlist.get_queryset()
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
        
        # Get matching tracks
        tracks = smart_playlist.get_queryset()
        
        # Pagination
        page = int(request.query_params.get('page', 1))
        page_size = int(request.query_params.get('page_size', 50))
        start = (page - 1) * page_size
        end = start + page_size
        
        # Get total count before pagination
        total_count = smart_playlist.get_track_count()
        
        # Apply pagination (unless random ordering with limit already applied)
        if smart_playlist.order_by != 'random':
            tracks = tracks[start:end]
        
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
            },
            'total_count': total_count,
            'page': page,
            'page_size': page_size,
            'has_more': (page * page_size) < total_count
        })


class SmartPlaylistRulesView(ApiBaseView):
    """Manage rules for a smart playlist"""
    permission_classes = [AdminWriteOnly]
    
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
        
        rules_data = request.data.get('rules', [])
        
        # Validate rule fields and operators before processing
        for rule_data in rules_data:
            field = rule_data.get('field')
            operator = rule_data.get('operator')
            if field not in ALLOWED_FIELDS:
                return Response(
                    {'error': f'Invalid field: {field}'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            if operator not in ALLOWED_OPERATORS:
                return Response(
                    {'error': f'Invalid operator: {operator}'},
                    status=status.HTTP_400_BAD_REQUEST
                )

        # Delete existing rules
        smart_playlist.rules.all().delete()

        # Create new rules
        created_rules = []
        for i, rule_data in enumerate(rules_data):
            rule = SmartPlaylistRule.objects.create(
                smart_playlist=smart_playlist,
                order=i,
                field=rule_data.get('field'),
                operator=rule_data.get('operator'),
                value=rule_data.get('value', ''),
                value_2=rule_data.get('value_2', ''),
            )
            created_rules.append(rule)
        
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
        
        # Group operators by field type for frontend convenience
        text_operators = ['contains', 'not_contains', 'equals', 'not_equals', 'starts_with', 'ends_with', 'is_set', 'is_not_set']
        numeric_operators = ['equals', 'not_equals', 'greater_than', 'less_than', 'greater_equal', 'less_equal', 'between']
        date_operators = ['in_last_days', 'not_in_last_days', 'before_date', 'after_date', 'is_set', 'is_not_set']
        boolean_operators = ['is_true', 'is_false']
        
        # Map fields to their applicable operator types
        field_types = {
            'title': 'text',
            'artist': 'text',
            'album': 'text',
            'genre': 'text',
            'channel_name': 'text',
            'year': 'numeric',
            'play_count': 'numeric',
            'duration': 'numeric',
            'last_played': 'date',
            'downloaded_date': 'date',
            'is_favorite': 'boolean',
        }
        
        return Response({
            'fields': fields,
            'operators': operators,
            'order_by_options': order_by_options,
            'field_types': field_types,
            'operator_groups': {
                'text': text_operators,
                'numeric': numeric_operators,
                'date': date_operators,
                'boolean': boolean_operators,
            }
        })


class SmartPlaylistPreviewView(ApiBaseView):
    """Preview tracks that would match given rules (without saving)"""
    
    def post(self, request):
        """Preview matching tracks for given rules"""
        from audio.models import Audio
        from django.db.models import Q
        
        rules_data = request.data.get('rules', [])
        match_mode = request.data.get('match_mode', 'all')
        order_by = request.data.get('order_by', '-downloaded_date')
        limit = request.data.get('limit')
        
        # Validate order_by against allowed choices (prevent field enumeration/injection)
        if order_by not in ALLOWED_ORDER_BY:
            return Response(
                {'error': f'Invalid order_by value: {order_by}'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Validate match_mode
        if match_mode not in ('all', 'any'):
            return Response(
                {'error': f'Invalid match_mode: {match_mode}'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Validate rule fields and operators
        for rule_data in rules_data:
            field = rule_data.get('field')
            operator = rule_data.get('operator')
            if field not in ALLOWED_FIELDS:
                return Response(
                    {'error': f'Invalid field: {field}'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            if operator not in ALLOWED_OPERATORS:
                return Response(
                    {'error': f'Invalid operator: {operator}'},
                    status=status.HTTP_400_BAD_REQUEST
                )

        # Build queryset
        queryset = Audio.objects.filter(owner=request.user)

        if rules_data:
            # Create temporary smart playlist to use its rule evaluation
            temp_playlist = SmartPlaylist(
                owner=request.user,
                match_mode=match_mode,
                order_by=order_by,
                limit=limit
            )

            if match_mode == 'all':
                for rule_data in rules_data:
                    temp_rule = SmartPlaylistRule(
                        field=rule_data.get('field'),
                        operator=rule_data.get('operator'),
                        value=rule_data.get('value', ''),
                        value_2=rule_data.get('value_2', ''),
                    )
                    rule_q = temp_playlist._build_rule_q(temp_rule)
                    if rule_q:
                        queryset = queryset.filter(rule_q)
            else:
                combined_q = Q()
                for rule_data in rules_data:
                    temp_rule = SmartPlaylistRule(
                        field=rule_data.get('field'),
                        operator=rule_data.get('operator'),
                        value=rule_data.get('value', ''),
                        value_2=rule_data.get('value_2', ''),
                    )
                    rule_q = temp_playlist._build_rule_q(temp_rule)
                    if rule_q:
                        combined_q |= rule_q
                if combined_q:
                    queryset = queryset.filter(combined_q)
        
        # Apply ordering (skip random for preview)
        if order_by != 'random':
            queryset = queryset.order_by(order_by)
        
        # Get count before limit
        total_count = queryset.count()
        
        # Apply limit
        if limit:
            queryset = queryset[:int(limit)]
        
        # Get preview (first 10 tracks)
        preview_tracks = queryset[:10]
        
        return Response({
            'total_count': total_count,
            'preview': AudioSerializer(preview_tracks, many=True).data
        })
