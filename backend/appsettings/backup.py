"""Library backup & restore (F14).

Exports the requesting user's library DEFINITION (which tracks/playlists/smart rules/
channel subs they have, plus preferences) as a versioned JSON bundle, and restores it
into an account. Media blobs are never included — audio re-downloads from youtube_id.

Security invariants:
  - ownership is ALWAYS request.user; owner/user ids in the JSON are ignored.
  - restore is idempotent (get_or_create on natural keys), wrapped in a transaction.
  - envelope is version- and shape-validated; per-entity counts are capped so a crafted
    backup cannot mass-create rows or flood the download queue.
"""

import logging
import re

from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 1
APP_NAME = 'soundwave'

# Per-entity caps — reject the whole payload above these before any DB work.
MAX_AUDIO = 5000
MAX_PLAYLISTS = 500
MAX_PLAYLIST_ITEMS = 20000
MAX_SMART_PLAYLISTS = 200
MAX_RULES_PER_SMART = 50
MAX_CHANNELS = 1000
# Enqueue a download for every restored-but-not-downloaded track — kept equal to
# MAX_AUDIO so a restore never leaves placeholder rows with nothing driving them.
MAX_DOWNLOAD_ENQUEUE = MAX_AUDIO

_ALLOWED_TOP_LEVEL_KEYS = {
    'schema_version', 'app', 'exported_at',
    'audio', 'playlists', 'smart_playlists', 'channels', 'user_config',
}

# youtube_id / channel_id / playlist_id charset — guards values before they reach a URL.
# fullmatch (below) anchors the whole string, so a trailing newline is rejected.
_NATURAL_KEY_PATTERN = re.compile(r'[A-Za-z0-9_-]{1,100}')

_USER_CONFIG_FIELDS = [
    'theme', 'volume', 'repeat_mode', 'shuffle_enabled', 'smart_shuffle_enabled',
    'smart_shuffle_history_size', 'visualizer_theme', 'visualizer_enabled',
    'visualizer_glow', 'seek_duration', 'audio_quality', 'items_per_page',
    'prefetch_enabled', 'extra_settings',
]
# Restore coerces UserConfig by type so a malformed backup can't corrupt config or
# raise on save; anything of the wrong type is skipped.
_USER_CONFIG_INT_FIELDS = {'volume', 'smart_shuffle_history_size', 'seek_duration', 'items_per_page'}
_USER_CONFIG_BOOL_FIELDS = {'shuffle_enabled', 'smart_shuffle_enabled', 'visualizer_enabled', 'visualizer_glow', 'prefetch_enabled'}
_USER_CONFIG_STR_FIELDS = {'theme', 'repeat_mode', 'visualizer_theme', 'audio_quality'}

_RULE_FIELDS = ['field', 'operator', 'value', 'value_2']

# Restored channel sync depth must obey the same allow-list as F6 (bounds sync fan-out).
_ALLOWED_SYNC_DEPTHS = (0, 25, 50, 100, 200)


class BackupValidationError(Exception):
    """Raised when a restore payload is malformed, wrong-version, or over a cap."""

    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _iso(value):
    return value.isoformat() if value else None


def _as_str(value):
    return value if isinstance(value, str) else ''


def _as_int(value, default):
    return value if isinstance(value, int) and not isinstance(value, bool) else default


def _as_optional_int(value):
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _as_datetime(value):
    return parse_datetime(value) if isinstance(value, str) else None


def _valid_natural_key(value):
    return isinstance(value, str) and bool(_NATURAL_KEY_PATTERN.fullmatch(value))


def _as_list(value):
    return value if isinstance(value, list) else []


def _clamp_sync_depth(value):
    depth = _as_int(value, 50)
    return depth if depth in _ALLOWED_SYNC_DEPTHS else 50


# --------------------------------------------------------------------------- build

def build_backup(user):
    """Serialize the user's library definition into a versioned JSON-safe dict."""
    from audio.models import Audio
    from playlist.models import Playlist
    from playlist.models_smart import SmartPlaylist
    from channel.models import Channel

    return {
        'schema_version': SCHEMA_VERSION,
        'app': APP_NAME,
        'exported_at': timezone.now().isoformat(),
        'audio': [_serialize_audio(a) for a in Audio.objects.filter(owner=user)],
        'playlists': [
            _serialize_playlist(p)
            for p in Playlist.objects.filter(owner=user).prefetch_related('items__audio')
        ],
        'smart_playlists': [
            _serialize_smart(s)
            for s in SmartPlaylist.objects.filter(owner=user).prefetch_related('rules')
        ],
        'channels': [_serialize_channel(c) for c in Channel.objects.filter(owner=user)],
        'user_config': _serialize_user_config(user),
    }


