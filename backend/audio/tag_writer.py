"""
Write metadata tags to audio files using mutagen
Supports MP3 (ID3), M4A/MP4 (MP4Tags), OGG, FLAC, etc.
"""

import os
import requests
from pathlib import Path
from typing import Optional
from django.conf import settings

try:
    from mutagen.mp3 import MP3
    from mutagen.mp4 import MP4, MP4Cover
    from mutagen.oggvorbis import OggVorbis
    from mutagen.flac import FLAC, Picture
    from mutagen.id3 import ID3, TIT2, TPE1, TALB, TDRC, TCON, TRCK, APIC, USLT, SYLT, Encoding
    MUTAGEN_AVAILABLE = True
except ImportError:
    MUTAGEN_AVAILABLE = False
    print("Warning: mutagen not available, cannot write audio tags")

# Allowed URL prefixes for artwork download (SSRF protection)
ALLOWED_ARTWORK_URL_PREFIXES = (
    'https://i.ytimg.com/',           # YouTube thumbnails
    'https://i3.ytimg.com/',          # YouTube thumbnails alt
    'https://i9.ytimg.com/',          # YouTube thumbnails alt
    'https://img.youtube.com/',       # YouTube thumbnails
    'https://coverartarchive.org/',   # MusicBrainz Cover Art Archive
    'http://coverartarchive.org/',    # MusicBrainz Cover Art Archive (HTTP)
    'https://assets.fanart.tv/',      # Fanart.tv
    'https://lastfm.freetls.fastly.net/',  # Last.fm images
)


def _is_safe_artwork_url(url: str) -> bool:
    """Validate URL is from a trusted source to prevent SSRF attacks"""
    if not url:
        return False
    return any(url.startswith(prefix) for prefix in ALLOWED_ARTWORK_URL_PREFIXES)


def download_cover_art(url: str) -> Optional[bytes]:
    """Download cover art image from URL (with SSRF protection)"""
    # SSRF protection: validate URL is from allowed sources
    if not _is_safe_artwork_url(url):
        return None
    
    try:
        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            return response.content
    except Exception:
        pass  # Don't expose error details
    return None


def parse_lrc_to_synced_lyrics(lrc_text: str) -> list:
    """
    Parse LRC format text to a list of (time_ms, text) tuples for SYLT tag.
    
    Args:
        lrc_text: LRC formatted lyrics string
        
    Returns:
        List of (text, time_ms) tuples
    """
    import re
    synced = []
    
    for line in lrc_text.split('\n'):
        line = line.strip()
        if not line:
            continue
        
        # Match timestamp [mm:ss.xx] or [mm:ss.xxx]
        match = re.match(r'\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)', line)
        if match:
            minutes = int(match.group(1))
            seconds = int(match.group(2))
            centiseconds = match.group(3)
            # Normalize to milliseconds
            if len(centiseconds) == 2:
                ms = int(centiseconds) * 10
            else:
                ms = int(centiseconds)
            
            time_ms = (minutes * 60 + seconds) * 1000 + ms
            text = match.group(4).strip()
            
            if text:
                synced.append((text, time_ms))
    
    return synced


