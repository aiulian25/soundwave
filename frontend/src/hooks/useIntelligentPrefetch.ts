/**
 * Hook for intelligent audio prefetching
 * Automatically prefetches upcoming tracks based on queue and play patterns
 */

import { useEffect, useRef, useCallback } from 'react';
import { audioCache } from '../utils/audioCache';
import { Audio } from '../types';

interface UseIntelligentPrefetchOptions {
  enabled: boolean;
  queue: Audio[];
  currentIndex: number;
  currentAudio: Audio | null;
  isPlaying: boolean;
  shuffleEnabled?: boolean;
}

export function useIntelligentPrefetch({
  enabled,
  queue,
  currentIndex,
  currentAudio,
  isPlaying,
  shuffleEnabled = false,
}: UseIntelligentPrefetchOptions) {
  const lastPrefetchIndex = useRef<number>(-1);
  const playStartTime = useRef<number>(0);
  const listenedSeconds = useRef<number>(0);

  // Initialize cache on mount
  useEffect(() => {
    if (enabled) {
      audioCache.init().catch(console.error);
    }
  }, [enabled]);

  // Track listening time
  useEffect(() => {
    if (isPlaying && currentAudio) {
      playStartTime.current = Date.now();
    } else if (!isPlaying && playStartTime.current > 0) {
      const elapsed = (Date.now() - playStartTime.current) / 1000;
      listenedSeconds.current += elapsed;
      playStartTime.current = 0;
    }
  }, [isPlaying, currentAudio]);

  // Record play analytics when track changes
  useEffect(() => {
    return () => {
      // Cleanup - record analytics for the previous track
      if (currentAudio && currentAudio.youtube_id && listenedSeconds.current > 0) {
        const duration = currentAudio.duration || 0;
        const completed = duration > 0 && listenedSeconds.current >= duration * 0.8;
        audioCache.recordPlay(currentAudio.youtube_id, completed, listenedSeconds.current);
        listenedSeconds.current = 0;
      }
    };
  }, [currentAudio?.youtube_id]);

  // Prefetch upcoming tracks when queue position changes
  useEffect(() => {
    if (!enabled || queue.length === 0 || currentIndex === lastPrefetchIndex.current) {
      return;
    }

    lastPrefetchIndex.current = currentIndex;
    
    // Delay prefetch slightly to not interfere with current track loading
    const timeoutId = setTimeout(() => {
      console.log('[Prefetch] Prefetching upcoming tracks from index:', currentIndex);
      audioCache.prefetchUpcoming(queue, currentIndex, shuffleEnabled);
    }, 2000);

    return () => clearTimeout(timeoutId);
  }, [enabled, queue, currentIndex, shuffleEnabled]);

  // Get cached URL for a track
  const getCachedUrl = useCallback(async (youtubeId: string): Promise<string | null> => {
    if (!enabled) return null;
    return audioCache.getCachedUrl(youtubeId);
  }, [enabled]);

  // Check if a track is cached
  const isCached = useCallback(async (youtubeId: string): Promise<boolean> => {
    if (!enabled) return false;
    return audioCache.isCached(youtubeId);
  }, [enabled]);

  // Manually trigger prefetch for a specific track
  const prefetchTrack = useCallback(async (audio: Audio): Promise<void> => {
    if (!enabled) return;
    return audioCache.prefetchTrack(audio, 'high');
  }, [enabled]);

  // Get cache statistics
  const getCacheStats = useCallback(async () => {
    return audioCache.getCacheStats();
  }, []);

  // Clear cache
  const clearCache = useCallback(async () => {
    return audioCache.clearCache();
  }, []);

  return {
    getCachedUrl,
    isCached,
    prefetchTrack,
    getCacheStats,
    clearCache,
  };
}