def library_counts(user):
    """Lightweight manifest of what a backup would contain (for the list endpoint)."""
    from audio.models import Audio
    from playlist.models import Playlist
    from playlist.models_smart import SmartPlaylist
    from channel.models import Channel

    return {
        'audio': Audio.objects.filter(owner=user).count(),
        'playlists': Playlist.objects.filter(owner=user).count(),
        'smart_playlists': SmartPlaylist.objects.filter(owner=user, is_system=False).count(),
        'channels': Channel.objects.filter(owner=user, subscribed=True).count(),
        'favorites': Audio.objects.filter(owner=user, is_favorite=True).count(),
    }


def _serialize_audio(audio):
    # Lean, definition-only entry: identity + display + user-state. Heavy/derivable fields
    # (description, chapters, counts, enrichment) are re-populated by the download task.
    return {
        'youtube_id': audio.youtube_id,
        'title': audio.title,
        'channel_id': audio.channel_id,
        'channel_name': audio.channel_name,
        'duration': audio.duration,
        'published_date': _iso(audio.published_date),
        'thumbnail_url': audio.thumbnail_url,
        'artist': audio.artist,
        'album': audio.album,
        'year': audio.year,
        'genre': audio.genre,
        'track_number': audio.track_number,
        'is_favorite': audio.is_favorite,
        'play_count': audio.play_count,
        'last_played': _iso(audio.last_played),
    }


def _serialize_playlist(playlist):
    items = [
        {'youtube_id': item.audio.youtube_id, 'position': item.position}
        for item in playlist.items.all()
        if item.audio and item.audio.youtube_id
    ]
    items.sort(key=lambda entry: entry['position'])
    return {
        'playlist_id': playlist.playlist_id,
        'title': playlist.title,
        'description': playlist.description,
        'playlist_type': playlist.playlist_type,
        'channel_id': playlist.channel_id,
        'channel_name': playlist.channel_name,
        'subscribed': playlist.subscribed,
        'thumbnail_url': playlist.thumbnail_url,
        'auto_download': playlist.auto_download,
        'items': items,
    }


def _serialize_smart(smart_playlist):
    return {
        'name': smart_playlist.name,
        'description': smart_playlist.description,
        'icon': smart_playlist.icon,
        'color': smart_playlist.color,
        'match_mode': smart_playlist.match_mode,
        'order_by': smart_playlist.order_by,
        'limit': smart_playlist.limit,
        'is_system': smart_playlist.is_system,
        'preset_type': smart_playlist.preset_type,
        'rules': [
            {'field': rule.field, 'operator': rule.operator, 'value': rule.value, 'value_2': rule.value_2}
            for rule in smart_playlist.rules.order_by('order')
        ],
    }


def _serialize_channel(channel):
    return {
        'channel_id': channel.channel_id,
        'channel_name': channel.channel_name,
        'channel_description': channel.channel_description,
        'channel_thumbnail': channel.channel_thumbnail,
        'subscribed': channel.subscribed,
        'auto_download': channel.auto_download,
        'download_quality': channel.download_quality,
        'sync_depth': channel.sync_depth,
    }


def _serialize_user_config(user):
    from user.models import UserConfig
    config, _ = UserConfig.objects.get_or_create(user=user)
    return {field: getattr(config, field) for field in _USER_CONFIG_FIELDS}


# ------------------------------------------------------------------------- restore

def _validate_envelope(data):
    if not isinstance(data, dict):
        raise BackupValidationError('Invalid backup: expected a JSON object')
    if data.get('schema_version') != SCHEMA_VERSION:
        raise BackupValidationError(f'Unsupported backup version (expected {SCHEMA_VERSION})')
    if data.get('app') != APP_NAME:
        raise BackupValidationError('This file is not a SoundWave backup')

    unknown = set(data.keys()) - _ALLOWED_TOP_LEVEL_KEYS
    if unknown:
        raise BackupValidationError(f'Unknown fields in backup: {", ".join(sorted(unknown))}')

    _reject_over_cap(data.get('audio'), MAX_AUDIO, 'audio')
    _reject_over_cap(data.get('playlists'), MAX_PLAYLISTS, 'playlists')
    _reject_over_cap(data.get('smart_playlists'), MAX_SMART_PLAYLISTS, 'smart_playlists')
    _reject_over_cap(data.get('channels'), MAX_CHANNELS, 'channels')

    total_items = sum(len(_as_list(p.get('items'))) for p in _as_list(data.get('playlists')) if isinstance(p, dict))
    if total_items > MAX_PLAYLIST_ITEMS:
        raise BackupValidationError('Backup has too many playlist items')


