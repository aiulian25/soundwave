"""
Metadata fetcher for audio files
Fetches metadata from online sources like MusicBrainz, Last.fm, etc.
"""

import re
import time
import requests
from typing import Optional, Dict, Any, List
from dataclasses import dataclass


@dataclass
class MetadataResult:
    """Metadata result from online sources"""
    title: Optional[str] = None
    artist: Optional[str] = None
    album: Optional[str] = None
    year: Optional[int] = None
    genre: Optional[str] = None
    track_number: Optional[int] = None
    cover_art_url: Optional[str] = None
    musicbrainz_id: Optional[str] = None
    source: str = "unknown"
    confidence: float = 0.0


class MetadataFetcher:
    """Fetch metadata from online sources"""
    
    # MusicBrainz API base URL
    MUSICBRAINZ_API = "https://musicbrainz.org/ws/2"
    # Cover Art Archive
    COVERART_API = "https://coverartarchive.org"
    # User agent required by MusicBrainz
    USER_AGENT = "SoundWave/1.0 (https://github.com/aiulian25/soundwave)"
    
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": self.USER_AGENT,
            "Accept": "application/json"
        })
        self._last_request_time = 0
    
    def _rate_limit(self):
        """MusicBrainz requires 1 second between requests"""
        elapsed = time.time() - self._last_request_time
        if elapsed < 1.0:
            time.sleep(1.0 - elapsed)
        self._last_request_time = time.time()
    
    def _clean_title(self, title: str) -> tuple[str, str]:
        """
        Extract artist and clean title from YouTube-style titles
        Common formats:
        - "Artist - Song Title"
        - "Artist - Song Title (Official Video)"
        - "Song Title | Artist"
        - "Artist: Song Title"
        """
        # Remove common suffixes
        suffixes_to_remove = [
            r'\s*\(Official\s*(Music\s*)?Video\)',
            r'\s*\(Official\s*Audio\)',
            r'\s*\(Lyric\s*Video\)',
            r'\s*\(Lyrics\)',
            r'\s*\(Audio\)',
            r'\s*\(HD\)',
            r'\s*\(HQ\)',
            r'\s*\[Official\s*(Music\s*)?Video\]',
            r'\s*\[Official\s*Audio\]',
            r'\s*\[Lyric\s*Video\]',
            r'\s*\[Lyrics\]',
            r'\s*\[Audio\]',
            r'\s*\[HD\]',
            r'\s*\[HQ\]',
            r'\s*ft\.\s*[\w\s]+',
            r'\s*feat\.\s*[\w\s]+',
            r'\s*featuring\s+[\w\s]+',
            r'\s*\(ft\.\s*[\w\s]+\)',
            r'\s*\(feat\.\s*[\w\s]+\)',
        ]
        
        cleaned_title = title
        for suffix in suffixes_to_remove:
            cleaned_title = re.sub(suffix, '', cleaned_title, flags=re.IGNORECASE)
        
        cleaned_title = cleaned_title.strip()
        
        # Try to extract artist from title
        artist = ""
        song_title = cleaned_title
        
        # Try "Artist - Title" format
        if " - " in cleaned_title:
            parts = cleaned_title.split(" - ", 1)
            artist = parts[0].strip()
            song_title = parts[1].strip()
        # Try "Title | Artist" format
        elif " | " in cleaned_title:
            parts = cleaned_title.split(" | ", 1)
            song_title = parts[0].strip()
            artist = parts[1].strip()
        # Try "Artist: Title" format
        elif ": " in cleaned_title:
            parts = cleaned_title.split(": ", 1)
            artist = parts[0].strip()
            song_title = parts[1].strip()
        
        return artist, song_title
    
    def search_musicbrainz(self, title: str, artist: str = "", channel_name: str = "") -> List[MetadataResult]:
        """
        Search MusicBrainz for recording metadata
        Returns list of possible matches
        """
        results = []
        
        # Clean the title
        extracted_artist, clean_title = self._clean_title(title)
        
        # Use extracted artist if none provided
        if not artist:
            artist = extracted_artist or channel_name
        
        self._rate_limit()
        
        try:
            # Build search query
            query_parts = []
            if clean_title:
                query_parts.append(f'recording:"{clean_title}"')
            if artist:
                query_parts.append(f'artist:"{artist}"')
            
            query = " AND ".join(query_parts) if query_parts else clean_title
            
            response = self.session.get(
                f"{self.MUSICBRAINZ_API}/recording",
                params={
                    "query": query,
                    "fmt": "json",
                    "limit": 10
                }
            )
            
            if response.status_code != 200:
                print(f"MusicBrainz search failed: {response.status_code}")
                return results
            
            data = response.json()
            recordings = data.get("recordings", [])
            
            for recording in recordings:
                result = MetadataResult(source="musicbrainz")
                result.title = recording.get("title")
                result.musicbrainz_id = recording.get("id")
                
                # Get artist
                artist_credits = recording.get("artist-credit", [])
                if artist_credits:
                    artists = [ac.get("name", "") for ac in artist_credits if ac.get("name")]
                    result.artist = ", ".join(artists)
                
                # Get release info (album)
                releases = recording.get("releases", [])
                if releases:
                    release = releases[0]  # Take first release
                    result.album = release.get("title")
                    
                    # Get release date/year
                    date = release.get("date", "")
                    if date:
                        try:
                            result.year = int(date[:4])
                        except (ValueError, IndexError):
                            pass
                    
                    # Get track number
                    media = release.get("media", [])
                    if media:
                        tracks = media[0].get("track", [])
                        if tracks:
                            result.track_number = tracks[0].get("number")
                    
                    # Try to get cover art
                    release_id = release.get("id")
                    if release_id:
                        result.cover_art_url = f"{self.COVERART_API}/release/{release_id}/front-250"
                
                # Calculate confidence score
                score = recording.get("score", 0)
                result.confidence = score / 100.0
                
                results.append(result)
            
        except Exception as e:
            print(f"Error searching MusicBrainz: {e}")
        
        return results
    
    def get_recording_details(self, musicbrainz_id: str) -> Optional[MetadataResult]:
        """Get detailed information for a specific MusicBrainz recording"""
        self._rate_limit()
        
        try:
            response = self.session.get(
                f"{self.MUSICBRAINZ_API}/recording/{musicbrainz_id}",
                params={
                    "inc": "artists+releases+genres+tags",
                    "fmt": "json"
                }
            )
            
            if response.status_code != 200:
                return None
            
            data = response.json()
            
            result = MetadataResult(source="musicbrainz")
            result.title = data.get("title")
            result.musicbrainz_id = musicbrainz_id
            
            # Get artist
            artist_credits = data.get("artist-credit", [])
            if artist_credits:
                artists = [ac.get("name", "") for ac in artist_credits if ac.get("name")]
                result.artist = ", ".join(artists)
            
            # Get genre from tags
            tags = data.get("tags", [])
            if tags:
                # Sort by count and get top tag
                sorted_tags = sorted(tags, key=lambda x: x.get("count", 0), reverse=True)
                result.genre = sorted_tags[0].get("name", "").title()
            
            # Get genres if available
            genres = data.get("genres", [])
            if genres and not result.genre:
                result.genre = genres[0].get("name", "").title()
            
            # Get release info
            releases = data.get("releases", [])
            if releases:
                release = releases[0]
                result.album = release.get("title")
                
                date = release.get("date", "")
                if date:
                    try:
                        result.year = int(date[:4])
                    except (ValueError, IndexError):
                        pass
                
                release_id = release.get("id")
                if release_id:
                    result.cover_art_url = f"{self.COVERART_API}/release/{release_id}/front-250"
            
            result.confidence = 1.0
            return result
            
        except Exception as e:
            print(f"Error getting recording details: {e}")
            return None
    
    def fetch_cover_art(self, release_id: str) -> Optional[str]:
        """Fetch cover art URL for a release"""
        try:
            # First check if cover art exists
            response = self.session.get(
                f"{self.COVERART_API}/release/{release_id}",
                allow_redirects=False
            )
            
            if response.status_code == 307:
                # Cover art exists, return the front image URL
                return f"{self.COVERART_API}/release/{release_id}/front-500"
            
        except Exception as e:
            print(f"Error fetching cover art: {e}")
        
        return None


# Singleton instance
metadata_fetcher = MetadataFetcher()
