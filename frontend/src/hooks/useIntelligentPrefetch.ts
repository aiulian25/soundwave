/**
 * Hook for intelligent audio prefetching
 * Automatically prefetches upcoming tracks based on queue position and network quality.
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
  shuffleEnabled = false,
}: UseIntelligentPrefetchOptions) {
  const lastPrefetchIndex = useRef<number>(-1);

  // Initialize the cache coordinator (builds the SW cache index) on mount.
  useEffect(() => {
    if (enabled) {
      audioCache.init().catch(console.error);
    }
  }, [enabled]);

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

  // Manually trigger prefetch for a specific track
  const prefetchTrack = useCallback(async (audio: Audio): Promise<void> => {
    if (!enabled) return;
    return audioCache.prefetchTrack(audio, 'high');
  }, [enabled]);

  // Cache statistics (evictable casual stream cache)
  const getCacheStats = useCallback(async () => {
    return audioCache.getCacheStats();
  }, []);

  // Clear the casual stream cache
  const clearCache = useCallback(async () => {
    return audioCache.clearCache();
  }, []);

  return {
    prefetchTrack,
    getCacheStats,
    clearCache,
  };
}
