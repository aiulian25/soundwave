/**
 * Advanced Audio Caching System
 * Intelligently prefetches likely-to-be-played tracks for seamless playback
 */

import { Audio } from '../types';

const DB_NAME = 'soundwave-audio-cache';
const DB_VERSION = 2;
const STORES = {
  AUDIO_BLOBS: 'audioBlobs',
  METADATA: 'metadata',
  ANALYTICS: 'analytics',
};

// Cache configuration
const CACHE_CONFIG = {
  maxCacheSize: 500 * 1024 * 1024, // 500MB max cache
  maxCachedTracks: 50, // Maximum number of tracks to cache
  prefetchCount: 3, // Number of tracks to prefetch ahead
  staleTime: 7 * 24 * 60 * 60 * 1000, // 7 days
  cleanupInterval: 60 * 60 * 1000, // 1 hour
};

interface CachedAudio {
  id: string; // youtube_id
  blob: Blob;
  size: number;
  cachedAt: number;
  lastAccessed: number;
  accessCount: number;
  duration?: number;
}

interface CacheMetadata {
  id: string;
  youtube_id: string;
  title: string;
  artist?: string;
  duration?: number;
  cachedAt: number;
  size: number;
}

interface PlayAnalytics {
  id: string; // youtube_id
  playCount: number;
  lastPlayed: number;
  skipCount: number;
  completionRate: number;
  listeningTime: number;
}

class AudioCacheManager {
  private db: IDBDatabase | null = null;
  private prefetchQueue: Set<string> = new Set();
  private prefetchingInProgress: Set<string> = new Set();
  private cleanupScheduled = false;
  private initialized = false;
  // In-memory index for instant cache lookups (no async DB query needed)
  private cachedTrackIds: Set<string> = new Set();
  // Service Worker cache index (populated on init)
  private swCachedTrackIds: Set<string> = new Set();

  /**
   * Initialize IndexedDB for audio caching
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('[AudioCache] Failed to open database:', request.error);
        reject(request.error);
      };
      
      request.onsuccess = () => {
        this.db = request.result;
        this.initialized = true;
        this.scheduleCleanup();
        // Build in-memory index for fast lookups
        this.buildCacheIndex();
        this.buildServiceWorkerCacheIndex();
        console.log('[AudioCache] Initialized successfully');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Audio blobs store
        if (!db.objectStoreNames.contains(STORES.AUDIO_BLOBS)) {
          const blobStore = db.createObjectStore(STORES.AUDIO_BLOBS, { keyPath: 'id' });
          blobStore.createIndex('lastAccessed', 'lastAccessed', { unique: false });
          blobStore.createIndex('cachedAt', 'cachedAt', { unique: false });
        }

        // Metadata store
        if (!db.objectStoreNames.contains(STORES.METADATA)) {
          db.createObjectStore(STORES.METADATA, { keyPath: 'id' });
        }

        // Analytics store for smart prefetching
        if (!db.objectStoreNames.contains(STORES.ANALYTICS)) {
          const analyticsStore = db.createObjectStore(STORES.ANALYTICS, { keyPath: 'id' });
          analyticsStore.createIndex('playCount', 'playCount', { unique: false });
          analyticsStore.createIndex('lastPlayed', 'lastPlayed', { unique: false });
        }
      };
    });
  }

  /**
   * Build in-memory index of cached track IDs for instant lookups
   */
  private async buildCacheIndex(): Promise<void> {
    if (!this.db) return;
    
    try {
      const transaction = this.db.transaction(STORES.AUDIO_BLOBS, 'readonly');
      const store = transaction.objectStore(STORES.AUDIO_BLOBS);
      const request = store.getAllKeys();
      
      request.onsuccess = () => {
        this.cachedTrackIds = new Set(request.result as string[]);
        console.log(`[AudioCache] Index built: ${this.cachedTrackIds.size} tracks in IndexedDB cache`);
      };
    } catch (error) {
      console.error('[AudioCache] Failed to build cache index:', error);
    }
  }

