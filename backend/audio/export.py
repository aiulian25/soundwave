"""Shared audio-export core used by single-track export and playlist ZIP export (F13).

Factors the ffmpeg conversion + metadata embedding out of AudioExportView so both the
single-track endpoint and the playlist-export loop run the exact same code path.
"""

import logging
import shutil
import subprocess
from pathlib import Path

from django.conf import settings

logger = logging.getLogger(__name__)

SUPPORTED_EXPORT_FORMATS = ('mp3', 'flac')

# MP3 bitrate per quality tier; FLAC ignores quality and uses a fixed compression level.
_MP3_BITRATE_BY_QUALITY = {'high': '320k', 'medium': '192k', 'low': '128k'}
_DEFAULT_MP3_BITRATE = _MP3_BITRATE_BY_QUALITY['low']
_FLAC_COMPRESSION_LEVEL = '8'
_FFMPEG_TIMEOUT_SECONDS = 300
_ARTWORK_FETCH_TIMEOUT_SECONDS = 10
_MAX_SAFE_TITLE_LENGTH = 100


class AudioConversionError(Exception):
    """Raised when ffmpeg fails to convert a source file to the target format."""


class ExportSourceUnavailable(Exception):
    """Raised when an Audio has no readable on-disk source file to export."""


def sanitize_export_filename(title, fallback):
    """Reduce a title to a filesystem/ZIP-safe base name (no path separators)."""
    safe = "".join(c for c in (title or '') if c.isalnum() or c in (' ', '-', '_')).strip()
    safe = safe[:_MAX_SAFE_TITLE_LENGTH]
    return safe or fallback


def _ffmpeg_codec_args(target_format, quality):
    if target_format == 'mp3':
        bitrate = _MP3_BITRATE_BY_QUALITY.get(quality, _DEFAULT_MP3_BITRATE)
        return ['-codec:a', 'libmp3lame', '-b:a', bitrate]
    return ['-codec:a', 'flac', '-compression_level', _FLAC_COMPRESSION_LEVEL]


def convert_audio(source_path, target_format, quality, output_path):
    """Convert source_path into output_path as target_format (or copy if already matching).

    Raises AudioConversionError if ffmpeg exits non-zero.
    """
    source_path = Path(source_path)
    output_path = Path(output_path)

    already_target_format = source_path.suffix.lower() == f'.{target_format}'
    if already_target_format:
        shutil.copy2(source_path, output_path)
        return output_path

    ffmpeg_cmd = ['ffmpeg', '-y', '-i', str(source_path)]
    ffmpeg_cmd.extend(_ffmpeg_codec_args(target_format, quality))
    ffmpeg_cmd.append(str(output_path))

    result = subprocess.run(ffmpeg_cmd, capture_output=True, text=True, timeout=_FFMPEG_TIMEOUT_SECONDS)
    if result.returncode != 0:
        logger.warning("FFmpeg error converting %s -> %s: %s", source_path, target_format, result.stderr)
        raise AudioConversionError(result.stderr)
    return output_path


def _resolve_source_path(audio):
    """Resolve an Audio's on-disk source path, guarding against escaping MEDIA_ROOT."""
    if not audio.file_path:
        raise ExportSourceUnavailable('audio has no file_path')

    media_root = Path(settings.MEDIA_ROOT).resolve()
    source_path = (media_root / audio.file_path).resolve()

    # Path-traversal guard: a poisoned/absolute file_path must not escape MEDIA_ROOT.
    try:
        source_path.relative_to(media_root)
    except ValueError:
        raise ExportSourceUnavailable('source path escapes media root')

    if not source_path.exists():
        raise ExportSourceUnavailable('source file not found on disk')
    return source_path


def _load_lyrics(audio):
    from audio.models_lyrics import Lyrics
    try:
        lyrics_obj = Lyrics.objects.get(audio=audio)
        return lyrics_obj.plain_lyrics, lyrics_obj.synced_lyrics
    except Lyrics.DoesNotExist:
        return None, None
    except Exception as exc:  # noqa: BLE001
        logger.warning("Export: error loading lyrics for %s: %s", audio.youtube_id, exc)
        return None, None


def _fetch_cover_art(audio, artwork_url):
    # Lazy import avoids an import cycle (audio.views imports this module's export core).
    from audio.views import is_safe_artwork_url
    import requests

    art_url = artwork_url or audio.cover_art_url or audio.thumbnail_url
    if not art_url or not is_safe_artwork_url(art_url):
        return None
    try:
        response = requests.get(art_url, timeout=_ARTWORK_FETCH_TIMEOUT_SECONDS)
        if response.status_code == 200:
            return response.content
    except Exception as exc:  # noqa: BLE001
        logger.warning("Export: failed to fetch artwork for %s: %s", audio.youtube_id, exc)
    return None


def export_track_to_file(audio, target_format, quality, output_dir, *,
                         embed_lyrics=True, embed_artwork=True, artwork_url='', filename=None):
    """Convert one Audio into output_dir as target_format with metadata embedded.

    Returns the Path of the written file. Raises ExportSourceUnavailable when the source
    file is missing, or AudioConversionError when ffmpeg fails.
    """
    source_path = _resolve_source_path(audio)

    if not filename:
        fallback = f"audio_{audio.youtube_id or audio.id}"
        filename = f"{sanitize_export_filename(audio.title, fallback)}.{target_format}"
    output_path = Path(output_dir) / filename

    convert_audio(source_path, target_format, quality, output_path)

    plain_lyrics, synced_lyrics = _load_lyrics(audio) if embed_lyrics else (None, None)
    cover_art_data = _fetch_cover_art(audio, artwork_url) if embed_artwork else None

    from audio.tag_writer import write_metadata_to_file
    write_metadata_to_file(
        file_path=str(output_path),
        title=audio.title,
        artist=audio.artist or audio.channel_name,
        album=audio.album,
        year=audio.year,
        genre=audio.genre,
        track_number=audio.track_number,
        cover_art_data=cover_art_data,
        lyrics=plain_lyrics,
        synced_lyrics=synced_lyrics,
    )
    return output_path
