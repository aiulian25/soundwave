"""Lyrics fetching service using LRCLIB API"""
import re
import requests
import logging
from typing import Optional, Dict, Any, Tuple
from datetime import timedelta
from django.utils import timezone
from django.core.cache import cache

logger = logging.getLogger(__name__)


def clean_title_for_lyrics(title: str, channel_name: str = "") -> Tuple[str, str]:
    """
    Clean YouTube title to extract proper track name and artist for lyrics search.
    
    YouTube titles often look like:
    - "Artist - Song Title (Official Video)"
    - "Song Title | Artist Name"
    - "Artist Name - Song (Lyric Video) [HD]"
    - "Song Title - by Artist Name + lyrics"
    - "Song Title by Artist"
    
    Returns:
        Tuple of (cleaned_title, artist_name)
    """
    original_title = title
    
    # Common suffixes to remove
    suffixes_to_remove = [
        r'\s*\+\s*lyrics?',  # "+ lyrics" or "+lyrics"
        r'\s+lyrics?$',  # trailing "lyrics" at end
        r'\s*with\s+lyrics?',  # "with lyrics"
        r'\s*\(Official\s*(Music\s*)?Video\)',
        r'\s*\(Official\s*Audio\)',
        r'\s*\(Official\s*Lyric\s*Video\)',
        r'\s*\(Lyric\s*Video\)',
        r'\s*\(Lyrics?\)',
        r'\s*\(Audio\)',
        r'\s*\(Visualizer\)',
        r'\s*\(Live\)',
        r'\s*\(Acoustic\)',
        r'\s*\(Cover\)',
        r'\s*\(Remix\)',
        r'\s*\[Official\s*(Music\s*)?Video\]',
        r'\s*\[Official\s*Audio\]',
        r'\s*\[HD\]',
        r'\s*\[HQ\]',
        r'\s*\[4K\]',
        r'\s*\|\s*Official\s*Video',
        r'\s*-\s*Official\s*Video',
        r'\s*ft\.?\s+[\w\s&]+$',  # featuring
        r'\s*feat\.?\s+[\w\s&]+$',
    ]
    
    cleaned = title
    for pattern in suffixes_to_remove:
        cleaned = re.sub(pattern, '', cleaned, flags=re.IGNORECASE)
    
    cleaned = cleaned.strip()
    
    # Try to extract artist and title from common patterns
    artist = channel_name
    track = cleaned
    
    # Pattern 0: "Song Title - by Artist Name" (common pattern)
    by_match = re.match(r'^(.+?)\s*-\s*by\s+(.+)$', cleaned, re.IGNORECASE)
    if by_match:
        track = by_match.group(1).strip()
        artist = by_match.group(2).strip()
        logger.debug(f"Matched 'Title - by Artist' pattern")
    # Pattern 0b: "Song Title by Artist Name" (without dash)
    elif re.search(r'\s+by\s+', cleaned, re.IGNORECASE):
        by_match = re.match(r'^(.+?)\s+by\s+(.+)$', cleaned, re.IGNORECASE)
        if by_match:
            track = by_match.group(1).strip()
            artist = by_match.group(2).strip()
            logger.debug(f"Matched 'Title by Artist' pattern")
    # Pattern 1: Check if first part of "X - Y" looks like a known artist name format
    elif ' - ' in cleaned:
        parts = cleaned.split(' - ', 1)
        if len(parts) == 2:
            potential_artist = parts[0].strip()
            potential_title = parts[1].strip()
            
            # Heuristics to determine if first part is artist or title:
            # - If first part is short (1-2 words) and second part is long, first might be title
            # - If second part contains "&", "+", "and", it might be multiple artists
            # - If channel_name matches, use it for guidance
            
            first_word_count = len(potential_artist.split())
            second_word_count = len(potential_title.split())
            has_collaboration = bool(re.search(r'\s*[&+]\s*|\s+and\s+', potential_title, re.IGNORECASE))
            
            # If second part looks like multiple artists (has & or +), swap
            if has_collaboration and first_word_count <= 2 and second_word_count >= 2:
                # Likely "Song - Artist1 + Artist2" format
                track = potential_artist
                artist = potential_title
                logger.debug(f"Matched 'Title - Artist1 + Artist2' pattern")
            # If the first part looks like the channel name, use it as artist
            elif channel_name and (
                potential_artist.lower() == channel_name.lower() or
                potential_artist.lower() in channel_name.lower() or
                channel_name.lower() in potential_artist.lower()
            ):
                artist = potential_artist
                track = potential_title
                logger.debug(f"Matched 'Artist - Title' pattern via channel match")
            else:
                # Default: First part is artist (most common YouTube format)
                artist = potential_artist
                track = potential_title
                logger.debug(f"Matched default 'Artist - Title' pattern")
    # Pattern 2: "Title | Artist"
    elif ' | ' in cleaned:
        parts = cleaned.split(' | ', 1)
        if len(parts) == 2:
            track = parts[0].strip()
            artist = parts[1].strip() or channel_name
    # Pattern 2b: "Artist; Title" (semicolon separator)
    elif '; ' in cleaned:
        parts = cleaned.split('; ', 1)
        if len(parts) == 2:
            # Usually "Artist; Title" format
            artist = parts[0].strip()
            track = parts[1].strip()
            logger.debug(f"Matched 'Artist; Title' pattern")
    # Pattern 3: Title contains artist name at the beginning
    elif channel_name and cleaned.lower().startswith(channel_name.lower()):
        track = cleaned[len(channel_name):].strip()
        if track.startswith('-'):
            track = track[1:].strip()
        if track.startswith(':'):
            track = track[1:].strip()
    
    # Clean up extra whitespace
    track = ' '.join(track.split())
    artist = ' '.join(artist.split())
    
    # Remove surrounding quotes if present
    track = track.strip('"\'')
    artist = artist.strip('"\'')
    
    logger.debug(f"Title cleaned: '{original_title}' -> track='{track}', artist='{artist}'")
    
    return track, artist


