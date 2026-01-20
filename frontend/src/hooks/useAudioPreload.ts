import { useEffect, useRef } from 'react';

interface UseAudioPreloadOptions {
  enabled: boolean;
  youtubeId?: string;
  mediaUrl?: string;
}

/**
 * Hook to preload the next track for seamless transitions
 */
export function useAudioPreload({ enabled, youtubeId, mediaUrl }: UseAudioPreloadOptions) {
  const preloadRef = useRef<HTMLAudioElement | null>(null);
  const preloadedUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      // Cleanup if disabled
      if (preloadRef.current) {
        preloadRef.current.pause();
        preloadRef.current.src = '';
        preloadRef.current = null;
        preloadedUrlRef.current = null;
      }
      return;
    }

    const preloadTrack = async () => {
      // If we have a direct media URL, preload it
      if (mediaUrl) {
        if (preloadedUrlRef.current !== mediaUrl) {
          preloadRef.current = new Audio();
          preloadRef.current.src = mediaUrl;
          preloadRef.current.preload = 'auto';
          preloadedUrlRef.current = mediaUrl;
          
          // Start loading but don't play
          preloadRef.current.load();
        }
        return;
      }

      // For YouTube URLs, fetch the stream URL
      if (youtubeId && preloadedUrlRef.current !== youtubeId) {
        try {
          const response = await fetch(`/api/audio/${youtubeId}/player/`, {
            headers: {
              'Authorization': `Token ${localStorage.getItem('token')}`,
            },
          });
          const data = await response.json();
          
          if (data.stream_url) {
            preloadRef.current = new Audio();
            preloadRef.current.src = data.stream_url;
            preloadRef.current.preload = 'auto';
            preloadedUrlRef.current = youtubeId;
            
            // Start loading but don't play
            preloadRef.current.load();
          }
        } catch (error) {
          console.error('Failed to preload next track:', error);
        }
      }
    };

    // Delay preloading to not interfere with current playback
    const timeoutId = setTimeout(preloadTrack, 1000);

    return () => {
      clearTimeout(timeoutId);
      // Don't cleanup the preloaded audio on unmount, keep it for next track
    };
  }, [enabled, youtubeId, mediaUrl]);

  return {
    preloadedUrl: preloadedUrlRef.current,
    cleanup: () => {
      if (preloadRef.current) {
        preloadRef.current.pause();
        preloadRef.current.src = '';
        preloadRef.current = null;
        preloadedUrlRef.current = null;
      }
    },
  };
}
