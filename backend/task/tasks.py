"""Celery tasks for background processing"""

from celery import shared_task
import yt_dlp
from audio.models import Audio
from channel.models import Channel
from download.models import DownloadQueue
from datetime import datetime, timedelta
from django.utils import timezone
from django.db.models import Q
from django.core.cache import cache
from django.core.exceptions import ObjectDoesNotExist
import os
import logging

logger = logging.getLogger(__name__)

# Auto-disable invalid channel subscriptions after repeated deterministic failures.
# This does NOT remove local audio files.
INVALID_CHANNEL_FAILURE_THRESHOLD = int(os.environ.get('INVALID_CHANNEL_FAILURE_THRESHOLD', '3'))

# Path to YouTube cookies file (mounted in Docker)
COOKIES_FILE = os.environ.get('YT_COOKIES_FILE', '/app/cookies.txt')


def get_yt_dlp_cookies_opts():
    """Return cookiefile option if cookies file exists and is non-empty."""
    if os.path.isfile(COOKIES_FILE) and os.path.getsize(COOKIES_FILE) > 100:
        return {'cookiefile': COOKIES_FILE}
    return {}


# Cache of each YouTube playlist's ordered video-id list. Written by
# download_playlist_task during a sync and read by link_audio_to_playlists so a
# freshly-downloaded track is attached to its playlist(s) WITHOUT re-fetching every
# playlist from YouTube per track. The old behaviour made N downloads x P playlists
# yt-dlp extract_info calls, which triggered rate-limiting. Keyed by the PUBLIC YouTube
# playlist_id (safely shared across users subscribed to the same playlist); the value is
# a list of video ids preserving playlist order (so track position can be derived).
PLAYLIST_YTIDS_CACHE_PREFIX = 'playlist_ytids:'
PLAYLIST_YTIDS_CACHE_TTL = 24 * 60 * 60  # 24h; refreshed on every sync (beat runs ~15m)


def _cache_playlist_video_ids(playlist_id, ordered_ids):
    """Best-effort cache of a playlist's ordered video-id list for post-download linkage."""
    try:
        cache.set(
            f'{PLAYLIST_YTIDS_CACHE_PREFIX}{playlist_id}',
            list(ordered_ids),
            PLAYLIST_YTIDS_CACHE_TTL,
        )
    except Exception as exc:  # cache is best-effort — never break a sync over it
        logger.debug('Could not cache playlist video ids for %s: %s', playlist_id, exc)


# --- Download audio-quality resolution (F1) --------------------------------------
# Maps a user/channel quality tier to the yt-dlp FFmpegExtractAudio postprocessor and
# the resulting file extension / stored Audio.audio_format. The two settings use
# different vocabularies — UserConfig.audio_quality = low/medium/high/best;
# Channel.download_quality = auto/low/medium/high/ultra — so both, plus a 'flac' alias,
# are normalized here. best/ultra/flac = lossless FLAC; unknown/'auto' falls through to
# the historical default (m4a @ 192 kbps).
_QUALITY_PRESETS = {
    'flac':   {'pp': {'preferredcodec': 'flac'},                           'ext': 'flac'},
    'best':   {'pp': {'preferredcodec': 'flac'},                           'ext': 'flac'},
    'ultra':  {'pp': {'preferredcodec': 'flac'},                           'ext': 'flac'},
    'high':   {'pp': {'preferredcodec': 'm4a', 'preferredquality': '320'}, 'ext': 'm4a'},
    'medium': {'pp': {'preferredcodec': 'm4a', 'preferredquality': '192'}, 'ext': 'm4a'},
    'low':    {'pp': {'preferredcodec': 'opus', 'preferredquality': '96'}, 'ext': 'opus'},
}
_DEFAULT_QUALITY = 'medium'


def _quality_preset(quality):
    return _QUALITY_PRESETS.get((quality or '').strip().lower(), _QUALITY_PRESETS[_DEFAULT_QUALITY])


def _postprocessor_for_quality(quality):
    """FFmpegExtractAudio options (WITHOUT the 'key') for a quality tier.

    e.g. 'flac' -> {'preferredcodec': 'flac'}; 'high' -> {'preferredcodec':'m4a','preferredquality':'320'}.
    """
    return dict(_quality_preset(quality)['pp'])


def _ext_for_quality(quality):
    """Output file extension / Audio.audio_format for a quality tier (flac/m4a/opus)."""
    return _quality_preset(quality)['ext']


def _resolve_download_quality(queue_item):
    """Effective quality tier for this download.

    Precedence: the originating channel's `download_quality` (when the item came from a
    channel subscription and that channel isn't 'auto') > the owner's
    `UserConfig.audio_quality` > the historical default (medium / m4a-192).
    """
    # Per-channel override — channel-subscription downloads stamp `channel_name`.
    if queue_item.channel_name:
        channel = Channel.objects.filter(
            owner=queue_item.owner, channel_name=queue_item.channel_name
        ).first()
        if channel and channel.download_quality and channel.download_quality.strip().lower() != 'auto':
            return channel.download_quality
    # Owner's Settings preference (UserConfig is a OneToOne with related_name 'config').
    try:
        cfg_quality = queue_item.owner.config.audio_quality
    except ObjectDoesNotExist:
        cfg_quality = None
    return cfg_quality or _DEFAULT_QUALITY


