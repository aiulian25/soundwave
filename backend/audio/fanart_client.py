"""Fanart.tv API client for fetching artist and album artwork"""
import requests
import logging
from typing import Optional, Dict, Any, List
from django.conf import settings

logger = logging.getLogger(__name__)


class FanartClient:
    """Client for Fanart.tv API"""
    
    # Register for API key at: https://fanart.tv/get-an-api-key/
    API_KEY = getattr(settings, 'FANART_API_KEY', '')
    BASE_URL = 'http://webservice.fanart.tv/v3'
    
    def __init__(self, api_key: str = None):
        self.api_key = api_key or self.API_KEY
        if not self.api_key:
            logger.warning("Fanart.tv API key not configured")
    
    def get_artist_images(self, musicbrainz_id: str) -> Optional[Dict[str, Any]]:
        """
        Get artist images by MusicBrainz ID
        
        Args:
            musicbrainz_id: MusicBrainz artist ID
            
        Returns:
            Dictionary with artist images organized by type
        """
        if not self.api_key:
            return None
        
        try:
            url = f"{self.BASE_URL}/music/{musicbrainz_id}"
            params = {'api_key': self.api_key}
            
            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            data = response.json()
            
            # Organize images by type
            images = {
                'backgrounds': [],
                'thumbnails': [],
                'logos': [],
                'logos_hd': [],
                'banners': [],
                'album_covers': []
            }
            
            # Artist backgrounds
            if 'artistbackground' in data:
                for img in data['artistbackground']:
                    images['backgrounds'].append({
                        'id': img['id'],
                        'url': img['url'],
                        'likes': img.get('likes', '0')
                    })
            
            # Artist thumbnails
            if 'artistthumb' in data:
                for img in data['artistthumb']:
                    images['thumbnails'].append({
                        'id': img['id'],
                        'url': img['url'],
                        'likes': img.get('likes', '0')
                    })
            
            # Music logos
            if 'musiclogo' in data:
                for img in data['musiclogo']:
                    images['logos'].append({
                        'id': img['id'],
                        'url': img['url'],
                        'likes': img.get('likes', '0')
                    })
            
            # HD Music logos
            if 'hdmusiclogo' in data:
                for img in data['hdmusiclogo']:
                    images['logos_hd'].append({
                        'id': img['id'],
                        'url': img['url'],
                        'likes': img.get('likes', '0')
                    })
            
            # Music banners
            if 'musicbanner' in data:
                for img in data['musicbanner']:
                    images['banners'].append({
                        'id': img['id'],
                        'url': img['url'],
                        'likes': img.get('likes', '0')
                    })
            
            # Album covers
            if 'albums' in data:
                for album_id, album_data in data['albums'].items():
                    if 'albumcover' in album_data:
                        for img in album_data['albumcover']:
                            images['album_covers'].append({
                                'id': img['id'],
                                'url': img['url'],
                                'album_id': album_id,
                                'likes': img.get('likes', '0')
                            })
            
            # Sort by likes (descending)
            for category in images:
                images[category].sort(key=lambda x: int(x['likes']), reverse=True)
            
            return images
            
        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 404:
                logger.warning(f"Fanart.tv artist not found: {musicbrainz_id}")
            else:
                logger.error(f"HTTP error fetching artist from Fanart.tv: {e}")
            return None
        except Exception as e:
            logger.error(f"Error fetching artist from Fanart.tv: {e}")
            return None
    
    def get_album_images(self, musicbrainz_release_id: str) -> Optional[Dict[str, Any]]:
        """
        Get album images by MusicBrainz release ID
        
        Args:
            musicbrainz_release_id: MusicBrainz release ID
            
        Returns:
            Dictionary with album images
        """
        if not self.api_key:
            return None
        
        try:
            url = f"{self.BASE_URL}/music/albums/{musicbrainz_release_id}"
            params = {'api_key': self.api_key}
            
            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            data = response.json()
            
            images = {
                'covers': [],
                'discs': []
            }
            
            # Album covers
            if 'albums' in data:
                for album_id, album_data in data['albums'].items():
                    if 'albumcover' in album_data:
                        for img in album_data['albumcover']:
                            images['covers'].append({
                                'id': img['id'],
                                'url': img['url'],
                                'likes': img.get('likes', '0')
                            })
                    
                    # CD art
                    if 'cdart' in album_data:
                        for img in album_data['cdart']:
                            images['discs'].append({
                                'id': img['id'],
                                'url': img['url'],
                                'disc': img.get('disc', '1'),
                                'likes': img.get('likes', '0')
                            })
            
            # Sort by likes
            images['covers'].sort(key=lambda x: int(x['likes']), reverse=True)
            images['discs'].sort(key=lambda x: int(x['likes']), reverse=True)
            
            return images
            
        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 404:
                logger.warning(f"Fanart.tv album not found: {musicbrainz_release_id}")
            else:
                logger.error(f"HTTP error fetching album from Fanart.tv: {e}")
            return None
        except Exception as e:
            logger.error(f"Error fetching album from Fanart.tv: {e}")
            return None
    
    def get_best_artist_image(self, musicbrainz_id: str, image_type: str = 'thumbnail') -> Optional[str]:
        """
        Get best (most liked) artist image of specific type
        
        Args:
            musicbrainz_id: MusicBrainz artist ID
            image_type: Type of image ('thumbnail', 'background', 'logo', 'logo_hd', 'banner')
            
        Returns:
            URL of the best image or None
        """
        images = self.get_artist_images(musicbrainz_id)
        if not images:
            return None
        
        # Map to correct key
        type_map = {
            'thumbnail': 'thumbnails',
            'background': 'backgrounds',
            'logo': 'logos',
            'logo_hd': 'logos_hd',
            'banner': 'banners'
        }
        
        key = type_map.get(image_type, image_type)
        if key in images and images[key]:
            return images[key][0]['url']  # First item is most liked
        
        return None
    
    def get_best_album_cover(self, musicbrainz_release_id: str) -> Optional[str]:
        """
        Get best (most liked) album cover
        
        Args:
            musicbrainz_release_id: MusicBrainz release ID
            
        Returns:
            URL of the best cover or None
        """
        images = self.get_album_images(musicbrainz_release_id)
        if not images or not images.get('covers'):
            return None
        
        return images['covers'][0]['url']  # First item is most liked
    
    def download_image(self, url: str, output_path: str) -> bool:
        """
        Download image from URL
        
        Args:
            url: Image URL
            output_path: Local path to save image
            
        Returns:
            True if successful, False otherwise
        """
        try:
            response = requests.get(url, timeout=30, stream=True)
            response.raise_for_status()
            
            with open(output_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            
            logger.info(f"Downloaded image to {output_path}")
            return True
            
        except Exception as e:
            logger.error(f"Error downloading image from {url}: {e}")
            return False
    
    def search_by_artist_name(self, artist_name: str) -> Optional[str]:
        """
        Search for MusicBrainz ID by artist name
        Note: Fanart.tv doesn't have a search endpoint, so this uses MusicBrainz API
        
        Args:
            artist_name: Artist name to search for
            
        Returns:
            MusicBrainz artist ID or None
        """
        try:
            # Use MusicBrainz API for search
            url = 'https://musicbrainz.org/ws/2/artist/'
            params = {
                'query': f'artist:{artist_name}',
                'fmt': 'json',
                'limit': 1
            }
            headers = {
                'User-Agent': 'SoundWave/1.0 (https://github.com/tubearchivist/tubearchivist)'
            }
            
            response = requests.get(url, params=params, headers=headers, timeout=10)
            response.raise_for_status()
            data = response.json()
            
            if data.get('artists') and len(data['artists']) > 0:
                return data['artists'][0]['id']
            
        except Exception as e:
            logger.error(f"Error searching for artist on MusicBrainz: {e}")
        
        return None
