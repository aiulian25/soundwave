/**
 * Audio caching coordinator.
 *
 * Source of truth for offline audio is the **Service Worker Cache Storage** (see
 * public/service-worker.js), not IndexedDB:
 *   - STREAM_CACHE (evictable) — casual + prefetched /media/ streams.
 *   - AUDIO_CACHE  (pinned)    — "Make available offline" /download/ tracks.
 *
 * This module no longer stores audio Blobs in IndexedDB; it warms the SW caches and
 * answers offline-availability + stats questions against them. The legacy IndexedDB
 * blob store is deleted on init.
 */

import { Audio } from '../types';
import { getNetworkInfo, shouldPrefetch, getPrefetchCount, apiBackoffs } from './networkQuality';

// Legacy IndexedDB database (audio blobs) — deleted on init; kept here only so we can
// drop it from users upgrading from the IndexedDB-backed cache.
const LEGACY_DB_NAME = 'soundwave-audio-cache';

// MUST match the cache names in public/service-worker.js — the SW owns these Cache
// Storage buckets; reading the wrong name made the offline-cache index always empty.
const SW_AUDIO_CACHE_NAME = 'soundwave-audio-v3'; // PINNED downloads
const SW_STREAM_CACHE_NAME = 'soundwave-stream-v1'; // EVICTABLE casual + prefetched streams

// Cache configuration (surfaced to the settings UI).
const CACHE_CONFIG = {
  maxCacheSize: 500 * 1024 * 1024, // 500MB — mirrors the SW STREAM_CACHE byte budget
  // Cap concurrent prefetches so we never warm several large streams at once.
  maxConcurrentPrefetch: 1,
};

class AudioCacheManager {
  private prefetchQueue: Set<string> = new Set();
  private prefetchingInProgress: Set<string> = new Set();
  private initialized = false;
  // Service Worker pinned-download cache index (populated on init).
  private swCachedTrackIds: Set<string> = new Set();

  /**
   * Initialise: build the SW cache index and drop the legacy IndexedDB blob store.
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    await this.buildServiceWorkerCacheIndex();
    this.deleteLegacyDatabase();
    console.log('[AudioCache] Initialized (Service Worker cache as source of truth)');
  }

  /** Remove the obsolete IndexedDB audio-blob database from prior versions. */
  private deleteLegacyDatabase(): void {
    try {
      if (typeof indexedDB !== 'undefined') {
        indexedDB.deleteDatabase(LEGACY_DB_NAME);
      }
    } catch {
      // Best-effort cleanup; ignore failures.
    }
  }