def measure_loudness_lufs(file_path):
    """Measure integrated loudness (EBU R128 / LUFS) of an audio file via ffmpeg (F9).

    Uses ffmpeg's `loudnorm` analysis pass (JSON output on stderr). Best-effort: returns
    a float LUFS value, or None on any failure/silence. No shell, fixed argv (no injection).
    """
    import subprocess
    import json as _json
    import re as _re

    if not file_path or not os.path.isfile(file_path):
        return None
    try:
        result = subprocess.run(
            ['ffmpeg', '-hide_banner', '-nostats', '-i', file_path,
             '-af', 'loudnorm=print_format=json', '-f', 'null', '-'],
            capture_output=True, text=True, timeout=1800,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning('Loudness measurement failed to run for %s: %s', file_path, exc)
        return None

    # loudnorm prints a flat JSON object (input_i, input_tp, ...) to stderr.
    match = _re.search(r'\{[^{}]*"input_i"[^{}]*\}', result.stderr or '', _re.DOTALL)
    if not match:
        return None
    try:
        value = float(_json.loads(match.group(0)).get('input_i'))
    except (TypeError, ValueError):
        return None
    # Reject NaN / -inf (silent tracks) so we don't store a nonsense value.
    if value != value or value in (float('-inf'), float('inf')):
        return None
    return round(value, 2)


@shared_task(name='audio.measure_loudness')
def measure_loudness_task(audio_id):
    """Measure and store a track's integrated loudness after download (F9)."""
    try:
        audio = Audio.objects.get(id=audio_id)
    except Audio.DoesNotExist:
        return f"Audio {audio_id} no longer exists"
    if not audio.file_path:
        return f"Audio {audio_id} has no file"
    lufs = measure_loudness_lufs(os.path.join('/app/audio', audio.file_path))
    if lufs is None:
        return f"Loudness not measured for {audio_id}"
    audio.loudness_lufs = lufs
    audio.save(update_fields=['loudness_lufs'])
    return f"Measured loudness for {audio_id}: {lufs} LUFS"


@shared_task(name='audio.extract_features')
def extract_features_task(audio_id):
    """Compute per-track audio features (tempo/key/energy + 6-dim vector) with librosa (F16).

    Fire-and-forget after download; never blocks it. librosa/numpy are imported lazily so this
    module and the test suite load even when the DSP stack is not installed in the image.
    """
    try:
        audio = Audio.objects.get(id=audio_id)
    except Audio.DoesNotExist:
        return f"Audio {audio_id} no longer exists"
    if not audio.file_path:
        return f"Audio {audio_id} has no file"

    from django.conf import settings
    from pathlib import Path
    from audio.radio_features import build_feature_vector, energy_from_rms, KEY_NAMES

    try:
        import numpy as np
        import librosa
    except ImportError as exc:
        logger.warning("librosa unavailable, skipping features for %s: %s", audio_id, exc)
        return f"librosa unavailable for {audio_id}"

    source_path = str(Path(settings.MEDIA_ROOT) / audio.file_path)
    try:
        samples, sample_rate = librosa.load(source_path, sr=22050, mono=True, duration=120)
    except Exception as exc:  # noqa: BLE001
        logger.warning("librosa load failed for %s: %s", audio_id, exc)
        return f"librosa load failed for {audio_id}"
    if samples.size == 0:
        return f"Empty audio for {audio_id}"

    rms = float(np.mean(librosa.feature.rms(y=samples)))
    energy = energy_from_rms(rms)
    tempo, _beats = librosa.beat.beat_track(y=samples, sr=sample_rate)
    bpm = float(np.atleast_1d(tempo)[0])
    centroid = float(np.mean(librosa.feature.spectral_centroid(y=samples, sr=sample_rate)))
    zcr = float(np.mean(librosa.feature.zero_crossing_rate(samples)))
    rolloff = float(np.mean(librosa.feature.spectral_rolloff(y=samples, sr=sample_rate)))
    chroma = librosa.feature.chroma_stft(y=samples, sr=sample_rate)
    key_index = int(np.argmax(np.mean(chroma, axis=1)))

    audio.bpm = round(bpm, 2)
    audio.music_key = KEY_NAMES[key_index] if 0 <= key_index < len(KEY_NAMES) else ''
    audio.energy = round(energy, 4)
    audio.feature_vector = [round(v, 5) for v in build_feature_vector(energy, bpm, centroid, zcr, rolloff, key_index)]
    audio.save(update_fields=['bpm', 'music_key', 'energy', 'feature_vector'])
    return f"Extracted features for {audio_id}: key={audio.music_key} bpm={audio.bpm} energy={audio.energy}"


# Error patterns that indicate a video is permanently unavailable
# Don't retry these - they won't magically become available
PERMANENT_ERROR_PATTERNS = [
    'video unavailable',
    'private video',
    'copyright',
    'blocked in your country',
    'video has been removed',
    'account associated with this video has been terminated',
    'age-restricted',
    'not available',
    'no longer available',
]


# Titles that yt-dlp returns in extract_flat mode for deleted/private videos
DELETED_VIDEO_TITLES = [
    '[deleted video]',
    '[private video]',
]


def is_deleted_or_private_entry(entry):
    """Check if a playlist entry is a deleted or private video.
    
    In extract_flat mode, yt-dlp returns these with special titles
    like '[Deleted video]' or '[Private video]'.
    """
    title = (entry.get('title') or '').strip().lower()
    return title in DELETED_VIDEO_TITLES


def is_permanently_unavailable(error_message):
    """Check if an error message indicates a permanently unavailable video."""
    if not error_message:
        return False
    error_lower = error_message.lower()
    return any(pattern in error_lower for pattern in PERMANENT_ERROR_PATTERNS)


def is_invalid_channel_subscription_error(error_message):
    """Return True when YouTube reports an invalid channel subscription reference.

    These errors are usually deterministic and require fixing channel ID/handle.
    """
    if not error_message:
        return False

    error_lower = error_message.lower()
    has_tab_error = 'youtube:tab' in error_lower
    has_400 = 'http error 400' in error_lower or 'bad request' in error_lower
    missing_channel = 'channel does not exist' in error_lower or 'unable to find' in error_lower
    return (has_tab_error and has_400) or missing_channel


def register_channel_sync_failure(channel, error_message):
    """Record channel sync failure and optionally auto-disable invalid subscriptions."""
    safe_error = (error_message or '')[:1000]
    channel.sync_status = 'failed'
    channel.error_message = safe_error
    channel.last_failed_sync = timezone.now()
    channel.consecutive_sync_failures += 1

    if (
        is_invalid_channel_subscription_error(safe_error)
        and channel.consecutive_sync_failures >= INVALID_CHANNEL_FAILURE_THRESHOLD
        and channel.subscribed
    ):
        channel.subscribed = False
        channel.auto_download = False
        channel.active = False
        channel.auto_disabled = True
        channel.auto_disabled_reason = (
            'Auto-disabled after repeated invalid channel errors '
            f'({channel.consecutive_sync_failures} consecutive failures). '
            'Update to a valid channel ID/handle before re-enabling.'
        )
        logger.warning(
            '[ChannelSync] Auto-disabled invalid channel subscription "%s" '
            '(owner: %s, channel_id: %s, failures: %s)',
            channel.channel_name,
            channel.owner.username,
            channel.channel_id,
            channel.consecutive_sync_failures,
        )

    channel.save(
        update_fields=[
            'sync_status',
            'error_message',
            'last_failed_sync',
            'consecutive_sync_failures',
            'subscribed',
            'auto_download',
            'active',
            'auto_disabled',
            'auto_disabled_reason',
        ]
    )


def get_permanently_unavailable_ids(owner):
    """Get set of youtube_ids that are permanently unavailable for an owner."""
    # Build query for all permanent error patterns
    error_query = Q()
    for pattern in PERMANENT_ERROR_PATTERNS:
        error_query |= Q(error_message__icontains=pattern)
    
    return set(DownloadQueue.objects.filter(
        owner=owner,
        status='failed',
    ).filter(error_query).values_list('youtube_id', flat=True))


@shared_task
def download_audio_task(queue_id):
    """Download audio from YouTube - AUDIO ONLY, no video"""
    try:
        queue_item = DownloadQueue.objects.get(id=queue_id)
    except DownloadQueue.DoesNotExist:
        # Row was deleted (e.g. the queue was cleared) between enqueue and execution.
        # Return quietly instead of letting the broad `except` below run with
        # `queue_item` unbound (UnboundLocalError, which would mask the real cause).
        logger.warning("download_audio_task: queue item %s no longer exists", queue_id)
        return

    try:
        # SSRF guard (APP-02), defence-in-depth: re-validate immediately before the
        # fetch so auto-started/retried items, and anything queued before this check
        # existed, cannot make yt-dlp reach an internal/non-routable address.
        from common.url_security import check_public_http_url, message_for
        ok, code = check_public_http_url(queue_item.url)
        if not ok:
            queue_item.status = 'failed'
            # Stable '[blocked_url]' marker lets the SPA render a localized message.
            queue_item.error_message = f'[blocked_url] {message_for(code)}'
            queue_item.save()
            logger.warning("Blocked SSRF download attempt for queue %s: %s", queue_id, queue_item.url)
            return

        queue_item.status = 'downloading'
        queue_item.started_date = timezone.now()
        queue_item.save()

        # Honor the owner's (and originating channel's) audio-quality setting (F1)
        # instead of always producing m4a/192.
        quality = _resolve_download_quality(queue_item)
        out_ext = _ext_for_quality(quality)

        # yt-dlp options for AUDIO ONLY (no video)
        ydl_opts = {
            'format': 'bestaudio/best',  # Best available source; postprocessor sets the codec
            'postprocessors': [{'key': 'FFmpegExtractAudio', **_postprocessor_for_quality(quality)}],
            'outtmpl': '/app/audio/%(channel)s/%(title)s-%(id)s.%(ext)s',
            'quiet': True,
            'no_warnings': True,
            'extract_audio': True,  # Ensure audio extraction
            **get_yt_dlp_cookies_opts(),
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(queue_item.url, download=True)
            
            # Get the actual downloaded filename from yt-dlp
            # After post-processing with FFmpegExtractAudio, the extension will be .m4a
            # We need to use prepare_filename and replace the extension
            actual_filename = ydl.prepare_filename(info)
            
            # Replace the source extension with the extracted-audio extension chosen by
            # the resolved quality (flac / m4a / opus).
            import os as os_module
            base_filename = os_module.path.splitext(actual_filename)[0]
            actual_filename = base_filename + '.' + out_ext

            # Remove /app/audio/ prefix to get relative path
            if actual_filename.startswith('/app/audio/'):
                file_path = actual_filename[11:]  # Remove '/app/audio/' prefix
            else:
                # Fallback to constructed path if prepare_filename doesn't work as expected
                file_path = f"{info.get('channel', 'unknown')}/{info.get('title', 'unknown')}-{info['id']}.{out_ext}"

            # Create Audio object
            audio, created = Audio.objects.get_or_create(
                owner=queue_item.owner,
                youtube_id=info['id'],
                defaults={
                    'title': info.get('title', 'Unknown'),
                    'description': info.get('description', ''),
                    'channel_id': info.get('channel_id', ''),
                    'channel_name': info.get('channel', 'Unknown'),
                    'duration': info.get('duration', 0),
                    'file_path': file_path,
                    'file_size': info.get('filesize', 0) or 0,
                    'audio_format': out_ext,
                    # Capture chapter markers (F2) — empty list when the video has none.
                    'chapters': [
                        {'title': c.get('title', ''), 'start': c.get('start_time'), 'end': c.get('end_time')}
                        for c in (info.get('chapters') or [])
                    ],
                    'thumbnail_url': info.get('thumbnail', ''),
                    'published_date': datetime.strptime(info.get('upload_date', '20230101'), '%Y%m%d'),
                    'view_count': info.get('view_count', 0) or 0,
                    'like_count': info.get('like_count', 0) or 0,
                }
            )
            
            # Queue a task to link this audio to playlists (optimized - runs after download)
            # This prevents blocking the download task with expensive playlist lookups
            link_audio_to_playlists.delay(audio.id, queue_item.owner.id)

            # Measure loudness asynchronously (F9) so the download task stays fast.
            if created:
                measure_loudness_task.delay(audio.id)
                extract_features_task.delay(audio.id)  # F16 sonic features, async, never blocks

        queue_item.status = 'completed'
        queue_item.completed_date = timezone.now()
        queue_item.youtube_id = info['id']
        queue_item.title = info.get('title', '')
        queue_item.save()

        return f"Downloaded: {info.get('title', 'Unknown')}"

    except Exception as e:
        queue_item.status = 'failed'
        queue_item.error_message = str(e)
        queue_item.save()
        raise


@shared_task
def download_channel_task(channel_id):
    """Smart sync: Download only NEW audio from channel (not already downloaded)"""
    channel = None
    try:
        channel = Channel.objects.get(id=channel_id)
        channel.sync_status = 'syncing'
        channel.error_message = ''
        channel.save(update_fields=['sync_status', 'error_message'])
        
        url = f"https://www.youtube.com/channel/{channel.channel_id}/videos"
        
        # Extract flat to get list quickly. sync_depth caps how far back we scan
        # (0 = entire channel history, so playlistend is omitted).
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'extract_flat': True,
            'socket_timeout': 30,
            **get_yt_dlp_cookies_opts(),
        }
        if channel.sync_depth and channel.sync_depth > 0:
            ydl_opts['playlistend'] = channel.sync_depth
        sync_depth_label = channel.sync_depth if channel.sync_depth else 'all'
        logger.info(
            '[ChannelSync] Fetching up to %s videos for "%s" (ID: %s)',
            sync_depth_label, channel.channel_name, channel.channel_id,
        )
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
        except Exception as yt_error:
            register_channel_sync_failure(channel, str(yt_error))
            logger.warning('[ChannelSync] YouTube fetch failed for "%s": %s', channel.channel_name, yt_error)
            return 'Failed to fetch channel videos'

        entries = info.get('entries') if info else None
        if not info or not entries:
            register_channel_sync_failure(
                channel,
                'Failed to fetch channel videos (YouTube may be rate-limiting or cookies may be needed)'
            )
            logger.warning('[ChannelSync] Empty response for channel "%s" (ID: %s)',
                          channel.channel_name, channel.channel_id)
            return 'Failed to fetch channel videos'
            
        # Get list of already downloaded video IDs
        existing_ids = set(Audio.objects.filter(
            owner=channel.owner
        ).values_list('youtube_id', flat=True))
            
        # Get list of permanently unavailable videos (copyright, private, etc.)
        unavailable_ids = get_permanently_unavailable_ids(channel.owner)
            
        # Queue only NEW videos
        new_videos = 0
        skipped = 0
        skipped_unavailable = 0
            
        for entry in info['entries']:
            if not entry:
                continue
                
            video_id = entry.get('id')
            if not video_id:
                continue
                
            # SMART SYNC: Skip if already downloaded
            if video_id in existing_ids:
                skipped += 1
                continue
                
            # Skip permanently unavailable videos (copyright blocked, private, etc.)
            if video_id in unavailable_ids:
                skipped_unavailable += 1
                continue
                
            # This is NEW content
            queue_item, created = DownloadQueue.objects.get_or_create(
                owner=channel.owner,
                url=f"https://www.youtube.com/watch?v={video_id}",
                defaults={
                    'youtube_id': video_id,
                    'title': entry.get('title', 'Unknown'),
                    # Stamp the source channel so download_audio_task can honor this
                    # channel's download_quality (F1).
                    'channel_name': channel.channel_name,
                    'status': 'pending',
                    'auto_start': True
                }
            )
            
            if created:
                new_videos += 1
                download_audio_task.delay(queue_item.id)
            
        # Update channel status
        channel.sync_status = 'success'
        channel.downloaded_count = len(existing_ids)
        channel.error_message = ''
        channel.consecutive_sync_failures = 0
        channel.save(update_fields=['sync_status', 'downloaded_count', 'error_message', 'consecutive_sync_failures'])
            
        if new_videos == 0:
            msg = f"Channel '{channel.channel_name}' up to date ({skipped} already downloaded"
            if skipped_unavailable > 0:
                msg += f", {skipped_unavailable} unavailable skipped"
            msg += ")"
            return msg
            
        msg = f"Channel '{channel.channel_name}': {new_videos} new audio(s) queued, {skipped} already downloaded"
        if skipped_unavailable > 0:
            msg += f", {skipped_unavailable} unavailable skipped"
        return msg
    
    except Exception as e:
        if channel is not None:
            register_channel_sync_failure(channel, str(e))
        raise


@shared_task(bind=True, name="subscribe_to_playlist")
def subscribe_to_playlist(self, user_id, playlist_url):
    """
    TubeArchivist pattern: Subscribe to playlist and trigger audio download
    Called from API → Creates subscription → Downloads audio (not video)
    """
    from django.contrib.auth import get_user_model
    from playlist.models import Playlist
    from common.src.youtube_metadata import get_playlist_metadata
    import re
    
    User = get_user_model()
    user = User.objects.get(id=user_id)
    
    # Extract playlist ID from URL
    patterns = [
        r'[?&]list=([a-zA-Z0-9_-]+)',
        r'playlist\?list=([a-zA-Z0-9_-]+)',
    ]
    
    playlist_id = None
    for pattern in patterns:
        match = re.search(pattern, playlist_url)
        if match:
            playlist_id = match.group(1)
            break
    
    if not playlist_id and len(playlist_url) >= 13 and playlist_url.startswith(('PL', 'UU', 'LL', 'RD')):
        playlist_id = playlist_url
    
    if not playlist_id:
        raise ValueError("Invalid playlist URL")
    
    # Check if already subscribed
    if Playlist.objects.filter(owner=user, playlist_id=playlist_id).exists():
        return f"Already subscribed to playlist {playlist_id}"
    
    # Fetch metadata
    metadata = get_playlist_metadata(playlist_id)
    if not metadata:
        raise ValueError("Failed to fetch playlist metadata")
    
    # Create subscription
    playlist = Playlist.objects.create(
        owner=user,
        playlist_id=playlist_id,
        title=metadata['title'],
        description=metadata['description'],
        channel_name=metadata['channel_name'],
        channel_id=metadata['channel_id'],
        thumbnail_url=metadata['thumbnail_url'],
        item_count=metadata['item_count'],
        playlist_type='youtube',
        subscribed=True,
        auto_download=True,
        sync_status='pending',
    )
    
    # Trigger audio download task
    download_playlist_task.delay(playlist.id)
    
    return f"Subscribed to playlist: {metadata['title']}"


@shared_task(bind=True, name="subscribe_to_channel")
def subscribe_to_channel(self, user_id, channel_url):
    """
    TubeArchivist pattern: Subscribe to channel and trigger audio download
    Called from API → Creates subscription → Downloads audio (not video)
    """
    from django.contrib.auth import get_user_model
    from channel.models import Channel
    from common.src.youtube_metadata import get_channel_metadata
    import re
    
    User = get_user_model()
    user = User.objects.get(id=user_id)
    
    # Extract channel ID from URL
    patterns = [
        r'youtube\.com/channel/(UC[\w-]+)',
        r'youtube\.com/@([\w-]+)',
        r'youtube\.com/c/([\w-]+)',
        r'youtube\.com/user/([\w-]+)',
    ]
    
    channel_id = None
    for pattern in patterns:
        match = re.search(pattern, channel_url)
        if match:
            channel_id = match.group(1)
            break
    
    if not channel_id and channel_url.startswith('UC') and len(channel_url) == 24:
        channel_id = channel_url
    
    if not channel_id:
        channel_id = channel_url  # Try as-is
    
    # Fetch metadata (this resolves handles to actual channel IDs)
    metadata = get_channel_metadata(channel_id)
    if not metadata:
        raise ValueError("Failed to fetch channel metadata")
    
    actual_channel_id = metadata['channel_id']
    
    # Check if already subscribed
    if Channel.objects.filter(owner=user, channel_id=actual_channel_id).exists():
        return f"Already subscribed to channel {actual_channel_id}"
    
    # Create subscription
    channel = Channel.objects.create(
        owner=user,
        channel_id=actual_channel_id,
        channel_name=metadata['channel_name'],
        channel_description=metadata['channel_description'],
        channel_thumbnail=metadata['channel_thumbnail'],
        subscriber_count=metadata['subscriber_count'],
        video_count=metadata['video_count'],
        subscribed=True,
        auto_download=True,
        sync_status='pending',
    )
    
    # Trigger audio download task
    download_channel_task.delay(channel.id)
    
    return f"Subscribed to channel: {metadata['channel_name']}"


@shared_task(name="update_subscriptions")
def update_subscriptions_task():
    """
    Periodic task: Check ALL subscriptions for NEW audio and queue downloads.
    
    Runs every 15 minutes via Celery Beat (configured in config/celery.py).
    This is the main entry point for automatic YouTube playlist/channel sync.
    
    Flow:
    1. Query all active subscriptions (subscribed=True, auto_download=True)
    2. Dispatch download_playlist_task or download_channel_task for each
    3. Each task fetches metadata from YouTube (extract_flat mode - fast)
    4. Compares with local database to find NEW content
    5. Queues NEW videos for download via download_audio_task
    """
    from playlist.models import Playlist
    from django.utils import timezone as dj_timezone
    
    task_start = dj_timezone.now()
    logger.info('[SyncTask] ===== SYNC CYCLE STARTING =====')
    
    try:
        # Fetch active subscriptions
        playlists = Playlist.objects.filter(subscribed=True, auto_download=True)
        channels = Channel.objects.filter(subscribed=True, auto_download=True)
        
        playlist_count = playlists.count()
        channel_count = channels.count()
        
        if playlist_count == 0 and channel_count == 0:
            logger.warning('[SyncTask] No active subscriptions found')
            return f"No active subscriptions to sync"
        
        # Dispatch playlist sync tasks
        for playlist in playlists:
            try:
                download_playlist_task.delay(playlist.id)
                logger.debug('[SyncTask] Queued playlist: %s (ID: %s)', playlist.title, playlist.id)
            except Exception as e:
                logger.error('[SyncTask] Failed to queue playlist %s: %s', playlist.id, e)
        
        # Dispatch channel sync tasks
        for channel in channels:
            try:
                download_channel_task.delay(channel.id)
                logger.debug('[SyncTask] Queued channel: %s (ID: %s)', channel.channel_name, channel.id)
            except Exception as e:
                logger.error('[SyncTask] Failed to queue channel %s: %s', channel.id, e)
        
        elapsed = (dj_timezone.now() - task_start).total_seconds()
        logger.info('[SyncTask] ===== SYNC CYCLE COMPLETE ===== (Queued: %d playlists, %d channels | Elapsed: %.2fs)',
                    playlist_count, channel_count, elapsed)
        
        return f"Syncing {playlist_count} playlists and {channel_count} channels"
    
    except Exception as e:
        logger.error('[SyncTask] ===== SYNC CYCLE FAILED ===== Error: %s', e, exc_info=True)
        return f"Sync cycle failed: {str(e)}"


@shared_task
def download_playlist_task(playlist_id, force=False):
    """Smart sync: Download only NEW audio from playlist (not already downloaded).
    
    Strategy (TubeArchivist-inspired):
    1. Use yt-dlp extract_flat (FAST - metadata only, no download)
    2. Get video IDs from YouTube
    3. Compare with local Audio objects
    4. Queue NEW videos for download
    5. Link audio to playlist AFTER download (avoid blocking)
    
    When force=True:
    - Retry previously permanently-unavailable videos
    - Verify existing audio files on disk and re-download missing ones
    """
    from playlist.models import Playlist, PlaylistItem
    from django.utils import timezone as dj_timezone
    
    sync_start = dj_timezone.now()
    
    try:
        playlist = Playlist.objects.get(id=playlist_id)
        logger.info('[PlaylistSync] Starting sync for "%s" (owner: %s, force: %s)', 
                    playlist.title, playlist.owner.username, force)
        
        playlist.sync_status = 'syncing'
        playlist.error_message = ''
        playlist.save(update_fields=['sync_status', 'error_message'])
        
        url = f"https://www.youtube.com/playlist?list={playlist.playlist_id}"
        
        # Extract flat to get list quickly without downloading
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'extract_flat': True,
            'socket_timeout': 30,  # Timeout after 30s for YouTube latency
            **get_yt_dlp_cookies_opts(),
        }
        
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
        except Exception as yt_error:
            # YouTube may be rate-limiting, down, or blocking our IP/region
            error_msg = f'YouTube fetch failed: {str(yt_error)[:200]}'
            playlist.sync_status = 'failed'
            playlist.error_message = error_msg
            playlist.save(update_fields=['sync_status', 'error_message'])
            logger.warning('[PlaylistSync] YouTube fetch failed for "%s": %s', playlist.title, yt_error)
            return f"Failed to fetch playlist"
        
        entries = info.get('entries') if info else None
        if not info or not entries:
            playlist.sync_status = 'failed'
            playlist.error_message = 'YouTube returned empty playlist (removed or rate-limited)'
            playlist.save(update_fields=['sync_status', 'error_message'])
            logger.warning('[PlaylistSync] Empty response for playlist "%s" (ID: %s)', 
                          playlist.title, playlist.playlist_id)
            return f"Failed to fetch playlist items"

        # Refresh playlist thumbnail from latest yt-dlp metadata
        # (handles case where thumbnail_url was empty at subscribe time
        #  or never populated during migration)
        new_thumbnail = ''
        if info.get('thumbnails'):
            new_thumbnail = info['thumbnails'][-1].get('url') or ''
        if not new_thumbnail and info.get('thumbnail'):
            new_thumbnail = info.get('thumbnail') or ''
        if new_thumbnail and new_thumbnail != playlist.thumbnail_url:
            playlist.thumbnail_url = new_thumbnail
            logger.info('[PlaylistSync] Refreshed thumbnail for "%s"', playlist.title)

        # Update item count
        total_items = len([e for e in info['entries'] if e])
        playlist.item_count = total_items

        # Cache this playlist's ordered video-id list up front (before any download is
        # queued) so post-download linkage (link_audio_to_playlists) can attach the new
        # tracks with NO extra yt-dlp calls. Reused for the stale-item cleanup below.
        yt_video_ids_ordered = [e.get('id') for e in info['entries'] if e and e.get('id')]
        _cache_playlist_video_ids(playlist.playlist_id, yt_video_ids_ordered)

        # Get list of permanently unavailable videos (copyright, private, etc.)
        # When force=True, retry everything including previously unavailable
        unavailable_ids = set() if force else get_permanently_unavailable_ids(playlist.owner)

        # Queue only NEW videos (not already downloaded)
        new_videos = 0
        skipped = 0
        skipped_unavailable = 0
        skipped_deleted = 0

        for idx, entry in enumerate(info['entries']):
            if not entry:
                continue

            video_id = entry.get('id')
            if not video_id:
                continue

            # Detect deleted/private videos from YouTube
            # yt-dlp extract_flat returns these with title '[Deleted video]' or '[Private video]'
            entry_is_deleted = is_deleted_or_private_entry(entry)

            # Check if audio already exists
            audio_obj = Audio.objects.filter(
                owner=playlist.owner,
                youtube_id=video_id
            ).first()

            # Create PlaylistItem if audio exists but not in playlist yet
            if audio_obj:
                PlaylistItem.objects.get_or_create(
                    playlist=playlist,
                    audio=audio_obj,
                    defaults={'position': idx}
                )
                # When force=True, verify the file actually exists on disk
                # But NEVER delete local files for deleted/private YouTube videos
                if force and not entry_is_deleted and audio_obj.file_path:
                    full_path = os.path.join('/app/audio', audio_obj.file_path)
                    if not os.path.isfile(full_path):
                        logger.warning('Force recheck: file missing for %s (%s), re-downloading',
                                       audio_obj.youtube_id, audio_obj.file_path)
                        audio_obj.delete()
                        # Fall through to queue a new download below
                    else:
                        skipped += 1
                        continue
                else:
                    if entry_is_deleted:
                        logger.info('Keeping local copy of deleted/private video: %s (%s)',
                                    audio_obj.title, video_id)
                    skipped += 1
                    continue

            # If video is deleted/private on YouTube and we don't have it locally,
            # skip it entirely — downloading would fail anyway
            if entry_is_deleted:
                skipped_deleted += 1
                logger.debug('Skipping deleted/private video: %s (%s)',
                             entry.get('title', '?'), video_id)
                continue

            # Skip permanently unavailable videos (copyright blocked, private, etc.)
            if video_id in unavailable_ids:
                skipped_unavailable += 1
                continue

            # This is NEW content - add to download queue
            # First check for existing queue item
            existing_queue_item = DownloadQueue.objects.filter(
                owner=playlist.owner,
                youtube_id=video_id
            ).first()
            created = False

            # Check if item is stuck in downloading state (> 30 minutes)
            if existing_queue_item and existing_queue_item.status == 'downloading':
                if existing_queue_item.started_date:
                    stuck_threshold = timezone.now() - timedelta(minutes=30)
                    if existing_queue_item.started_date < stuck_threshold:
                        # Reset stuck download
                        existing_queue_item.status = 'failed'
                        existing_queue_item.error_message = 'Download stuck, resetting for retry'
                        existing_queue_item.save()
                        existing_queue_item = None  # Allow recreation

            # Create or get queue item - but skip permanently unavailable videos
            if not existing_queue_item or existing_queue_item.status in ['failed', 'ignored']:
                if existing_queue_item and existing_queue_item.status in ['failed', 'ignored']:
                    # Check if this is a permanent failure - DON'T retry these (unless force=True)
                    if not force and is_permanently_unavailable(existing_queue_item.error_message):
                        skipped_unavailable += 1
                        continue
                    # Update existing failed item (temporary failures only)
                    existing_queue_item.status = 'pending'
                    existing_queue_item.error_message = ''
                    existing_queue_item.save()
                    queue_item = existing_queue_item
                    created = True  # Treat as newly created for triggering download
                else:
                    # Create new item
                    queue_item, created = DownloadQueue.objects.get_or_create(
                        owner=playlist.owner,
                        url=f"https://www.youtube.com/watch?v={video_id}",
                        defaults={
                            'youtube_id': video_id,
                            'title': entry.get('title', 'Unknown'),
                            'status': 'pending',
                            'auto_start': True
                        }
                    )
                    if not created:
                        # get_or_create found existing row by URL — treat it like existing_queue_item
                        existing_queue_item = queue_item

                if created:
                    new_videos += 1
                    # Trigger download task for NEW video
                    download_audio_task.delay(queue_item.id)
            if existing_queue_item and not created:
                # Item is already pending, downloading, or completed
                if existing_queue_item.status == 'completed':
                    # Verify the audio actually exists - if not, reset and redownload
                    audio_exists = Audio.objects.filter(
                        owner=playlist.owner,
                        youtube_id=video_id
                    ).exists()

                    if audio_exists:
                        skipped += 1
                    else:
                        # Queue shows completed but audio doesn't exist - reset and redownload
                        existing_queue_item.status = 'pending'
                        existing_queue_item.error_message = 'Audio missing, re-downloading'
                        existing_queue_item.save()
                        new_videos += 1
                        download_audio_task.delay(existing_queue_item.id)
                elif existing_queue_item.status == 'pending':
                    # Re-dispatch stuck pending items (task may have been lost)
                    new_videos += 1
                    download_audio_task.delay(existing_queue_item.id)
                elif existing_queue_item.status == 'downloading':
                    # Already being downloaded — don't re-dispatch, just skip
                    skipped += 1

            # Create PlaylistItem for the downloaded audio (will be created after download completes)
            # Note: Audio object might not exist yet, so we'll add a post-download hook

        # Remove PlaylistItems for tracks that are NOT in this YouTube playlist
        # (fixes incorrectly linked tracks from the old link_audio_to_playlists bug)
        # Note: yt-dlp extract_flat includes [Deleted video] and [Private video] entries,
        # so yt_video_ids covers all current AND deleted/private tracks.
        # Any PlaylistItem whose audio youtube_id is NOT in yt_video_ids was never
        # actually part of this YouTube playlist — only the playlist link is removed,
        # the audio file itself is preserved.
        yt_video_ids = set(yt_video_ids_ordered)
        stale_items = PlaylistItem.objects.filter(playlist=playlist).exclude(
            audio__youtube_id__in=yt_video_ids
        )
        removed = stale_items.count()
        if removed:
            stale_items.delete()
            logger.info('Removed %d incorrectly linked items from playlist %s', removed, playlist.title)

        # Update playlist status
        playlist.sync_status = 'success'
        playlist.last_refresh = timezone.now()
        # Count downloaded tracks: include all tracks in PlaylistItems
        # (covers both current YouTube entries AND locally-kept deleted videos)
        playlist.downloaded_count = PlaylistItem.objects.filter(
            playlist=playlist,
            audio__file_path__isnull=False,
        ).exclude(audio__file_path='').count()
        playlist.save()

        mode = 'Force recheck' if force else 'Sync'

        if new_videos == 0:
            msg = f"{mode} '{playlist.title}' up to date ({skipped} already downloaded"
            if skipped_deleted > 0:
                msg += f", {skipped_deleted} deleted/private skipped"
            if skipped_unavailable > 0:
                msg += f", {skipped_unavailable} unavailable skipped"
            msg += ")"
            return msg

        msg = f"{mode} '{playlist.title}': {new_videos} new audio(s) queued, {skipped} already downloaded"
        if skipped_deleted > 0:
            msg += f", {skipped_deleted} deleted/private skipped"
        if skipped_unavailable > 0:
            msg += f", {skipped_unavailable} unavailable skipped"
        return msg
    
    except Exception as e:
        playlist.sync_status = 'failed'
        playlist.error_message = str(e)
        playlist.save()
        raise


