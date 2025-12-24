"""Last.fm API client for fetching music metadata and artwork"""
import pylast
import requests
import logging
from typing import Optional, Dict, Any, List
from django.conf import settings

logger = logging.getLogger(__name__)


class LastFMClient:
    """Client for Last.fm API"""
    
    # Register for API keys at: https://www.last.fm/api/account/create
    API_KEY = getattr(settings, 'LASTFM_API_KEY', '')
    API_SECRET = getattr(settings, 'LASTFM_API_SECRET', '')
    
    def __init__(self, api_key: str = None, api_secret: str = None):
        self.api_key = api_key or self.API_KEY
        self.api_secret = api_secret or self.API_SECRET
        
        if self.api_key and self.api_secret:
            self.network = pylast.LastFMNetwork(
                api_key=self.api_key,
                api_secret=self.api_secret
            )
        else:
            self.network = None
            logger.warning("Last.fm API credentials not configured")
    
    def search_track(self, artist: str, title: str) -> Optional[Dict[str, Any]]:
        """
        Search for track information
        
        Args:
            artist: Artist name
            title: Track title
            
        Returns:
            Dictionary with track information
        """
        if not self.network:
            return None
        
        try:
            track = self.network.get_track(artist, title)
            
            # Get track info
            info = {
                'title': track.get_title(),
                'artist': track.get_artist().get_name(),
                'url': track.get_url(),
                'duration': track.get_duration() / 1000 if track.get_duration() else 0,  # Convert ms to seconds
                'listeners': track.get_listener_count() or 0,
                'playcount': track.get_playcount() or 0,
                'tags': [tag.item.get_name() for tag in track.get_top_tags(limit=10)],
            }
            
            # Try to get album info
            try:
                album = track.get_album()
                if album:
                    info['album'] = album.get_title()
                    info['album_url'] = album.get_url()
                    info['album_cover'] = album.get_cover_image()
            except:
                pass
            
            # Try to get MusicBrainz ID
            try:
                mbid = track.get_mbid()
                if mbid:
                    info['mbid'] = mbid
            except:
                pass
            
            # Get cover images
            try:
                images = self._get_track_images(artist, title)
                if images:
                    info['images'] = images
            except:
                pass
            
            return info
            
        except pylast.WSError as e:
            logger.warning(f"Last.fm track not found: {artist} - {title}: {e}")
            return None
        except Exception as e:
            logger.error(f"Error fetching track from Last.fm: {e}")
            return None
    
    def get_artist_info(self, artist_name: str) -> Optional[Dict[str, Any]]:
        """
        Get artist information
        
        Args:
            artist_name: Artist name
            
        Returns:
            Dictionary with artist information
        """
        if not self.network:
            return None
        
        try:
            artist = self.network.get_artist(artist_name)
            
            info = {
                'name': artist.get_name(),
                'url': artist.get_url(),
                'listeners': artist.get_listener_count() or 0,
                'playcount': artist.get_playcount() or 0,
                'bio': artist.get_bio_content(),
                'bio_summary': artist.get_bio_summary(),
                'tags': [tag.item.get_name() for tag in artist.get_top_tags(limit=10)],
            }
            
            # Try to get MusicBrainz ID
            try:
                mbid = artist.get_mbid()
                if mbid:
                    info['mbid'] = mbid
            except:
                pass
            
            # Get similar artists
            try:
                similar = artist.get_similar(limit=10)
                info['similar_artists'] = [
                    {
                        'name': s.item.get_name(),
                        'url': s.item.get_url(),
                        'match': s.match
                    }
                    for s in similar
                ]
            except:
                info['similar_artists'] = []
            
            # Get images
            try:
                images = self._get_artist_images(artist_name)
                if images:
                    info['images'] = images
            except:
                pass
            
            return info
            
        except pylast.WSError as e:
            logger.warning(f"Last.fm artist not found: {artist_name}: {e}")
            return None
        except Exception as e:
            logger.error(f"Error fetching artist from Last.fm: {e}")
            return None
    
    def get_album_info(self, artist: str, album: str) -> Optional[Dict[str, Any]]:
        """
        Get album information
        
        Args:
            artist: Artist name
            album: Album name
            
        Returns:
            Dictionary with album information
        """
        if not self.network:
            return None
        
        try:
            album_obj = self.network.get_album(artist, album)
            
            info = {
                'title': album_obj.get_title(),
                'artist': album_obj.get_artist().get_name(),
                'url': album_obj.get_url(),
                'playcount': album_obj.get_playcount() or 0,
                'listeners': album_obj.get_listener_count() or 0,
                'tags': [tag.item.get_name() for tag in album_obj.get_top_tags(limit=10)],
            }
            
            # Try to get MusicBrainz ID
            try:
                mbid = album_obj.get_mbid()
                if mbid:
                    info['mbid'] = mbid
            except:
                pass
            
            # Get cover images
            try:
                cover = album_obj.get_cover_image()
                if cover:
                    info['cover_url'] = cover
                    info['images'] = self._get_album_images_sizes(cover)
            except:
                pass
            
            return info
            
        except pylast.WSError as e:
            logger.warning(f"Last.fm album not found: {artist} - {album}: {e}")
            return None
        except Exception as e:
            logger.error(f"Error fetching album from Last.fm: {e}")
            return None
    
    def _get_track_images(self, artist: str, title: str) -> List[Dict[str, str]]:
        """Get track/album images in different sizes"""
        try:
            track = self.network.get_track(artist, title)
            album = track.get_album()
            if album:
                cover_url = album.get_cover_image()
                if cover_url:
                    return self._get_album_images_sizes(cover_url)
        except:
            pass
        return []
    
    def _get_artist_images(self, artist_name: str) -> List[Dict[str, str]]:
        """Get artist images in different sizes"""
        if not self.api_key:
            return []
        
        try:
            # Use direct API call for more control
            url = 'http://ws.audioscrobbler.com/2.0/'
            params = {
                'method': 'artist.getinfo',
                'artist': artist_name,
                'api_key': self.api_key,
                'format': 'json'
            }
            
            response = requests.get(url, params=params, timeout=10)
            data = response.json()
            
            if 'artist' in data and 'image' in data['artist']:
                images = []
                for img in data['artist']['image']:
                    if img['#text']:
                        images.append({
                            'size': img['size'],
                            'url': img['#text']
                        })
                return images
        except Exception as e:
            logger.error(f"Error fetching artist images: {e}")
        
        return []
    
    def _get_album_images_sizes(self, cover_url: str) -> List[Dict[str, str]]:
        """Convert single cover URL to different sizes"""
        # Last.fm image URLs follow a pattern
        images = []
        sizes = ['small', 'medium', 'large', 'extralarge', 'mega']
        
        for size in sizes:
            # Replace size in URL
            url = cover_url.replace('/300x300/', f'/{size}/')
            images.append({
                'size': size,
                'url': url
            })
        
        return images
    
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