  /**
   * Build in-memory index of Service Worker pinned-download tracks (by youtube_id).
   */
  private async buildServiceWorkerCacheIndex(): Promise<void> {
    try {
      if (!('caches' in window)) return;

      const cache = await caches.open(SW_AUDIO_CACHE_NAME);
      const keys = await cache.keys();

      this.swCachedTrackIds = new Set(
        keys
          .map((req) => {
            const match = req.url.match(/\/api\/audio\/([^/]+)\/download\//);
            return match ? match[1] : null;
          })
          .filter((id): id is string => id !== null),
      );

      console.log(`[AudioCache] SW index built: ${this.swCachedTrackIds.size} pinned track(s)`);
    } catch (error) {
      console.error('[AudioCache] Failed to build SW cache index:', error);
    }
  }

  /**
   * Fast synchronous check whether a track is likely available offline (pinned index).
   */
  isLikelyCached(youtubeId: string): boolean {
    return this.swCachedTrackIds.has(youtubeId);
  }

  /**
   * Build the same /media/ URL the Player streams for a track with a known file_path.
   * Returns null when the track has no file_path (must resolve via the /player/ API).
   */
  private buildDirectUrl(audio: Audio): string | null {
    if (!audio.file_path) return null;
    const encodedPath = audio.file_path.split('/').map((part) => encodeURIComponent(part)).join('/');
    return `/media/${encodedPath}`;
  }

  /** Whether a casual/prefetched stream URL is already in the SW STREAM_CACHE. */
  private async isStreamCached(url: string): Promise<boolean> {
    try {
      if (!('caches' in window)) return false;
      const cache = await caches.open(SW_STREAM_CACHE_NAME);
      return !!(await cache.match(url));
    } catch {
      return false;
    }
  }

  /**
   * Post a message to the active Service Worker and await its reply (via MessageChannel).
   * Resolves false if there is no controller or the SW doesn't answer in time.
   */
  private postToServiceWorker(message: unknown, timeoutMs = 30000): Promise<boolean> {
    return new Promise((resolve) => {
      const controller = navigator.serviceWorker?.controller;
      if (!controller) {
        resolve(false);
        return;
      }
      const channel = new MessageChannel();
      const timer = setTimeout(() => resolve(false), timeoutMs);
      channel.port1.onmessage = (event) => {
        clearTimeout(timer);
        resolve(!!(event.data && event.data.success));
      };
      controller.postMessage(message, [channel.port2]);
    });
  }

  /**
   * Prefetch a track in the background by warming the Service Worker STREAM_CACHE.
   * Network-aware: respects connection quality and save-data mode. No audio bytes pass
   * through the JS heap — the SW fetches and caches the stream itself.
   */
  async prefetchTrack(audio: Audio, priority: 'high' | 'normal' | 'low' = 'normal'): Promise<void> {
    const youtubeId = audio.youtube_id;

    // Skip local files (no youtube_id)
    if (!youtubeId) return;

    // Network quality check - skip prefetching on slow connections (unless high priority)
    if (priority !== 'high' && !shouldPrefetch()) {
      const networkInfo = getNetworkInfo();
      console.log(`[AudioCache] Skipping prefetch due to network: ${networkInfo.quality}, saveData: ${networkInfo.isSaveData}`);
      return;
    }

    // Check backoff state for prefetch failures
    if (!apiBackoffs.prefetch.shouldAttempt()) {
      console.log(`[AudioCache] Skipping prefetch due to backoff (failures: ${apiBackoffs.prefetch.getFailureCount()})`);
      return;
    }

    // Skip if being prefetched, or if too many are already in flight.
    if (this.prefetchingInProgress.has(youtubeId)) return;
    if (this.prefetchingInProgress.size >= CACHE_CONFIG.maxConcurrentPrefetch) return;

    // Already durably available (pinned) — nothing to prefetch.
    if (await this.isAvailableOffline(youtubeId)) return;

    this.prefetchingInProgress.add(youtubeId);
    const networkInfo = getNetworkInfo();
    console.log(`[AudioCache] Prefetching (${priority}, network: ${networkInfo.quality}): ${audio.title}`);

    try {
      // Resolve the exact URL the Player will stream: the direct /media/ URL when we know
      // the file_path, otherwise the /player/ API's stream_url.
      let streamUrl = this.buildDirectUrl(audio);
      if (!streamUrl) {
        const response = await fetch(`/api/audio/${youtubeId}/player/`, { credentials: 'include' });
        if (!response.ok) {
          apiBackoffs.prefetch.recordFailure();
          throw new Error('Failed to get stream URL');
        }
        const data = await response.json();
        streamUrl = data.stream_url;
        if (!streamUrl) throw new Error('No stream URL returned');
      }

      // Already cached as a casual stream? Done.
      if (await this.isStreamCached(streamUrl)) {
        apiBackoffs.prefetch.recordSuccess();
        return;
      }

      // Have the SW fetch + cache the stream into the evictable STREAM_CACHE.
      const ok = await this.postToServiceWorker({ type: 'PREFETCH_STREAM', url: streamUrl });
      if (ok) {
        apiBackoffs.prefetch.recordSuccess();
      } else {
        apiBackoffs.prefetch.recordFailure();
      }
    } catch (error) {
      console.error(`[AudioCache] Failed to prefetch ${audio.title}:`, error);
    } finally {
      this.prefetchingInProgress.delete(youtubeId);
      this.prefetchQueue.delete(youtubeId);
    }
  }

  /**
   * Intelligent prefetch based on queue position and network quality.
   */
  async prefetchUpcoming(queue: Audio[], currentIndex: number, shuffleEnabled: boolean = false): Promise<void> {
    if (queue.length === 0) return;

    // Get network-aware prefetch count
    const networkPrefetchCount = getPrefetchCount();
    const networkInfo = getNetworkInfo();

    // Skip all prefetching on poor connections or save-data mode
    if (networkPrefetchCount === 0) {
      console.log(`[AudioCache] Skipping prefetch - poor network (${networkInfo.quality}) or save-data enabled`);
      return;
    }

    console.log(`[AudioCache] Prefetching ${networkPrefetchCount} tracks (network: ${networkInfo.quality})`);

    const tracksToPrefetch: Audio[] = [];

    // Prefetch next N tracks based on network quality
    for (let i = 1; i <= networkPrefetchCount; i++) {
      const nextIndex = currentIndex + i;
      if (nextIndex < queue.length) {
        tracksToPrefetch.push(queue[nextIndex]);
      }
    }

    // Only add random tracks on good+ connections (not on moderate/poor)
    if (shuffleEnabled && queue.length > 5 && networkInfo.quality === 'excellent') {
      const randomIndices = new Set<number>();
      while (randomIndices.size < Math.min(1, queue.length - currentIndex - 1)) {
        const randomIndex = Math.floor(Math.random() * queue.length);
        if (randomIndex !== currentIndex && !tracksToPrefetch.find((t) => t.id === queue[randomIndex].id)) {
          randomIndices.add(randomIndex);
        }
      }
      randomIndices.forEach((idx) => tracksToPrefetch.push(queue[idx]));
    }

    // Always prefetch one track at a time. Higher-quality networks just prefetch more.
    const fastNetwork = networkInfo.quality === 'excellent' || networkInfo.quality === 'good';
    for (let i = 0; i < tracksToPrefetch.length; i++) {
      const priority = fastNetwork ? (i === 0 ? 'high' : i < 2 ? 'normal' : 'low') : 'high';
      await this.prefetchTrack(tracksToPrefetch[i], priority);
    }
  }

  /**
   * Cache statistics for the (evictable) casual stream cache — what the settings UI shows
   * and the "clear cache" button manages. Pinned downloads are managed per-playlist.
   */
  async getCacheStats(): Promise<{ count: number; totalSize: number }> {
    let count = 0;
    let totalSize = 0;
    try {
      if ('caches' in window) {
        const cache = await caches.open(SW_STREAM_CACHE_NAME);
        const keys = await cache.keys();
        count = keys.length;
        for (const req of keys) {
          const res = await cache.match(req);
          totalSize += res ? Number(res.headers.get('content-length')) || 0 : 0;
        }
      }
    } catch (error) {
      console.error('[AudioCache] Failed to read cache stats:', error);
    }
    return { count, totalSize };
  }

  /**
   * Clear the casual stream cache (does not touch pinned "available offline" downloads).
   */
  async clearCache(): Promise<void> {
    try {
      if ('caches' in window) {
        await caches.delete(SW_STREAM_CACHE_NAME);
        console.log('[AudioCache] Stream cache cleared');
      }
    } catch (error) {
      console.error('[AudioCache] Failed to clear stream cache:', error);
    }
  }

  /**
   * Whether a track is durably available offline.
   *
   * Single source of truth: the Service Worker **download** cache (tracks the user
   * explicitly "Made available offline" — pinned, never evicted). Casual/prefetched
   * streams in STREAM_CACHE are deliberately NOT counted — they are LRU-evictable, so a
   * merely-prefetched track must not report as durably "available offline".
   */
  async isAvailableOffline(youtubeId: string): Promise<boolean> {
    if (this.swCachedTrackIds.has(youtubeId)) {
      return true;
    }
    try {
      if ('caches' in window) {
        const cache = await caches.open(SW_AUDIO_CACHE_NAME);
        const response = await cache.match(`/api/audio/${youtubeId}/download/`);
        if (response) {
          this.swCachedTrackIds.add(youtubeId);
          return true;
        }
      }
    } catch {
      // Ignore errors — treat as not-offline.
    }
    return false;
  }

  /**
   * Refresh the Service Worker cache index (call after caching a playlist offline).
   */
  async refreshServiceWorkerIndex(): Promise<void> {
    await this.buildServiceWorkerCacheIndex();
  }

  /**
   * Add a track ID to the Service Worker cache index (when known to be freshly pinned).
   */
  addToServiceWorkerIndex(youtubeId: string): void {
    this.swCachedTrackIds.add(youtubeId);
  }
}

// Singleton instance
export const audioCache = new AudioCacheManager();

// Export configuration for settings UI
export const AUDIO_CACHE_CONFIG = CACHE_CONFIG;