@shared_task
def link_audio_to_playlists(audio_id, user_id):
    """Link a freshly-downloaded track to the YouTube playlists that contain it.

    Membership is resolved from each playlist's cached, yt-dlp-authoritative video-id
    list (populated by download_playlist_task during sync) — NOT by re-fetching every
    playlist from YouTube per track. The old behaviour made N downloads x P playlists
    extract_info calls, which triggered rate-limiting. On a cache miss (playlist not
    synced within the TTL) the track is left for the periodic download_playlist_task sync
    to reconcile, so this task never makes a network call.
    """
    from playlist.models import Playlist, PlaylistItem
    from django.contrib.auth import get_user_model

    try:
        User = get_user_model()
        user = User.objects.get(id=user_id)
        audio = Audio.objects.get(id=audio_id)

        playlists = Playlist.objects.filter(owner=user, playlist_type='youtube')

        # Playlists that already contain this track — one query instead of P.
        already_linked = set(
            PlaylistItem.objects.filter(audio=audio, playlist__owner=user)
            .values_list('playlist_id', flat=True)
        )

        linked = 0
        for playlist in playlists:
            if playlist.id in already_linked:
                continue

            # Resolve membership from the cached id list for this playlist (no yt-dlp).
            # No cache entry (not synced recently) -> skip; the periodic sync will link
            # it later. This is what removes the per-track YouTube fetches.
            cached_ids = cache.get(f'{PLAYLIST_YTIDS_CACHE_PREFIX}{playlist.playlist_id}')
            if not cached_ids or audio.youtube_id not in cached_ids:
                continue

            try:
                position = cached_ids.index(audio.youtube_id)
            except ValueError:
                position = PlaylistItem.objects.filter(playlist=playlist).count()

            PlaylistItem.objects.get_or_create(
                playlist=playlist,
                audio=audio,
                defaults={'position': position},
            )

            # Keep the playlist's downloaded_count accurate.
            playlist.downloaded_count = PlaylistItem.objects.filter(
                playlist=playlist,
                audio__file_path__isnull=False,
            ).exclude(audio__file_path='').count()
            playlist.save(update_fields=['downloaded_count'])
            linked += 1

        return f"Linked audio {audio.youtube_id} to {linked} playlist(s)"
    except Exception as e:
        logger.warning('Failed to link audio %s: %s', audio_id, e)
        return f"Failed to link audio: {str(e)}"