class LRCLIBClient:
    """Client for LRCLIB API (https://lrclib.net/)"""
    
    DEFAULT_INSTANCE = "https://lrclib.net"
    USER_AGENT = "SoundWave/1.0 (https://github.com/soundwave)"
    TIMEOUT = 10  # seconds
    
    def __init__(self, instance_url: str = None):
        self.instance_url = (instance_url or self.DEFAULT_INSTANCE).rstrip('/')
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': self.USER_AGENT,
        })
    
    def get_lyrics(
        self,
        title: str,
        artist_name: str,
        album_name: str = "",
        duration: int = 0
    ) -> Dict[str, Any]:
        """
        Fetch lyrics from LRCLIB API
        
        Args:
            title: Track title
            artist_name: Artist name
            album_name: Album name (optional)
            duration: Track duration in seconds
            
        Returns:
            Dict with keys:
                - synced_lyrics: LRC format lyrics with timestamps
                - plain_lyrics: Plain text lyrics
                - instrumental: Boolean if track is instrumental
                - language: Language code
        """
        # Try direct get endpoint first (more accurate with duration)
        if duration and duration > 0:
            result = self._get_lyrics_direct(title, artist_name, album_name, duration)
            if result and not result.get('not_found'):
                return result
        
        # Fall back to search endpoint (works without exact duration)
        result = self._search_lyrics(title, artist_name, duration)
        if result:
            return result
        
        # Nothing found
        return {
            'synced_lyrics': '',
            'plain_lyrics': '',
            'instrumental': False,
            'language': '',
            'not_found': True,
        }
    
    def _get_lyrics_direct(
        self,
        title: str,
        artist_name: str,
        album_name: str = "",
        duration: int = 0
    ) -> Dict[str, Any]:
        """Direct get endpoint - requires exact match"""
        params = {
            'track_name': title,
            'artist_name': artist_name,
            'album_name': album_name,
            'duration': round(duration) if duration else 0,
        }
        
        api_endpoint = f"{self.instance_url}/api/get"
        
        try:
            response = self.session.get(
                api_endpoint,
                params=params,
                timeout=self.TIMEOUT
            )
            
            if response.status_code in (400, 404):
                # No lyrics found or bad request
                return None
            
            response.raise_for_status()
            data = response.json()
            
            return self._parse_lyrics_response(data)
            
        except requests.exceptions.RequestException as e:
            logger.debug(f"Direct get failed for {title} - {artist_name}: {e}")
            return None
    
    def search_lyrics_suggestions(
        self,
        query: str,
        artist_name: str = ""
    ) -> list:
        """Search for lyrics suggestions - returns all results for user to choose
        
        Uses multiple search strategies to find matches:
        1. Full query with artist
        2. Just the query as general search
        3. Keywords extracted from query
        4. Individual significant words
        """
        all_suggestions = []
        seen_ids = set()
        
        # Strategy 1: Search with track_name and artist_name if we have both
        if artist_name:
            results = self._do_search({'track_name': query, 'artist_name': artist_name})
            for item in results:
                if item['id'] not in seen_ids:
                    seen_ids.add(item['id'])
                    all_suggestions.append(item)
        
        # Strategy 2: General search with full query
        if len(all_suggestions) < 10:
            results = self._do_search({'q': query})
            for item in results:
                if item['id'] not in seen_ids:
                    seen_ids.add(item['id'])
                    all_suggestions.append(item)
        
        # Strategy 3: Extract keywords and search
        keywords = self._extract_search_keywords(query)
        if keywords and len(all_suggestions) < 10:
            for keyword_combo in keywords:
                if len(all_suggestions) >= 20:
                    break
                results = self._do_search({'q': keyword_combo})
                for item in results:
                    if item['id'] not in seen_ids:
                        seen_ids.add(item['id'])
                        all_suggestions.append(item)
        
        # Strategy 4: If still no results, try artist name alone (might be in title)
        if not all_suggestions and artist_name:
            results = self._do_search({'q': artist_name})
            for item in results:
                if item['id'] not in seen_ids:
                    seen_ids.add(item['id'])
                    all_suggestions.append(item)
        
        return all_suggestions[:25]  # Limit to 25 suggestions
    
    def _extract_search_keywords(self, query: str) -> list:
        """Extract meaningful search keywords from a query"""
        import re
        
        # Common words to filter out
        stop_words = {
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
            'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
            'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
            'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
            'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'he',
            'she', 'we', 'they', 'my', 'your', 'his', 'her', 'our', 'their',
            'official', 'video', 'audio', 'lyrics', 'lyric', 'hd', 'hq', '4k',
            'live', 'remix', 'cover', 'acoustic', 'version', 'feat', 'ft',
            'music', 'song', 'track', 'album', 'single', 'ep', 'lp',
        }
        
        # Clean the query
        cleaned = re.sub(r'[^\w\s]', ' ', query.lower())
        words = [w for w in cleaned.split() if w and len(w) > 2 and w not in stop_words]
        
        if not words:
            return []
        
        keyword_combos = []
        
        # Try pairs of consecutive words (likely song title fragments)
        if len(words) >= 2:
            for i in range(len(words) - 1):
                keyword_combos.append(f"{words[i]} {words[i+1]}")
        
        # Try individual significant words (4+ chars, likely meaningful)
        significant_words = [w for w in words if len(w) >= 4]
        for word in significant_words[:3]:
            keyword_combos.append(word)
        
        # Try full cleaned query if short enough
        if len(words) <= 5:
            keyword_combos.insert(0, ' '.join(words))
        
        return keyword_combos
    
    def _do_search(self, params: dict) -> list:
        """Execute a search and return formatted results"""
        api_endpoint = f"{self.instance_url}/api/search"
        
        try:
            response = self.session.get(
                api_endpoint,
                params=params,
                timeout=self.TIMEOUT
            )
            
            if response.status_code == 404:
                return []
            
            response.raise_for_status()
            results = response.json()
            
            if not results:
                return []
            
            # Format results
            suggestions = []
            for item in results:
                suggestions.append({
                    'id': item.get('id'),
                    'track_name': item.get('trackName', ''),
                    'artist_name': item.get('artistName', ''),
                    'album_name': item.get('albumName', ''),
                    'duration': item.get('duration', 0),
                    'has_synced': bool(item.get('syncedLyrics')),
                    'has_plain': bool(item.get('plainLyrics')),
                    'synced_lyrics': item.get('syncedLyrics', ''),
                    'plain_lyrics': item.get('plainLyrics', ''),
                    'instrumental': item.get('instrumental', False),
                    'language': item.get('lang', ''),
                })
            
            return suggestions
            
        except requests.exceptions.RequestException as e:
            logger.debug(f"Search failed for {params}: {e}")
            return []

    def _search_lyrics(
        self,
        title: str,
        artist_name: str,
        duration: int = 0
    ) -> Dict[str, Any]:
        """Search endpoint - more flexible, finds best match"""
        params = {
            'track_name': title,
            'artist_name': artist_name,
        }
        
        api_endpoint = f"{self.instance_url}/api/search"
        
        try:
            response = self.session.get(
                api_endpoint,
                params=params,
                timeout=self.TIMEOUT
            )
            
            if response.status_code == 404:
                return None
            
            response.raise_for_status()
            results = response.json()
            
            if not results:
                return None
            
            # Find the best match based on duration (if provided)
            best_match = None
            best_duration_diff = float('inf')
            
            for item in results:
                item_duration = item.get('duration', 0)
                
                # Prefer items with synced lyrics
                has_synced = bool(item.get('syncedLyrics'))
                
                if duration and duration > 0:
                    duration_diff = abs(item_duration - duration)
                    # Weight: synced lyrics are valuable, so reduce diff by 10s if synced
                    if has_synced:
                        duration_diff = max(0, duration_diff - 10)
                    
                    if duration_diff < best_duration_diff:
                        best_duration_diff = duration_diff
                        best_match = item
                elif has_synced:
                    # No duration to compare, prefer synced lyrics
                    best_match = item
                    break
                elif best_match is None:
                    best_match = item
            
            if not best_match:
                best_match = results[0]
            
            logger.debug(f"Search found: {best_match.get('trackName')} by {best_match.get('artistName')} (duration diff: {best_duration_diff}s)")
            
            return self._parse_lyrics_response(best_match)
            
        except requests.exceptions.RequestException as e:
            logger.debug(f"Search failed for {title} - {artist_name}: {e}")
            return None
    
    def _parse_lyrics_response(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Parse LRCLIB response into standard format"""
        synced = data.get('syncedLyrics') or ''
        plain = data.get('plainLyrics') or ''
        instrumental = data.get('instrumental', False)
        language = data.get('lang') or ''
        
        # If we have synced lyrics but no plain, strip timestamps
        if synced and not plain:
            plain = self._strip_timestamps(synced)
        
        return {
            'synced_lyrics': synced,
            'plain_lyrics': plain,
            'instrumental': instrumental,
            'language': language,
            'not_found': False,
        }
    
    @staticmethod
    def _strip_timestamps(synced_lyrics: str) -> str:
        """Strip timestamps from LRC format lyrics"""
        import re
        lines = []
        for line in synced_lyrics.split('\n'):
            # Remove all timestamp tags [mm:ss.xx]
            cleaned = re.sub(r'\[\d{2}:\d{2}\.\d{2,3}\]', '', line)
            # Remove metadata tags [tag:value]
            cleaned = re.sub(r'\[[a-z]+:.*?\]', '', cleaned)
            if cleaned.strip():
                lines.append(cleaned.strip())
        return '\n'.join(lines)


class LyricsAPIError(Exception):
    """Exception for lyrics API errors"""
    pass


class LyricsService:
    """Service for fetching and caching lyrics"""
    
    def __init__(self, lrclib_instance: str = None):
        self.client = LRCLIBClient(lrclib_instance)
    
    def fetch_lyrics(
        self,
        title: str,
        artist_name: str,
        album_name: str = "",
        duration: int = 0,
        use_cache: bool = True
    ) -> Dict[str, Any]:
        """
        Fetch lyrics with caching
        
        Args:
            title: Track title
            artist_name: Artist name
            album_name: Album name
            duration: Duration in seconds
            use_cache: Whether to use cached results
            
        Returns:
            Dict with lyrics data
        """
        # Create cache key
        cache_key = self._make_cache_key(title, artist_name, album_name, duration)
        
        # Check cache first
        if use_cache:
            cached = cache.get(cache_key)
            if cached is not None:
                logger.debug(f"Cache hit for {title} - {artist_name}")
                return cached
        
        # Fetch from API
        try:
            logger.info(f"Fetching lyrics for {title} - {artist_name}")
            result = self.client.get_lyrics(title, artist_name, album_name, duration)
            
            # Cache the result (even if not found, to avoid repeated requests)
            cache_timeout = 86400 * 7  # 7 days
            if result.get('not_found'):
                cache_timeout = 86400  # 1 day for not found
            
            cache.set(cache_key, result, cache_timeout)
            
            return result
            
        except LyricsAPIError as e:
            logger.warning(f"Failed to fetch lyrics: {e}")
            # Cache the error for a short time to avoid hammering the API
            error_result = {
                'synced_lyrics': '',
                'plain_lyrics': '',
                'instrumental': False,
                'language': '',
                'not_found': True,
                'error': str(e),
            }
            cache.set(cache_key, error_result, 3600)  # 1 hour
            return error_result
    
    @staticmethod
    def _make_cache_key(title: str, artist: str, album: str, duration: int) -> str:
        """Create cache key from track metadata"""
        import hashlib
        key_str = f"{title}|{artist}|{album}|{duration}"
        return f"lyrics:{hashlib.md5(key_str.encode()).hexdigest()}"
    
    def fetch_and_store_lyrics(self, audio_obj, force: bool = False):
        """
        Fetch lyrics and store in database
        
        Args:
            audio_obj: Audio model instance
            force: Force fetch even if already attempted
        """
        from audio.models_lyrics import Lyrics, LyricsCache
        
        # Check if already attempted
        existing, created = Lyrics.objects.get_or_create(audio=audio_obj)
        
        if not force and existing.fetch_attempted and existing.fetch_attempts >= 3:
            logger.debug(f"Skipping {audio_obj.title} - already attempted {existing.fetch_attempts} times")
            return existing
        
        # Clean title for better lyrics matching
        clean_track, clean_artist = clean_title_for_lyrics(audio_obj.title, audio_obj.channel_name)
        
        # Check database cache first (with cleaned title)
        duration_rounded = round(audio_obj.duration)
        cache_entry = LyricsCache.objects.filter(
            title=clean_track,
            artist_name=clean_artist,
            duration=duration_rounded
        ).first()
        
        # Also check with original title as fallback
        if not cache_entry:
            cache_entry = LyricsCache.objects.filter(
                title=audio_obj.title,
                artist_name=audio_obj.channel_name,
                duration=duration_rounded
            ).first()
        
        if cache_entry and not force:
            # Use cached data
            existing.synced_lyrics = cache_entry.synced_lyrics
            existing.plain_lyrics = cache_entry.plain_lyrics
            existing.is_instrumental = cache_entry.is_instrumental
            existing.language = cache_entry.language
            existing.source = cache_entry.source
            existing.fetch_attempted = True
            existing.save()
            
            # Update cache stats
            cache_entry.access_count += 1
            cache_entry.save()
            
            logger.info(f"Using cached lyrics for {audio_obj.title}")
            return existing
        
        # Fetch from API - try multiple strategies
        result = None
        search_attempts = [
            # Strategy 1: Cleaned title + cleaned artist
            (clean_track, clean_artist),
            # Strategy 2: Cleaned title + channel name (in case cleaning changed artist)
            (clean_track, audio_obj.channel_name),
            # Strategy 3: Original title (might work for some edge cases)
            (audio_obj.title, audio_obj.channel_name),
        ]
        
        # Remove duplicates while preserving order
        seen = set()
        unique_attempts = []
        for attempt in search_attempts:
            key = (attempt[0].lower(), attempt[1].lower())
            if key not in seen:
                seen.add(key)
                unique_attempts.append(attempt)
        
        try:
            for track_title, artist_name in unique_attempts:
                logger.info(f"Trying lyrics search: track='{track_title}', artist='{artist_name}'")
                
                result = self.fetch_lyrics(
                    title=track_title,
                    artist_name=artist_name,
                    album_name="",  # YouTube doesn't provide album info
                    duration=duration_rounded,
                    use_cache=True
                )
                
                # If we found lyrics, stop searching
                if result and not result.get('not_found') and (result.get('synced_lyrics') or result.get('plain_lyrics')):
                    logger.info(f"Found lyrics with: track='{track_title}', artist='{artist_name}'")
                    break
            
            # Update lyrics entry
            existing.synced_lyrics = result.get('synced_lyrics', '') if result else ''
            existing.plain_lyrics = result.get('plain_lyrics', '') if result else ''
            existing.is_instrumental = result.get('instrumental', False) if result else False
            existing.language = result.get('language', '') if result else ''
            existing.source = 'lrclib'
            existing.fetch_attempted = True
            existing.fetch_attempts += 1
            existing.last_error = result.get('error', '') if result else ''
            existing.save()
            
            # Store in cache with cleaned title
            if result and not result.get('not_found'):
                LyricsCache.objects.update_or_create(
                    title=clean_track,
                    artist_name=clean_artist,
                    album_name="",
                    duration=duration_rounded,
                    defaults={
                        'synced_lyrics': result.get('synced_lyrics', ''),
                        'plain_lyrics': result.get('plain_lyrics', ''),
                        'is_instrumental': result.get('instrumental', False),
                        'language': result.get('language', ''),
                        'source': 'lrclib',
                        'not_found': result.get('not_found', False),
                    }
                )
            
            logger.info(f"Fetched lyrics for {audio_obj.title}")
            return existing
            
        except Exception as e:
            logger.error(f"Error fetching lyrics for {audio_obj.title}: {e}")
            existing.fetch_attempted = True
            existing.fetch_attempts += 1
            existing.last_error = str(e)
            existing.save()
            return existing
