"""Shared audio-export core used by single-track export and playlist ZIP export (F13).

Factors the ffmpeg conversion + metadata embedding out of AudioExportView so both the
single-track endpoint and the playlist-export loop run the exact same code path.
"""

import logging
import shutil
import subprocess
import json
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

from django.conf import settings

logger = logging.getLogger(__name__)

SUPPORTED_EXPORT_FORMATS = ('mp3', 'flac')

# 'original' keeps the source's own audio untouched when it is already in the target format.
QUALITY_ORIGINAL = 'original'
EXPORT_QUALITIES = ('high', 'medium', 'low', QUALITY_ORIGINAL)

# Something the user asked for that is not in the delivered file.
WARNING_TAGS_FAILED = 'tags_failed'
WARNING_ARTWORK_UNAVAILABLE = 'artwork_unavailable'

# MP3 bitrate per quality tier; FLAC ignores quality and uses a fixed compression level.
_MP3_BITRATE_BY_QUALITY = {'high': '320k', 'medium': '192k', 'low': '128k'}
_DEFAULT_MP3_BITRATE = _MP3_BITRATE_BY_QUALITY['high']
_FLAC_COMPRESSION_LEVEL = '8'
_FFMPEG_TIMEOUT_SECONDS = 300
_ARTWORK_FETCH_TIMEOUT_SECONDS = 10
_MAX_SAFE_TITLE_LENGTH = 100
_EXPORT_SUMMARY_NAME = 'export-summary.json'


@dataclass(frozen=True)
class ExportedTrack:
    path: Path
    warnings: tuple = ()


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
        return ['-vn', '-codec:a', 'libmp3lame', '-b:a', bitrate]
    return ['-vn', '-codec:a', 'flac', '-compression_level', _FLAC_COMPRESSION_LEVEL]


def convert_audio(source_path, target_format, quality, output_path):
    """Write source_path to output_path as target_format at the requested quality.

    A matching source is copied only when that delivers what was asked: on request ('original'),
    or for FLAC, where re-encoding lossless audio changes nothing. Asking for a bitrate always
    re-encodes, so "low" really is low, but no encoding can restore what a lossy source lost.

    Raises AudioConversionError if ffmpeg exits non-zero.
    """
    source_path = Path(source_path)
    output_path = Path(output_path)

    already_target_format = source_path.suffix.lower() == f'.{target_format}'
    copy_is_faithful = quality == QUALITY_ORIGINAL or target_format == 'flac'
    if already_target_format and copy_is_faithful:
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


def _artwork_source(audio, artwork_url):
    return artwork_url or audio.cover_art_url or audio.thumbnail_url


def _kept_artwork(audio):
    from audio.artwork_archive import archive_track_artwork
    from audio.artwork_images import InvalidArtworkImage, load_artwork_image

    artwork = archive_track_artwork(audio)
    if artwork is None:
        return None
    try:
        return load_artwork_image(artwork)[0]
    except InvalidArtworkImage:
        return None


def _fetch_cover_art(audio, artwork_url):
    # Lazy import avoids an import cycle (audio.views imports this module's export core).
    from audio.views import is_safe_artwork_url
    from audio.artwork_images import InvalidArtworkImage, MAX_ARTWORK_BYTES, decoded_mime_type
    from common.safe_http import FetchRefused, fetch_public_url
    import requests

    if not artwork_url:
        kept = _kept_artwork(audio)
        if kept is not None:
            return kept

    art_url = _artwork_source(audio, artwork_url)
    if not art_url or not is_safe_artwork_url(art_url):
        return None
    try:
        fetched = fetch_public_url(art_url, MAX_ARTWORK_BYTES, _ARTWORK_FETCH_TIMEOUT_SECONDS)
        decoded_mime_type(fetched.content)
        return fetched.content
    except (FetchRefused, InvalidArtworkImage, requests.RequestException) as exc:
        logger.warning("Export: failed to fetch artwork for %s: %s", audio.youtube_id, exc)
    return None