@shared_task
def cleanup_task():
    """Cleanup old download queue items"""
    # Remove completed items older than 7 days
    cutoff_date = timezone.now() - timedelta(days=7)

    deleted = DownloadQueue.objects.filter(
        status='completed',
        completed_date__lt=cutoff_date
    ).delete()

    return f"Cleaned up {deleted[0]} items"


@shared_task
def reset_stuck_downloads():
    """Reset downloads that have been stuck in 'downloading' status for more than 30 minutes"""
    stuck_threshold = timezone.now() - timedelta(minutes=30)
    
    stuck_downloads = DownloadQueue.objects.filter(
        status='downloading',
        started_date__lt=stuck_threshold
    )
    
    count = stuck_downloads.count()
    
    if count > 0:
        stuck_downloads.update(
            status='failed',
            error_message='Download stuck, reset for retry'
        )
        
        return f"Reset {count} stuck downloads"
    else:
        return "No stuck downloads found"


@shared_task
def retry_failed_downloads(max_retries=3):
    """
    Automatically retry failed downloads that haven't exceeded max retries.
    This ensures downloads continue even when the app was closed.
    """
    # Get failed downloads from the last 24 hours
    retry_window = timezone.now() - timedelta(hours=24)
    
    failed_downloads = DownloadQueue.objects.filter(
        status='failed',
        added_date__gte=retry_window,
    ).exclude(
        error_message__icontains='max retries exceeded'
    ).exclude(
        error_message__icontains='video unavailable'
    ).exclude(
        error_message__icontains='private video'
    ).exclude(
        error_message__icontains='copyright'
    )
    
    retried = 0
    skipped = 0
    
    for download in failed_downloads[:20]:  # Limit to 20 per cycle
        # Count retry attempts from error message or default to 0
        attempts = download.error_message.count('Retry attempt') if download.error_message else 0
        
        if attempts >= max_retries:
            # Mark as permanently failed
            download.error_message = f'{download.error_message}\nmax retries exceeded'
            download.save()
            skipped += 1
            continue
        
        # Reset status and queue for retry
        download.status = 'pending'
        download.error_message = f'Retry attempt {attempts + 1}: {download.error_message or "Auto-retry"}'
        download.save()
        
        # Trigger the download task
        download_audio_task.delay(download.id)
        retried += 1
    
    return f"Retried {retried} downloads, skipped {skipped}"


@shared_task
def resume_pending_downloads():
    """
    Resume any pending downloads that haven't been started or are stuck.
    Runs periodically via Celery Beat to ensure downloads continue.
    """
    stuck_threshold = timezone.now() - timedelta(minutes=10)
    pending_downloads = DownloadQueue.objects.filter(
        status='pending',
        auto_start=True,
    ).filter(
        # Never started, or started more than 10 minutes ago (stuck)
        Q(started_date__isnull=True) | Q(started_date__lt=stuck_threshold)
    )
    
    count = 0
    for download in pending_downloads[:50]:  # Limit batch size
        download_audio_task.delay(download.id)
        count += 1
    
    return f"Resumed {count} pending downloads"
