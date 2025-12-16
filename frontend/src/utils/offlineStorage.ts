/**
 * Offline storage manager using IndexedDB for complex data
 */

const DB_NAME = 'soundwave-offline';
const DB_VERSION = 1;
const STORES = {
  AUDIO_QUEUE: 'audioQueue',
  FAVORITES: 'favorites',
  PLAYLISTS: 'playlists',
  SETTINGS: 'settings',
  PENDING_UPLOADS: 'pendingUploads',
};

class OfflineStorageManager {
  private db: IDBDatabase | null = null;

  /**
   * Initialize IndexedDB
   */
  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create object stores
        if (!db.objectStoreNames.contains(STORES.AUDIO_QUEUE)) {
          db.createObjectStore(STORES.AUDIO_QUEUE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORES.FAVORITES)) {
          const favStore = db.createObjectStore(STORES.FAVORITES, { keyPath: 'id' });
          favStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.PLAYLISTS)) {
          db.createObjectStore(STORES.PLAYLISTS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORES.SETTINGS)) {
          db.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORES.PENDING_UPLOADS)) {
          const uploadStore = db.createObjectStore(STORES.PENDING_UPLOADS, {
            keyPath: 'id',
            autoIncrement: true,
          });
          uploadStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }

  /**
   * Get data from store
   */
  async get(storeName: string, key: string | number): Promise<any> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all data from store
   */
  async getAll(storeName: string): Promise<any[]> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Put data into store
   */
  async put(storeName: string, data: any): Promise<void> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put(data);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete data from store
   */
  async delete(storeName: string, key: string | number): Promise<void> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Clear all data from store
   */
  async clear(storeName: string): Promise<void> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // Convenience methods for specific stores

  async saveAudioQueue(queue: any[]): Promise<void> {
    await this.clear(STORES.AUDIO_QUEUE);
    for (const item of queue) {
      await this.put(STORES.AUDIO_QUEUE, item);
    }
  }

  async getAudioQueue(): Promise<any[]> {
    return await this.getAll(STORES.AUDIO_QUEUE);
  }

  async addFavorite(item: any): Promise<void> {
    await this.put(STORES.FAVORITES, {
      ...item,
      timestamp: Date.now(),
    });
  }

  async removeFavorite(id: string | number): Promise<void> {
    await this.delete(STORES.FAVORITES, id);
  }

  async getFavorites(): Promise<any[]> {
    return await this.getAll(STORES.FAVORITES);
  }

  async addPendingUpload(upload: any): Promise<void> {
    await this.put(STORES.PENDING_UPLOADS, {
      ...upload,
      timestamp: Date.now(),
    });
  }

  async getPendingUploads(): Promise<any[]> {
    return await this.getAll(STORES.PENDING_UPLOADS);
  }

  async removePendingUpload(id: number): Promise<void> {
    await this.delete(STORES.PENDING_UPLOADS, id);
  }

  async saveSetting(key: string, value: any): Promise<void> {
    await this.put(STORES.SETTINGS, { key, value });
  }

  async getSetting(key: string): Promise<any> {
    const result = await this.get(STORES.SETTINGS, key);
    return result?.value;
  }

  /**
   * Playlist-specific methods for offline access
   */
  async savePlaylist(playlist: any): Promise<void> {
    await this.put(STORES.PLAYLISTS, {
      ...playlist,
      offline: true,
      lastSync: Date.now(),
    });
  }

  async getPlaylist(id: string | number): Promise<any> {
    return await this.get(STORES.PLAYLISTS, id);
  }

  async getPlaylists(): Promise<any[]> {
    return await this.getAll(STORES.PLAYLISTS);
  }

  async getOfflinePlaylists(): Promise<any[]> {
    const playlists = await this.getAll(STORES.PLAYLISTS);
    return playlists.filter(p => p.offline);
  }

  async removePlaylist(id: string | number): Promise<void> {
    await this.delete(STORES.PLAYLISTS, id);
  }

  async updatePlaylistSyncStatus(id: string | number, status: string): Promise<void> {
    const playlist = await this.getPlaylist(id);
    if (playlist) {
      playlist.syncStatus = status;
      playlist.lastSync = Date.now();
      await this.put(STORES.PLAYLISTS, playlist);
    }
  }

  /**
   * Clear all offline data (useful for logout)
   */
  async clearAllData(): Promise<void> {
    await this.clear(STORES.AUDIO_QUEUE);
    await this.clear(STORES.FAVORITES);
    await this.clear(STORES.PLAYLISTS);
    await this.clear(STORES.PENDING_UPLOADS);
    // Keep settings
  }
}

// Export singleton instance
export const offlineStorage = new OfflineStorageManager();

// Initialize on load
offlineStorage.init().catch((error) => {
  console.error('Failed to initialize offline storage:', error);
});
