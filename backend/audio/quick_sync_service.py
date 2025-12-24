"""Quick Sync service for adaptive streaming based on network and system resources"""
import psutil
import time
import logging
import requests
from typing import Dict, Any, Optional, Tuple
from django.core.cache import cache
from django.conf import settings

logger = logging.getLogger(__name__)


class QuickSyncService:
    """Service for adaptive streaming quality based on network and system resources"""
    
    # Quality presets
    QUALITY_PRESETS = {
        'low': {
            'bitrate': 64,  # kbps
            'buffer_size': 5,  # seconds
            'preload': 'metadata',
            'description': 'Low quality - saves bandwidth',
        },
        'medium': {
            'bitrate': 128,  # kbps
            'buffer_size': 10,  # seconds
            'preload': 'auto',
            'description': 'Medium quality - balanced',
        },
        'high': {
            'bitrate': 256,  # kbps
            'buffer_size': 15,  # seconds
            'preload': 'auto',
            'description': 'High quality - best experience',
        },
        'ultra': {
            'bitrate': 320,  # kbps
            'buffer_size': 20,  # seconds
            'preload': 'auto',
            'description': 'Ultra quality - maximum fidelity',
        },
        'auto': {
            'bitrate': 0,  # Auto-detect
            'buffer_size': 0,  # Auto-adjust
            'preload': 'auto',
            'description': 'Automatic - adapts to connection',
        },
    }
    
    # Network speed thresholds (Mbps)
    SPEED_THRESHOLDS = {
        'ultra': 5.0,   # 5 Mbps+
        'high': 2.0,    # 2-5 Mbps
        'medium': 1.0,  # 1-2 Mbps
        'low': 0.5,     # 0.5-1 Mbps
    }
    
    def __init__(self):
        self.cache_timeout = 300  # 5 minutes
    
    def get_system_resources(self) -> Dict[str, Any]:
        """
        Get current system resource usage
        
        Returns:
            Dictionary with CPU, memory, and disk usage
        """
        try:
            resources = {
                'cpu_percent': psutil.cpu_percent(interval=1),
                'memory_percent': psutil.virtual_memory().percent,
                'memory_available_mb': psutil.virtual_memory().available / (1024 * 1024),
                'disk_usage_percent': psutil.disk_usage('/').percent,
                'timestamp': time.time(),
            }
            
            # Cache the results
            cache.set('quick_sync_system_resources', resources, self.cache_timeout)
            
            return resources
        except Exception as e:
            logger.error(f"Error getting system resources: {e}")
            return {
                'cpu_percent': 50,
                'memory_percent': 50,
                'memory_available_mb': 1000,
                'disk_usage_percent': 50,
                'timestamp': time.time(),
            }
    
    def measure_network_speed(self, test_url: str = None, timeout: int = 5) -> float:
        """
        Measure network download speed
        
        Args:
            test_url: URL to download for speed test
            timeout: Request timeout in seconds
            
        Returns:
            Download speed in Mbps
        """
        # Check cache first
        cached_speed = cache.get('quick_sync_network_speed')
        if cached_speed is not None:
            return cached_speed
        
        try:
            # Use a small test file (1MB)
            if not test_url:
                # Use a reliable CDN for speed testing
                test_url = 'https://speed.cloudflare.com/__down?bytes=1000000'
            
            start_time = time.time()
            response = requests.get(test_url, timeout=timeout, stream=True)
            
            # Download 1MB
            chunk_size = 8192
            downloaded = 0
            for chunk in response.iter_content(chunk_size=chunk_size):
                downloaded += len(chunk)
                if downloaded >= 1000000:  # 1MB
                    break
            
            elapsed = time.time() - start_time
            
            # Calculate speed in Mbps
            speed_mbps = (downloaded * 8) / (elapsed * 1000000)
            
            # Cache the result
            cache.set('quick_sync_network_speed', speed_mbps, self.cache_timeout)
            
            logger.info(f"Network speed measured: {speed_mbps:.2f} Mbps")
            
            return speed_mbps
        except Exception as e:
            logger.warning(f"Error measuring network speed: {e}")
            # Return conservative estimate
            return 2.0
    
    def get_recommended_quality(self, user_preferences: Dict[str, Any] = None) -> Tuple[str, Dict[str, Any]]:
        """
        Get recommended quality based on network speed and system resources
        
        Args:
            user_preferences: User's quick sync preferences
            
        Returns:
            Tuple of (quality_level, quality_settings)
        """
        # Get user preferences
        if not user_preferences:
            user_preferences = {
                'mode': 'auto',
                'prefer_quality': True,
                'adapt_to_system': True,
            }
        
        mode = user_preferences.get('mode', 'auto')
        
        # If manual mode, return the specified quality
        if mode != 'auto':
            return mode, self.QUALITY_PRESETS[mode]
        
        # Auto mode - detect optimal quality
        network_speed = self.measure_network_speed()
        system_resources = self.get_system_resources()
        
        # Determine quality based on network speed
        if network_speed >= self.SPEED_THRESHOLDS['ultra']:
            quality = 'ultra'
        elif network_speed >= self.SPEED_THRESHOLDS['high']:
            quality = 'high'
        elif network_speed >= self.SPEED_THRESHOLDS['medium']:
            quality = 'medium'
        else:
            quality = 'low'
        
        # Adjust based on system resources if enabled
        if user_preferences.get('adapt_to_system', True):
            cpu_percent = system_resources.get('cpu_percent', 50)
            memory_percent = system_resources.get('memory_percent', 50)
            
            # Downgrade quality if system is under heavy load
            if cpu_percent > 80 or memory_percent > 85:
                if quality == 'ultra':
                    quality = 'high'
                elif quality == 'high':
                    quality = 'medium'
            
            # Upgrade if system has plenty of resources and user prefers quality
            elif cpu_percent < 30 and memory_percent < 50 and user_preferences.get('prefer_quality', False):
                if quality == 'medium' and network_speed >= self.SPEED_THRESHOLDS['high']:
                    quality = 'high'
                elif quality == 'high' and network_speed >= self.SPEED_THRESHOLDS['ultra']:
                    quality = 'ultra'
        
        settings = self.QUALITY_PRESETS[quality].copy()
        settings['auto_selected'] = True
        settings['network_speed_mbps'] = network_speed
        settings['cpu_percent'] = system_resources.get('cpu_percent')
        settings['memory_percent'] = system_resources.get('memory_percent')
        
        logger.info(f"Recommended quality: {quality} (speed: {network_speed:.2f} Mbps)")
        
        return quality, settings
    
    def get_buffer_settings(self, quality: str, network_speed: float = None) -> Dict[str, Any]:
        """
        Get optimal buffer settings for quality level
        
        Args:
            quality: Quality level
            network_speed: Current network speed in Mbps
            
        Returns:
            Buffer configuration
        """
        base_settings = self.QUALITY_PRESETS.get(quality, self.QUALITY_PRESETS['medium'])
        
        buffer_config = {
            'buffer_size': base_settings['buffer_size'],
            'preload': base_settings['preload'],
            'max_buffer_size': base_settings['buffer_size'] * 2,
            'rebuffer_threshold': base_settings['buffer_size'] * 0.3,
        }
        
        # Adjust based on network speed if provided
        if network_speed:
            if network_speed < 1.0:
                # Slow connection - increase buffer
                buffer_config['buffer_size'] = max(buffer_config['buffer_size'], 15)
                buffer_config['preload'] = 'auto'
            elif network_speed > 5.0:
                # Fast connection - can use smaller buffer
                buffer_config['buffer_size'] = min(buffer_config['buffer_size'], 10)
        
        return buffer_config
    
    def get_quick_sync_status(self, user_preferences: Dict[str, Any] = None) -> Dict[str, Any]:
        """
        Get complete quick sync status and recommendations
        
        Args:
            user_preferences: User's quick sync preferences
            
        Returns:
            Complete status including network, system, and quality info
        """
        network_speed = self.measure_network_speed()
        system_resources = self.get_system_resources()
        quality, quality_settings = self.get_recommended_quality(user_preferences)
        buffer_settings = self.get_buffer_settings(quality, network_speed)
        
        status = {
            'network': {
                'speed_mbps': network_speed,
                'status': self._get_network_status(network_speed),
            },
            'system': {
                'cpu_percent': system_resources['cpu_percent'],
                'memory_percent': system_resources['memory_percent'],
                'memory_available_mb': system_resources['memory_available_mb'],
                'status': self._get_system_status(system_resources),
            },
            'quality': {
                'level': quality,
                'bitrate': quality_settings['bitrate'],
                'description': quality_settings['description'],
                'auto_selected': quality_settings.get('auto_selected', False),
            },
            'buffer': buffer_settings,
            'timestamp': time.time(),
        }
        
        return status
    
    def _get_network_status(self, speed_mbps: float) -> str:
        """Get network status description"""
        if speed_mbps >= 5.0:
            return 'excellent'
        elif speed_mbps >= 2.0:
            return 'good'
        elif speed_mbps >= 1.0:
            return 'fair'
        else:
            return 'poor'
    
    def _get_system_status(self, resources: Dict[str, Any]) -> str:
        """Get system status description"""
        cpu = resources.get('cpu_percent', 50)
        memory = resources.get('memory_percent', 50)
        
        if cpu > 80 or memory > 85:
            return 'high_load'
        elif cpu > 50 or memory > 70:
            return 'moderate_load'
        else:
            return 'low_load'
    
    def update_user_preferences(self, user_id: int, preferences: Dict[str, Any]) -> bool:
        """
        Update user's quick sync preferences
        
        Args:
            user_id: User ID
            preferences: New preferences
            
        Returns:
            True if successful
        """
        try:
            # Validate preferences
            mode = preferences.get('mode', 'auto')
            if mode not in self.QUALITY_PRESETS:
                mode = 'auto'
            
            prefs = {
                'mode': mode,
                'prefer_quality': preferences.get('prefer_quality', True),
                'adapt_to_system': preferences.get('adapt_to_system', True),
                'auto_download_quality': preferences.get('auto_download_quality', False),
            }
            
            # Cache user preferences
            cache.set(f'quick_sync_prefs_{user_id}', prefs, timeout=None)
            
            logger.info(f"Updated quick sync preferences for user {user_id}: {prefs}")
            
            return True
        except Exception as e:
            logger.error(f"Error updating quick sync preferences: {e}")
            return False
    
    def get_user_preferences(self, user_id: int) -> Dict[str, Any]:
        """
        Get user's quick sync preferences
        
        Args:
            user_id: User ID
            
        Returns:
            User preferences or defaults
        """
        prefs = cache.get(f'quick_sync_prefs_{user_id}')
        if prefs:
            return prefs
        
        # Return defaults
        return {
            'mode': 'auto',
            'prefer_quality': True,
            'adapt_to_system': True,
            'auto_download_quality': False,
        }
