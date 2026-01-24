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
    from mutagen.id3 import ID3, TIT2, TPE1, TALB, TDRC, TCON, TRCK, APIC
    MUTAGEN_AVAILABLE = True
except ImportError:
    MUTAGEN_AVAILABLE = False
    print("Warning: mutagen not available, cannot write audio tags")


def download_cover_art(url: str) -> Optional[bytes]:
    """Download cover art image from URL"""
    try:
        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            return response.content
    except Exception as e:
        print(f"Error downloading cover art: {e}")
    return None


def write_metadata_to_file(
    file_path: str,
    title: Optional[str] = None,
    artist: Optional[str] = None,
    album: Optional[str] = None,
    year: Optional[int] = None,
    genre: Optional[str] = None,
    track_number: Optional[int] = None,
    cover_art_url: Optional[str] = None,
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
        
    Returns:
        True if successful, False otherwise
    """
    if not MUTAGEN_AVAILABLE:
        print("mutagen not available")
        return False
    
    # Build full path
    full_path = Path(settings.MEDIA_ROOT) / file_path
    
    if not full_path.exists():
        print(f"File not found: {full_path}")
        return False
    
    # Get file extension
    ext = full_path.suffix.lower()
    
    try:
        if ext == '.mp3':
            return _write_mp3_tags(full_path, title, artist, album, year, genre, track_number, cover_art_url)
        elif ext in ['.m4a', '.mp4', '.aac']:
            return _write_mp4_tags(full_path, title, artist, album, year, genre, track_number, cover_art_url)
        elif ext == '.ogg':
            return _write_ogg_tags(full_path, title, artist, album, year, genre, track_number)
        elif ext == '.flac':
            return _write_flac_tags(full_path, title, artist, album, year, genre, track_number, cover_art_url)
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
    cover_art_url: Optional[str],
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
    if cover_art_url:
        cover_data = download_cover_art(cover_art_url)
        if cover_data:
            audio.tags.add(APIC(
                encoding=3,
                mime='image/jpeg',
                type=3,  # Cover (front)
                desc='Cover',
                data=cover_data
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
    cover_art_url: Optional[str],
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
    
    # Add cover art
    if cover_art_url:
        cover_data = download_cover_art(cover_art_url)
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
    cover_art_url: Optional[str],
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
    
    # Add cover art
    if cover_art_url:
        cover_data = download_cover_art(cover_art_url)
        if cover_data:
            picture = Picture()
            picture.type = 3  # Cover (front)
            picture.mime = 'image/jpeg'
            picture.desc = 'Cover'
            picture.data = cover_data
            audio.add_picture(picture)
    
    audio.save()
    print(f"Written FLAC tags to {file_path}")
    return True
