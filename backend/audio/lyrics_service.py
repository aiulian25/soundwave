"""Lyrics fetching service using LRCLIB API"""
import requests
import logging
from typing import Optional, Dict, Any
from datetime import timedelta
from django.utils import timezone
from django.core.cache import cache

logger = logging.getLogger(__name__)


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
        # Build request parameters
        params = {
            'track_name': title,
            'artist_name': artist_name,
            'album_name': album_name,
            'duration': round(duration) if duration else 0,
        }
        
        # Make request
        api_endpoint = f"{self.instance_url}/api/get"
        
        try:
            response = self.session.get(
                api_endpoint,
                params=params,
                timeout=self.TIMEOUT
            )
            
            if response.status_code == 404:
                # No lyrics found
                return {
                    'synced_lyrics': '',
                    'plain_lyrics': '',
                    'instrumental': False,
                    'language': '',
                    'not_found': True,
                }
            
            response.raise_for_status()
            data = response.json()
            
            # Extract lyrics data
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
            
        except requests.exceptions.Timeout:
            logger.error(f"LRCLIB API timeout for {title} - {artist_name}")
            raise LyricsAPIError("Request timeout")
        
        except requests.exceptions.RequestException as e:
            logger.error(f"LRCLIB API error for {title} - {artist_name}: {e}")
            raise LyricsAPIError(f"API request failed: {e}")
    
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
        
        # Check database cache first
        duration_rounded = round(audio_obj.duration)
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
        
        # Fetch from API
        try:
            result = self.fetch_lyrics(
                title=audio_obj.title,
                artist_name=audio_obj.channel_name,
                album_name="",  # YouTube doesn't provide album info
                duration=duration_rounded,
                use_cache=True
            )
            
            # Update lyrics entry
            existing.synced_lyrics = result.get('synced_lyrics', '')
            existing.plain_lyrics = result.get('plain_lyrics', '')
            existing.is_instrumental = result.get('instrumental', False)
            existing.language = result.get('language', '')
            existing.source = 'lrclib'
            existing.fetch_attempted = True
            existing.fetch_attempts += 1
            existing.last_error = result.get('error', '')
            existing.save()
            
            # Store in cache
            if not result.get('not_found'):
                LyricsCache.objects.update_or_create(
                    title=audio_obj.title,
                    artist_name=audio_obj.channel_name,
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