def _reject_over_cap(value, cap, label):
    if value is None:
        return
    if not isinstance(value, list):
        raise BackupValidationError(f'Invalid backup: "{label}" must be a list')
    if len(value) > cap:
        raise BackupValidationError(f'Backup has too many {label} (limit {cap})')


def restore_backup(request, data, dry_run=False):
    """Validate then either preview (dry-run counts) or apply the restore.

    Ownership is taken solely from request.user. Returns a summary dict of counts.
    """
    _validate_envelope(data)
    user = request.user

    audio_list = _as_list(data.get('audio'))
    playlist_list = _as_list(data.get('playlists'))
    smart_list = _as_list(data.get('smart_playlists'))
    channel_list = _as_list(data.get('channels'))

    if dry_run:
        return _preview(user, audio_list, playlist_list, smart_list, channel_list)
    return _apply(request, audio_list, playlist_list, smart_list, channel_list, data.get('user_config'))


def _preview(user, audio_list, playlist_list, smart_list, channel_list):
    # Apply the SAME validity predicates the restore functions use, so the preview the
    # user confirms matches what apply will actually create.
    from audio.models import Audio
    from playlist.models import Playlist
    from playlist.models_smart import SmartPlaylist
    from channel.models import Channel
    from download.models import DownloadQueue

    backup_audio_ids = {a.get('youtube_id') for a in audio_list if isinstance(a, dict) and _valid_natural_key(a.get('youtube_id'))}
    valid_playlists = [p for p in playlist_list if isinstance(p, dict) and _valid_natural_key(p.get('playlist_id'))]
    valid_channels = [c for c in channel_list if isinstance(c, dict) and _valid_natural_key(c.get('channel_id'))]
    valid_smart = [
        s for s in smart_list
        if isinstance(s, dict) and not s.get('is_system')
        and isinstance(s.get('name'), str) and s.get('name').strip()
    ]

    existing_audio_ids = set(Audio.objects.filter(owner=user).values_list('youtube_id', flat=True))
    downloaded_ids = set(Audio.objects.filter(owner=user).exclude(file_path='').values_list('youtube_id', flat=True))
    active_queue_ids = set(
        DownloadQueue.objects.filter(owner=user, youtube_id__in=backup_audio_ids)
        .exclude(status='failed').values_list('youtube_id', flat=True)
    )
    existing_playlists = set(Playlist.objects.filter(owner=user).values_list('playlist_id', flat=True))
    existing_channels = set(Channel.objects.filter(owner=user).values_list('channel_id', flat=True))
    existing_smart_names = set(SmartPlaylist.objects.filter(owner=user).values_list('name', flat=True))

    downloads = [yid for yid in backup_audio_ids if yid not in downloaded_ids and yid not in active_queue_ids]

    return {
        'audio_total': len(backup_audio_ids),
        'audio_new': len(backup_audio_ids - existing_audio_ids),
        'playlists_total': len(valid_playlists),
        'playlists_new': len([p for p in valid_playlists if p.get('playlist_id') not in existing_playlists]),
        'smart_playlists_total': len(valid_smart),
        'smart_playlists_new': len([s for s in valid_smart if s.get('name') not in existing_smart_names]),
        'channels_total': len(valid_channels),
        'channels_new': len([c for c in valid_channels if c.get('channel_id') not in existing_channels]),
        'downloads_to_enqueue': min(len(downloads), MAX_DOWNLOAD_ENQUEUE),
    }


def _apply(request, audio_list, playlist_list, smart_list, channel_list, user_config):
    user = request.user
    summary = {
        'channels_created': 0,
        'audio_created': 0,
        'playlists_created': 0,
        'playlist_items_created': 0,
        'smart_playlists_created': 0,
        'downloads_enqueued': 0,
    }

    with transaction.atomic():
        _restore_user_config(user, user_config)
        _restore_channels(user, channel_list, summary)
        audio_map = _restore_audio(user, audio_list, summary)
        _restore_playlists(user, playlist_list, audio_map, summary)
        _restore_smart_playlists(request, smart_list, summary)

    # Enqueue AFTER commit so the worker sees the committed placeholder rows.
    _enqueue_downloads(user, audio_list, summary)
    return summary


