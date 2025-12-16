"""YouTube metadata extraction using yt-dlp"""

import yt_dlp
from typing import Dict, Optional


def get_playlist_metadata(playlist_id: str) -> Optional[Dict]:
    """
    Fetch playlist metadata from YouTube
    
    Args:
        playlist_id: YouTube playlist ID
        
    Returns:
        Dictionary with playlist metadata or None if failed
    """
    url = f"https://www.youtube.com/playlist?list={playlist_id}"
    
    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
        'extract_flat': True,
        'playlist_items': '1',  # Only fetch first item to get playlist info
    }
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            
            if not info:
                return None
            
            # Extract thumbnail (try multiple qualities)
            thumbnail = None
            if info.get('thumbnails'):
                # Get highest quality thumbnail
                thumbnail = info['thumbnails'][-1].get('url')
            
            return {
                'title': info.get('title', f'Playlist {playlist_id[:8]}'),
                'description': info.get('description', ''),
                'channel_name': info.get('uploader', info.get('channel', '')),
                'channel_id': info.get('uploader_id', info.get('channel_id', '')),
                'thumbnail_url': thumbnail or '',
                'item_count': info.get('playlist_count', 0),
            }
    except Exception as e:
        print(f"Failed to fetch playlist metadata for {playlist_id}: {e}")
        return None


def get_channel_metadata(channel_id: str) -> Optional[Dict]:
    """
    Fetch channel metadata from YouTube
    
    Args:
        channel_id: YouTube channel ID or handle
        
    Returns:
        Dictionary with channel metadata or None if failed
    """
    # Build URL based on channel_id format
    if channel_id.startswith('UC') and len(channel_id) == 24:
        url = f"https://www.youtube.com/channel/{channel_id}"
    elif channel_id.startswith('@'):
        url = f"https://www.youtube.com/{channel_id}"
    else:
        # Assume it's a username or custom URL
        url = f"https://www.youtube.com/@{channel_id}"
    
    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
        'extract_flat': True,
        'playlist_items': '0',  # Don't extract videos
    }
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            
            if not info:
                return None
            
            # Get actual channel ID if we used a handle
            actual_channel_id = info.get('channel_id', channel_id)
            
            # Extract thumbnails
            thumbnail = None
            if info.get('thumbnails'):
                thumbnail = info['thumbnails'][-1].get('url')
            
            return {
                'channel_id': actual_channel_id,
                'channel_name': info.get('channel', info.get('uploader', f'Channel {channel_id[:8]}')),
                'channel_description': info.get('description', ''),
                'channel_thumbnail': thumbnail or '',
                'subscriber_count': info.get('channel_follower_count', 0),
                'video_count': info.get('playlist_count', 0),
            }
    except Exception as e:
        print(f"Failed to fetch channel metadata for {channel_id}: {e}")
        return None