  /**
   * Build in-memory index of Service Worker cached tracks
   */
  private async buildServiceWorkerCacheIndex(): Promise<void> {
    try {
      if (!('caches' in window)) return;
      
      const cache = await caches.open('soundwave-audio-v1');
      const keys = await cache.keys();
      
      this.swCachedTrackIds = new Set(
        keys
          .map(req => {
            const match = req.url.match(/\/api\/audio\/([^/]+)\/download\//);
            return match ? match[1] : null;
          })
          .filter((id): id is string => id !== null)
      );
      
      console.log(`[AudioCache] SW Index built: ${this.swCachedTrackIds.size} tracks in Service Worker cache`);
    } catch (error) {
      console.error('[AudioCache] Failed to build SW cache index:', error);
    }
  }

  /**
   * Fast synchronous check if a track is likely cached (checks in-memory index)
   * Use this for instant UI feedback, then verify with async methods if needed
   */
  isLikelyCached(youtubeId: string): boolean {
    return this.cachedTrackIds.has(youtubeId) || this.swCachedTrackIds.has(youtubeId);
  }

  /**
   * Check if a track is cached
   */
  async isCached(youtubeId: string): Promise<boolean> {
    // Fast path: check in-memory index first
    if (this.cachedTrackIds.has(youtubeId)) {
      return true;
    }
    
    if (!this.db) await this.init();
    
    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(STORES.AUDIO_BLOBS, 'readonly');
        const store = transaction.objectStore(STORES.AUDIO_BLOBS);
        const request = store.get(youtubeId);

        request.onsuccess = () => {
          const exists = !!request.result;
          if (exists) {
            this.cachedTrackIds.add(youtubeId); // Update index
          }
          resolve(exists);
        };
        request.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }

  /**
   * Get cached audio blob
   */
  async getCachedAudio(youtubeId: string): Promise<Blob | null> {
    if (!this.db) await this.init();

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(STORES.AUDIO_BLOBS, 'readwrite');
        const store = transaction.objectStore(STORES.AUDIO_BLOBS);
        const request = store.get(youtubeId);

        request.onsuccess = () => {
          const cached = request.result as CachedAudio | undefined;
          if (cached) {
            // Update access stats
            cached.lastAccessed = Date.now();
            cached.accessCount += 1;
            store.put(cached);
            resolve(cached.blob);
          } else {
            resolve(null);
          }
        };
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  /**
   * Get cached audio URL (creates object URL from blob)
   */
  async getCachedUrl(youtubeId: string): Promise<string | null> {
    const blob = await this.getCachedAudio(youtubeId);
    if (blob) {
      return URL.createObjectURL(blob);
    }
    return null;
  }

  /**
   * Cache an audio track
   */
  async cacheAudio(youtubeId: string, blob: Blob, metadata?: Partial<CacheMetadata>): Promise<boolean> {
    if (!this.db) await this.init();

    // Check if we need to free up space
    await this.ensureCacheSpace(blob.size);

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction([STORES.AUDIO_BLOBS, STORES.METADATA], 'readwrite');
        const blobStore = transaction.objectStore(STORES.AUDIO_BLOBS);
        const metaStore = transaction.objectStore(STORES.METADATA);

        const now = Date.now();
        const cachedAudio: CachedAudio = {
          id: youtubeId,
          blob,
          size: blob.size,
          cachedAt: now,
          lastAccessed: now,
          accessCount: 1,
          duration: metadata?.duration,
        };

        blobStore.put(cachedAudio);

        if (metadata) {
          const meta: CacheMetadata = {
            id: youtubeId,
            youtube_id: youtubeId,
            title: metadata.title || '',
            artist: metadata.artist,
            duration: metadata.duration,
            cachedAt: now,
            size: blob.size,
          };
          metaStore.put(meta);
        }

        transaction.oncomplete = () => {
          // Update in-memory index
          this.cachedTrackIds.add(youtubeId);
          console.log(`[AudioCache] Cached: ${youtubeId} (${(blob.size / 1024 / 1024).toFixed(2)}MB)`);
          resolve(true);
        };
        transaction.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }

  /**
   * Prefetch a track in the background
   */
  async prefetchTrack(audio: Audio, priority: 'high' | 'normal' | 'low' = 'normal'): Promise<void> {
    const youtubeId = audio.youtube_id;
    
    // Skip local files (no youtube_id)
    if (!youtubeId) return;
    
    // Fast path: check in-memory index first
    if (this.cachedTrackIds.has(youtubeId)) {
      console.log(`[AudioCache] Already cached (fast): ${audio.title}`);
      return;
    }
    
    // Skip if being prefetched
    if (this.prefetchingInProgress.has(youtubeId)) return;
    
    // Double-check with DB
    if (await this.isCached(youtubeId)) {
      console.log(`[AudioCache] Already cached: ${audio.title}`);
      return;
    }

    this.prefetchingInProgress.add(youtubeId);
    console.log(`[AudioCache] Prefetching (${priority}): ${audio.title}`);

    try {
      // Get stream URL
      const response = await fetch(`/api/audio/${youtubeId}/player/`, {
        headers: {
          'Authorization': `Token ${localStorage.getItem('token')}`,
        },
      });

      if (!response.ok) throw new Error('Failed to get stream URL');
      
      const data = await response.json();
      const streamUrl = data.stream_url;

      if (!streamUrl) throw new Error('No stream URL returned');

      // Fetch the actual audio file
      const audioResponse = await fetch(streamUrl);
      if (!audioResponse.ok) throw new Error('Failed to fetch audio');

      const blob = await audioResponse.blob();

      // Cache it
      await this.cacheAudio(youtubeId, blob, {
        title: audio.title,
        artist: audio.channel_name,
        duration: audio.duration,
      });
    } catch (error) {
      console.error(`[AudioCache] Failed to prefetch ${audio.title}:`, error);
    } finally {
      this.prefetchingInProgress.delete(youtubeId);
      this.prefetchQueue.delete(youtubeId);
    }
  }

  /**
   * Intelligent prefetch based on queue position and play patterns
   */
  async prefetchUpcoming(queue: Audio[], currentIndex: number, shuffleEnabled: boolean = false): Promise<void> {
    if (queue.length === 0) return;

    const tracksToPrefetch: Audio[] = [];
    
    // Always prefetch next N tracks in queue
    for (let i = 1; i <= CACHE_CONFIG.prefetchCount; i++) {
      const nextIndex = currentIndex + i;
      if (nextIndex < queue.length) {
        tracksToPrefetch.push(queue[nextIndex]);
      }
    }

    // If shuffle is enabled, also prefetch some random tracks from queue
    if (shuffleEnabled && queue.length > 5) {
      const randomIndices = new Set<number>();
      while (randomIndices.size < Math.min(2, queue.length - currentIndex - 1)) {
        const randomIndex = Math.floor(Math.random() * queue.length);
        if (randomIndex !== currentIndex && !tracksToPrefetch.find(t => t.id === queue[randomIndex].id)) {
          randomIndices.add(randomIndex);
        }
      }
      randomIndices.forEach(idx => tracksToPrefetch.push(queue[idx]));
    }

    // Prefetch in order of priority
    for (let i = 0; i < tracksToPrefetch.length; i++) {
      const priority = i === 0 ? 'high' : i < 3 ? 'normal' : 'low';
      // Don't await - let them prefetch in parallel
      this.prefetchTrack(tracksToPrefetch[i], priority);
    }
  }

  /**
   * Record play analytics for smarter prefetching
   */
  async recordPlay(youtubeId: string, completed: boolean, listenedSeconds: number): Promise<void> {
    if (!this.db) await this.init();

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(STORES.ANALYTICS, 'readwrite');
        const store = transaction.objectStore(STORES.ANALYTICS);
        const request = store.get(youtubeId);

        request.onsuccess = () => {
          const existing = request.result as PlayAnalytics | undefined;
          const analytics: PlayAnalytics = existing || {
            id: youtubeId,
            playCount: 0,
            lastPlayed: 0,
            skipCount: 0,
            completionRate: 0,
            listeningTime: 0,
          };

          analytics.playCount += 1;
          analytics.lastPlayed = Date.now();
          analytics.listeningTime += listenedSeconds;
          
          if (!completed) {
            analytics.skipCount += 1;
          }
          
          // Calculate completion rate
          const totalPlays = analytics.playCount;
          const completedPlays = totalPlays - analytics.skipCount;
          analytics.completionRate = completedPlays / totalPlays;

          store.put(analytics);
          resolve();
        };
        request.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  /**
   * Get frequently played tracks for proactive caching
   */
  async getFrequentlyPlayed(limit: number = 10): Promise<string[]> {
    if (!this.db) await this.init();

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(STORES.ANALYTICS, 'readonly');
        const store = transaction.objectStore(STORES.ANALYTICS);
        const index = store.index('playCount');
        const request = index.openCursor(null, 'prev');

        const results: string[] = [];
        
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor && results.length < limit) {
            const analytics = cursor.value as PlayAnalytics;
            // Only include tracks with good completion rate
            if (analytics.completionRate > 0.5) {
              results.push(analytics.id);
            }
            cursor.continue();
          } else {
            resolve(results);
          }
        };
        request.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  }

  /**
   * Ensure we have space for new cache entry
   */
  private async ensureCacheSpace(neededBytes: number): Promise<void> {
    if (!this.db) return;

    const stats = await this.getCacheStats();
    
    if (stats.totalSize + neededBytes > CACHE_CONFIG.maxCacheSize) {
      // Need to evict old entries
      const bytesToFree = stats.totalSize + neededBytes - CACHE_CONFIG.maxCacheSize + (10 * 1024 * 1024); // Free extra 10MB
      await this.evictOldest(bytesToFree);
    }

    if (stats.count >= CACHE_CONFIG.maxCachedTracks) {
      // Too many tracks, evict some
      await this.evictOldest(0, 5);
    }
  }

  /**
   * Evict oldest/least used cache entries
   */
  private async evictOldest(bytesToFree: number = 0, minToEvict: number = 0): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(STORES.AUDIO_BLOBS, 'readwrite');
        const store = transaction.objectStore(STORES.AUDIO_BLOBS);
        const index = store.index('lastAccessed');
        const request = index.openCursor();

        let freedBytes = 0;
        let evictedCount = 0;

        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            const entry = cursor.value as CachedAudio;
            
            // Check if entry is stale
            const isStale = Date.now() - entry.cachedAt > CACHE_CONFIG.staleTime;
            const shouldEvict = isStale || 
              freedBytes < bytesToFree || 
              evictedCount < minToEvict;

            if (shouldEvict) {
              console.log(`[AudioCache] Evicting: ${entry.id} (${(entry.size / 1024 / 1024).toFixed(2)}MB)`);
              cursor.delete();
              freedBytes += entry.size;
              evictedCount++;
            }

            cursor.continue();
          } else {
            console.log(`[AudioCache] Cleanup complete: evicted ${evictedCount} tracks, freed ${(freedBytes / 1024 / 1024).toFixed(2)}MB`);
            resolve();
          }
        };
        request.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{ count: number; totalSize: number; oldestEntry: number }> {
    if (!this.db) await this.init();

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(STORES.AUDIO_BLOBS, 'readonly');
        const store = transaction.objectStore(STORES.AUDIO_BLOBS);
        const request = store.getAll();

        request.onsuccess = () => {
          const entries = request.result as CachedAudio[];
          const totalSize = entries.reduce((sum, e) => sum + e.size, 0);
          const oldestEntry = entries.length > 0 
            ? Math.min(...entries.map(e => e.cachedAt))
            : Date.now();

          resolve({
            count: entries.length,
            totalSize,
            oldestEntry,
          });
        };
        request.onerror = () => resolve({ count: 0, totalSize: 0, oldestEntry: Date.now() });
      } catch {
        resolve({ count: 0, totalSize: 0, oldestEntry: Date.now() });
      }
    });
  }

  /**
   * Clear all cached audio
   */
  async clearCache(): Promise<void> {
    if (!this.db) await this.init();

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction([STORES.AUDIO_BLOBS, STORES.METADATA], 'readwrite');
        transaction.objectStore(STORES.AUDIO_BLOBS).clear();
        transaction.objectStore(STORES.METADATA).clear();
        transaction.oncomplete = () => {
          console.log('[AudioCache] Cache cleared');
          resolve();
        };
        transaction.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  /**
   * Check Service Worker cache for offline audio (used by "Cache for Offline" feature)
   * This is different from IndexedDB cache - it uses the Cache API
   */
  async getServiceWorkerCachedUrl(youtubeId: string): Promise<string | null> {
    try {
      // Check if Cache API is available
      if (!('caches' in window)) {
        console.log('[AudioCache] Cache API not available');
        return null;
      }

      // The download URL that was cached by "Make Available Offline"
      const downloadUrl = `/api/audio/${youtubeId}/download/`;
      
      // Check the audio cache
      const audioCache = await caches.open('soundwave-audio-v1');
      const cachedResponse = await audioCache.match(downloadUrl);
      
      if (cachedResponse) {
        console.log('[AudioCache] Found in Service Worker cache:', youtubeId);
        const blob = await cachedResponse.blob();
        return URL.createObjectURL(blob);
      }
      
      return null;
    } catch (error) {
      console.error('[AudioCache] Error checking Service Worker cache:', error);
      return null;
    }
  }

  /**
   * Get any cached audio URL - checks both IndexedDB and Service Worker cache
   * Priority: IndexedDB (faster) -> Service Worker Cache (offline feature)
   * Optimized with in-memory index for instant lookups
   */
  async getAnyCachedUrl(youtubeId: string): Promise<{ url: string; source: 'indexeddb' | 'serviceworker' } | null> {
    // Fast path: check in-memory indexes first to determine where to look
    const inIndexedDb = this.cachedTrackIds.has(youtubeId);
    const inServiceWorker = this.swCachedTrackIds.has(youtubeId);
    
    // If not in any index, skip expensive lookups
    if (!inIndexedDb && !inServiceWorker) {
      return null;
    }
    
    // Check IndexedDB first if likely there (fastest for blob retrieval)
    if (inIndexedDb) {
      const indexedDbUrl = await this.getCachedUrl(youtubeId);
      if (indexedDbUrl) {
        return { url: indexedDbUrl, source: 'indexeddb' };
      }
    }

    // Then check Service Worker cache
    if (inServiceWorker) {
      const swUrl = await this.getServiceWorkerCachedUrl(youtubeId);
      if (swUrl) {
        return { url: swUrl, source: 'serviceworker' };
      }
    }
    
    // Fallback: check both caches anyway (index might be stale)
    const indexedDbUrl = await this.getCachedUrl(youtubeId);
    if (indexedDbUrl) {
      this.cachedTrackIds.add(youtubeId); // Update index
      return { url: indexedDbUrl, source: 'indexeddb' };
    }

    const swUrl = await this.getServiceWorkerCachedUrl(youtubeId);
    if (swUrl) {
      this.swCachedTrackIds.add(youtubeId); // Update index
      return { url: swUrl, source: 'serviceworker' };
    }

    return null;
  }

  /**
   * Check if audio is available in any cache (IndexedDB or Service Worker)
   * Uses in-memory index for fast lookups
   */
  async isAvailableOffline(youtubeId: string): Promise<boolean> {
    // Fast path: check in-memory indexes
    if (this.cachedTrackIds.has(youtubeId) || this.swCachedTrackIds.has(youtubeId)) {
      return true;
    }
    
    // Check IndexedDB
    if (await this.isCached(youtubeId)) {
      return true;
    }

    // Check Service Worker cache
    try {
      if ('caches' in window) {
        const cache = await caches.open('soundwave-audio-v1');
        const response = await cache.match(`/api/audio/${youtubeId}/download/`);
        return !!response;
      }
    } catch {
      // Ignore errors
    }

    return false;
  }

  /**
   * Schedule periodic cleanup
   */
  private scheduleCleanup(): void {
    if (this.cleanupScheduled) return;
    this.cleanupScheduled = true;

    setInterval(async () => {
      console.log('[AudioCache] Running scheduled cleanup...');
      await this.evictOldest(0, 0); // Just clean stale entries
    }, CACHE_CONFIG.cleanupInterval);
  }

  /**
   * Refresh the Service Worker cache index
   * Call this after caching a playlist to update the in-memory index
   */
  async refreshServiceWorkerIndex(): Promise<void> {
    await this.buildServiceWorkerCacheIndex();
  }

  /**
   * Add a track ID to the Service Worker cache index
   * Call this when you know a track was just cached
   */
  addToServiceWorkerIndex(youtubeId: string): void {
    this.swCachedTrackIds.add(youtubeId);
  }
}

// Singleton instance
export const audioCache = new AudioCacheManager();

// Export configuration for settings UI
export const AUDIO_CACHE_CONFIG = CACHE_CONFIG;