def _restore_user_config(user, user_config):
    if not isinstance(user_config, dict):
        return
    from user.models import UserConfig
    config, _ = UserConfig.objects.get_or_create(user=user)
    for field in _USER_CONFIG_FIELDS:
        if field not in user_config:
            continue
        value = user_config[field]
        if field == 'extra_settings':
            if isinstance(value, dict):
                config.extra_settings = value
        elif field in _USER_CONFIG_INT_FIELDS:
            if isinstance(value, int) and not isinstance(value, bool):
                setattr(config, field, value)
        elif field in _USER_CONFIG_BOOL_FIELDS:
            if isinstance(value, bool):
                setattr(config, field, value)
        elif field in _USER_CONFIG_STR_FIELDS:
            if isinstance(value, str):
                setattr(config, field, value)
    config.save()


def _restore_channels(user, channel_list, summary):
    from channel.models import Channel
    for entry in channel_list:
        if not isinstance(entry, dict) or not _valid_natural_key(entry.get('channel_id')):
            continue
        _, created = Channel.objects.get_or_create(
            owner=user,
            channel_id=entry['channel_id'],
            defaults={
                'channel_name': _as_str(entry.get('channel_name')),
                'channel_description': _as_str(entry.get('channel_description')),
                'channel_thumbnail': _as_str(entry.get('channel_thumbnail')),
                'subscribed': bool(entry.get('subscribed', True)),
                'auto_download': bool(entry.get('auto_download', True)),
                'download_quality': _as_str(entry.get('download_quality')) or 'auto',
                'sync_depth': _clamp_sync_depth(entry.get('sync_depth')),
            },
        )
        if created:
            summary['channels_created'] += 1


def _audio_placeholder_defaults(entry):
    return {
        'title': _as_str(entry.get('title')),
        'channel_id': _as_str(entry.get('channel_id')),
        'channel_name': _as_str(entry.get('channel_name')),
        'duration': _as_int(entry.get('duration'), 0),
        'file_path': '',
        'file_size': 0,
        'thumbnail_url': _as_str(entry.get('thumbnail_url')),
        'published_date': _as_datetime(entry.get('published_date')) or timezone.now(),
        'artist': _as_str(entry.get('artist')),
        'album': _as_str(entry.get('album')),
        'year': _as_optional_int(entry.get('year')),
        'genre': _as_str(entry.get('genre')),
        'track_number': _as_optional_int(entry.get('track_number')),
        'is_favorite': bool(entry.get('is_favorite')),
        'play_count': _as_int(entry.get('play_count'), 0),
        'last_played': _as_datetime(entry.get('last_played')),
    }


def _restore_audio(user, audio_list, summary):
    from audio.models import Audio
    audio_map = {}
    for entry in audio_list:
        if not isinstance(entry, dict) or not _valid_natural_key(entry.get('youtube_id')):
            continue
        youtube_id = entry['youtube_id']
        audio_obj, created = Audio.objects.get_or_create(
            owner=user,
            youtube_id=youtube_id,
            defaults=_audio_placeholder_defaults(entry),
        )
        if created:
            summary['audio_created'] += 1
        elif entry.get('is_favorite') and not audio_obj.is_favorite:
            audio_obj.is_favorite = True
            audio_obj.save(update_fields=['is_favorite'])
        audio_map[youtube_id] = audio_obj
    return audio_map


def _resolve_audio(user, youtube_id, audio_map):
    if youtube_id in audio_map:
        return audio_map[youtube_id]
    from audio.models import Audio
    audio_obj, _ = Audio.objects.get_or_create(
        owner=user,
        youtube_id=youtube_id,
        defaults={
            'title': '',
            'channel_id': '',
            'channel_name': '',
            'duration': 0,
            'file_path': '',
            'file_size': 0,
            'published_date': timezone.now(),
        },
    )
    audio_map[youtube_id] = audio_obj
    return audio_obj