def write_metadata_to_file(
    file_path: str,
    title: Optional[str] = None,
    artist: Optional[str] = None,
    album: Optional[str] = None,
    year: Optional[int] = None,
    genre: Optional[str] = None,
    track_number: Optional[int] = None,
    cover_art_url: Optional[str] = None,
    cover_art_data: Optional[bytes] = None,
    lyrics: Optional[str] = None,
    synced_lyrics: Optional[str] = None,
) -> bool:
    """
    Write metadata tags to an audio file.
    
    Args:
        file_path: Relative path to the audio file (from MEDIA_ROOT)
        title: Song title
        artist: Artist name
        album: Album name
        year: Release year
        genre: Music genre
        track_number: Track number on album
        cover_art_url: URL to download cover art from
        cover_art_data: Raw cover art bytes (takes precedence over URL)
        lyrics: Plain text lyrics (USLT tag)
        synced_lyrics: LRC formatted synced lyrics (SYLT tag for MP3)
        
    Returns:
        True if successful, False otherwise
    """
    if not MUTAGEN_AVAILABLE:
        print("mutagen not available")
        return False
    
    # Build full path - handle both relative and absolute paths
    if os.path.isabs(file_path):
        full_path = Path(file_path)
    else:
        full_path = Path(settings.MEDIA_ROOT) / file_path
    
    if not full_path.exists():
        print(f"File not found: {full_path}")
        return False
    
    # Get file extension
    ext = full_path.suffix.lower()
    
    # Get cover art data
    cover_data = cover_art_data
    if not cover_data and cover_art_url:
        cover_data = download_cover_art(cover_art_url)
    
    try:
        if ext == '.mp3':
            return _write_mp3_tags(full_path, title, artist, album, year, genre, track_number, cover_data, lyrics, synced_lyrics)
        elif ext in ['.m4a', '.mp4', '.aac']:
            return _write_mp4_tags(full_path, title, artist, album, year, genre, track_number, cover_data, lyrics)
        elif ext == '.ogg':
            return _write_ogg_tags(full_path, title, artist, album, year, genre, track_number, lyrics)
        elif ext == '.flac':
            return _write_flac_tags(full_path, title, artist, album, year, genre, track_number, cover_data, lyrics, synced_lyrics)
        else:
            print(f"Unsupported format: {ext}")
            return False
    except Exception as e:
        print(f"Error writing tags to {full_path}: {e}")
        return False


def _write_mp3_tags(
    file_path: Path,
    title: Optional[str],
    artist: Optional[str],
    album: Optional[str],
    year: Optional[int],
    genre: Optional[str],
    track_number: Optional[int],
    cover_data: Optional[bytes],
    lyrics: Optional[str] = None,
    synced_lyrics: Optional[str] = None,
) -> bool:
    """Write ID3 tags to MP3 file"""
    try:
        audio = MP3(file_path)
    except Exception:
        audio = MP3()
    
    # Create ID3 tag if it doesn't exist
    try:
        audio.add_tags()
    except Exception:
        pass  # Tags already exist
    
    if title:
        audio.tags.add(TIT2(encoding=3, text=title))
    if artist:
        audio.tags.add(TPE1(encoding=3, text=artist))
    if album:
        audio.tags.add(TALB(encoding=3, text=album))
    if year:
        audio.tags.add(TDRC(encoding=3, text=str(year)))
    if genre:
        audio.tags.add(TCON(encoding=3, text=genre))
    if track_number:
        audio.tags.add(TRCK(encoding=3, text=str(track_number)))
    
    # Add cover art
    if cover_data:
        # Detect image type
        mime_type = 'image/jpeg'
        if cover_data[:8] == b'\x89PNG\r\n\x1a\n':
            mime_type = 'image/png'
        
        audio.tags.add(APIC(
            encoding=3,
            mime=mime_type,
            type=3,  # Cover (front)
            desc='Cover',
            data=cover_data
        ))
    
    # Add plain lyrics (USLT)
    if lyrics:
        audio.tags.add(USLT(
            encoding=Encoding.UTF8,
            lang='eng',
            desc='Lyrics',
            text=lyrics
        ))
    
    # Add synced lyrics (SYLT) - LRC embedded
    if synced_lyrics:
        synced_data = parse_lrc_to_synced_lyrics(synced_lyrics)
        if synced_data:
            audio.tags.add(SYLT(
                encoding=Encoding.UTF8,
                lang='eng',
                format=2,  # milliseconds
                type=1,    # lyrics
                desc='SyncedLyrics',
                text=synced_data
            ))
    
    audio.save(file_path)
    print(f"Written MP3 tags to {file_path}")
    return True