def export_track_to_file(audio, target_format, quality, output_dir, *,
                         embed_lyrics=True, embed_artwork=True, artwork_url='', filename=None):
    """Convert one Audio into output_dir as target_format with metadata embedded.

    Returns the written file with warnings for anything requested that it does not contain.
    Raises ExportSourceUnavailable when the source file is missing, or AudioConversionError
    when ffmpeg fails.
    """
    source_path = _resolve_source_path(audio)

    if not filename:
        fallback = f"audio_{audio.youtube_id or audio.id}"
        filename = f"{sanitize_export_filename(audio.title, fallback)}.{target_format}"
    output_path = Path(output_dir) / filename

    convert_audio(source_path, target_format, quality, output_path)

    plain_lyrics, synced_lyrics = _load_lyrics(audio) if embed_lyrics else (None, None)
    cover_art_data = _fetch_cover_art(audio, artwork_url) if embed_artwork else None

    warnings = []
    if embed_artwork and _artwork_source(audio, artwork_url) and not cover_art_data:
        warnings.append(WARNING_ARTWORK_UNAVAILABLE)

    from audio.tag_writer import write_metadata_to_file
    tags_written = write_metadata_to_file(
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
    if not tags_written:
        warnings.append(WARNING_TAGS_FAILED)
    return ExportedTrack(output_path, tuple(warnings))


@dataclass
class ZipOutcome:
    path: Path
    exported_count: int = 0
    omitted: list = field(default_factory=list)
    warnings: list = field(default_factory=list)


def exportable_playlist_tracks(playlist):
    """The playlist's downloaded tracks, in playlist order."""
    from playlist.models import PlaylistItem

    items = PlaylistItem.objects.filter(playlist=playlist).select_related('audio').order_by('position')
    return [item.audio for item in items if item.audio and item.audio.file_path]


def _unique_zip_arcname(audio, target_format, used_names):
    """Build a collision-free, path-safe archive name for this track."""
    fallback = f"audio_{audio.youtube_id or audio.id}"
    base = sanitize_export_filename(audio.title, fallback)
    candidate = f"{base}.{target_format}"
    counter = 2
    while candidate in used_names:
        candidate = f"{base} ({counter}).{target_format}"
        counter += 1
    used_names.add(candidate)
    return candidate


def write_playlist_zip(tracks, options, work_dir, title, *, still_wanted=None, report_progress=None):
    """Build one ZIP in work_dir, keeping scratch small by removing each track as it is added.

    The file also records anything left out. Stops early, with what it has, if the export stops
    being wanted or grows past the limit. An OSError such as a full disk reaches the caller.
    """
    work_dir = Path(work_dir)
    tracks_dir = work_dir / 'tracks'
    tracks_dir.mkdir()
    zip_base = sanitize_export_filename(title, 'playlist')
    outcome = ZipOutcome(work_dir / f'{zip_base}.zip')
    target_format = options['format']
    used_names = set()

    with zipfile.ZipFile(outcome.path, 'w', zipfile.ZIP_STORED) as archive:
        for done, audio in enumerate(tracks):
            if still_wanted and not still_wanted():
                break
            if outcome.path.stat().st_size > settings.EXPORT_MAX_BYTES:
                outcome.omitted.extend({'title': track.title, 'reason': 'too_large'} for track in tracks[done:])
                break

            arcname = _unique_zip_arcname(audio, target_format, used_names)
            try:
                exported = export_track_to_file(
                    audio,
                    target_format,
                    options['quality'],
                    tracks_dir,
                    embed_lyrics=options['embed_lyrics'],
                    embed_artwork=options['embed_artwork'],
                    filename=arcname,
                )
            except (AudioConversionError, ExportSourceUnavailable, subprocess.TimeoutExpired) as error:
                logger.warning("[PlaylistExport] Skipping '%s': %s", audio.title, error)
                outcome.omitted.append({'title': audio.title, 'reason': type(error).__name__})
            else:
                archive.write(exported.path, arcname=arcname)
                exported.path.unlink(missing_ok=True)
                outcome.exported_count += 1
                if exported.warnings:
                    outcome.warnings.append({'file': arcname, 'warnings': list(exported.warnings)})
            if report_progress:
                report_progress(done + 1)

        # A partial export says so inside the file too, where it outlives this response.
        if outcome.omitted or outcome.warnings:
            archive.writestr(
                _EXPORT_SUMMARY_NAME,
                json.dumps({'omitted': outcome.omitted, 'warnings': outcome.warnings}, ensure_ascii=False, indent=2),
            )
    return outcome