def _restore_playlists(user, playlist_list, audio_map, summary):
    from playlist.models import Playlist, PlaylistItem
    for entry in playlist_list:
        if not isinstance(entry, dict) or not _valid_natural_key(entry.get('playlist_id')):
            continue
        playlist, created = Playlist.objects.get_or_create(
            owner=user,
            playlist_id=entry['playlist_id'],
            defaults={
                'title': _as_str(entry.get('title')),
                'description': _as_str(entry.get('description')),
                'playlist_type': _as_str(entry.get('playlist_type')) or 'youtube',
                'channel_id': _as_str(entry.get('channel_id')),
                'channel_name': _as_str(entry.get('channel_name')),
                'subscribed': bool(entry.get('subscribed', False)),
                'thumbnail_url': _as_str(entry.get('thumbnail_url')),
                'auto_download': bool(entry.get('auto_download', False)),
            },
        )
        if created:
            summary['playlists_created'] += 1

        for item in _as_list(entry.get('items')):
            if not isinstance(item, dict) or not _valid_natural_key(item.get('youtube_id')):
                continue
            audio_obj = _resolve_audio(user, item['youtube_id'], audio_map)
            _, item_created = PlaylistItem.objects.get_or_create(
                playlist=playlist,
                audio=audio_obj,
                defaults={'position': _as_int(item.get('position'), 0)},
            )
            if item_created:
                summary['playlist_items_created'] += 1


def _restore_smart_playlists(request, smart_list, summary):
    from playlist.models_smart import SmartPlaylist, SmartPlaylistRule
    from playlist.serializers_smart import SmartPlaylistCreateSerializer

    user = request.user
    existing_names = set(SmartPlaylist.objects.filter(owner=user).values_list('name', flat=True))

    # Drop only invalid rules / default invalid enums, so one bad rule (e.g. from a newer
    # app version) does not discard the whole playlist and its valid rules.
    valid_rule_fields = {choice[0] for choice in SmartPlaylistRule._meta.get_field('field').choices}
    valid_rule_operators = {choice[0] for choice in SmartPlaylistRule._meta.get_field('operator').choices}
    valid_match_modes = {choice[0] for choice in SmartPlaylist._meta.get_field('match_mode').choices}
    valid_order_bys = {choice[0] for choice in SmartPlaylist._meta.get_field('order_by').choices}

    for entry in smart_list:
        if not isinstance(entry, dict) or entry.get('is_system'):
            continue
        name = entry.get('name')
        if not isinstance(name, str) or not name.strip() or name in existing_names:
            continue

        rules = [
            rule for rule in _as_list(entry.get('rules'))
            if isinstance(rule, dict)
            and rule.get('field') in valid_rule_fields
            and rule.get('operator') in valid_rule_operators
        ][:MAX_RULES_PER_SMART]

        match_mode = _as_str(entry.get('match_mode'))
        order_by = _as_str(entry.get('order_by'))
        payload = {
            'name': name,
            'description': _as_str(entry.get('description')),
            'icon': _as_str(entry.get('icon')) or 'auto_awesome',
            'color': _as_str(entry.get('color')) or '#7C3AED',
            'match_mode': match_mode if match_mode in valid_match_modes else 'all',
            'order_by': order_by if order_by in valid_order_bys else '-downloaded_date',
            'limit': _as_optional_int(entry.get('limit')),
            'rules': [{key: _as_str(rule.get(key)) for key in _RULE_FIELDS} for rule in rules],
        }
        serializer = SmartPlaylistCreateSerializer(data=payload, context={'request': request})
        if not serializer.is_valid():
            logger.info('[Restore] Skipping invalid smart playlist "%s": %s', name, serializer.errors)
            continue
        serializer.save(owner=user)
        existing_names.add(name)
        summary['smart_playlists_created'] += 1


def _enqueue_downloads(user, audio_list, summary):
    from audio.models import Audio
    from download.models import DownloadQueue
    from task.tasks import download_audio_task

    downloaded_ids = set(Audio.objects.filter(owner=user).exclude(file_path='').values_list('youtube_id', flat=True))
    enqueued = 0
    for entry in audio_list:
        if enqueued >= MAX_DOWNLOAD_ENQUEUE:
            break
        if not isinstance(entry, dict) or not _valid_natural_key(entry.get('youtube_id')):
            continue
        youtube_id = entry['youtube_id']
        if youtube_id in downloaded_ids:
            continue
        queue_item, created = DownloadQueue.objects.get_or_create(
            owner=user,
            youtube_id=youtube_id,
            defaults={
                'url': f'https://www.youtube.com/watch?v={youtube_id}',
                'title': _as_str(entry.get('title')),
                'channel_name': _as_str(entry.get('channel_name')),
                'auto_start': True,
            },
        )
        if created or queue_item.status == 'failed':
            download_audio_task.delay(queue_item.id)
            enqueued += 1
    summary['downloads_enqueued'] = enqueued