def _write_mp4_tags(
    file_path: Path,
    title: Optional[str],
    artist: Optional[str],
    album: Optional[str],
    year: Optional[int],
    genre: Optional[str],
    track_number: Optional[int],
    cover_data: Optional[bytes],
    lyrics: Optional[str] = None,
) -> bool:
    """Write MP4/M4A tags"""
    audio = MP4(file_path)
    
    if title:
        audio['\xa9nam'] = [title]  # Title
    if artist:
        audio['\xa9ART'] = [artist]  # Artist
    if album:
        audio['\xa9alb'] = [album]  # Album
    if year:
        audio['\xa9day'] = [str(year)]  # Year
    if genre:
        audio['\xa9gen'] = [genre]  # Genre
    if track_number:
        audio['trkn'] = [(track_number, 0)]  # Track number
    
    # Add lyrics
    if lyrics:
        audio['\xa9lyr'] = [lyrics]
    
    # Add cover art
    if cover_data:
        # Determine image format
        if cover_data[:3] == b'\xff\xd8\xff':
            img_format = MP4Cover.FORMAT_JPEG
        elif cover_data[:8] == b'\x89PNG\r\n\x1a\n':
            img_format = MP4Cover.FORMAT_PNG
        else:
            img_format = MP4Cover.FORMAT_JPEG
        
        audio['covr'] = [MP4Cover(cover_data, imageformat=img_format)]
    
    audio.save()
    print(f"Written MP4 tags to {file_path}")
    return True


def _write_ogg_tags(
    file_path: Path,
    title: Optional[str],
    artist: Optional[str],
    album: Optional[str],
    year: Optional[int],
    genre: Optional[str],
    track_number: Optional[int],
    lyrics: Optional[str] = None,
) -> bool:
    """Write Vorbis comments to OGG file"""
    audio = OggVorbis(file_path)
    
    if title:
        audio['title'] = [title]
    if artist:
        audio['artist'] = [artist]
    if album:
        audio['album'] = [album]
    if year:
        audio['date'] = [str(year)]
    if genre:
        audio['genre'] = [genre]
    if track_number:
        audio['tracknumber'] = [str(track_number)]
    if lyrics:
        audio['lyrics'] = [lyrics]
    
    audio.save()
    print(f"Written OGG tags to {file_path}")
    return True


def _write_flac_tags(
    file_path: Path,
    title: Optional[str],
    artist: Optional[str],
    album: Optional[str],
    year: Optional[int],
    genre: Optional[str],
    track_number: Optional[int],
    cover_data: Optional[bytes],
    lyrics: Optional[str] = None,
    synced_lyrics: Optional[str] = None,
) -> bool:
    """Write tags to FLAC file"""
    audio = FLAC(file_path)
    
    if title:
        audio['title'] = [title]
    if artist:
        audio['artist'] = [artist]
    if album:
        audio['album'] = [album]
    if year:
        audio['date'] = [str(year)]
    if genre:
        audio['genre'] = [genre]
    if track_number:
        audio['tracknumber'] = [str(track_number)]
    
    # Add lyrics (Vorbis comment)
    if lyrics:
        audio['lyrics'] = [lyrics]
    
    # Add synced lyrics as LRC in a custom tag
    if synced_lyrics:
        audio['syncedlyrics'] = [synced_lyrics]
    
    # Add cover art
    if cover_data:
        # Clear existing pictures
        audio.clear_pictures()
        
        picture = Picture()
        picture.type = 3  # Cover (front)
        picture.desc = 'Cover'
        picture.data = cover_data
        
        # Detect image type
        if cover_data[:8] == b'\x89PNG\r\n\x1a\n':
            picture.mime = 'image/png'
        else:
            picture.mime = 'image/jpeg'
        
        audio.add_picture(picture)
    
    audio.save()
    print(f"Written FLAC tags to {file_path}")
    return True
