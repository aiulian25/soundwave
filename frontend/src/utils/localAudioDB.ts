/**
 * IndexedDB wrapper for storing local audio file references
 */

export interface LocalAudioFile {
  id: string;
  title: string;
  artist: string;
  album: string;
  year: number | null;
  genre: string;
  duration: number;
  fileHandle?: FileSystemFileHandle; // For File System Access API
  file?: File; // Fallback for browsers without File System Access
  fileName: string;
  fileSize: number;
  mimeType: string;
  coverArt?: string; // Base64 encoded cover art
  addedDate: Date;
  lastPlayed?: Date;
  playCount: number;
}

const DB_NAME = 'SoundWaveLocalAudio';
const STORE_NAME = 'audioFiles';
const DB_VERSION = 1;

class LocalAudioDB {
  private db: IDBDatabase | null = null;

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
        
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('title', 'title', { unique: false });
          store.createIndex('artist', 'artist', { unique: false });
          store.createIndex('album', 'album', { unique: false });
          store.createIndex('addedDate', 'addedDate', { unique: false });
        }
      };
    });
  }

  async addFiles(files: LocalAudioFile[]): Promise<void> {
    if (!this.db) await this.init();

    const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    for (const file of files) {
      store.put(file);
    }

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async getAll(): Promise<LocalAudioFile[]> {
    if (!this.db) await this.init();

    const transaction = this.db!.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getById(id: string): Promise<LocalAudioFile | undefined> {
    if (!this.db) await this.init();

    const transaction = this.db!.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async delete(id: string): Promise<void> {
    if (!this.db) await this.init();

    const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.delete(id);

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async updatePlayCount(id: string): Promise<void> {
    const file = await this.getById(id);
    if (file) {
      file.playCount = (file.playCount || 0) + 1;
      file.lastPlayed = new Date();
      await this.addFiles([file]);
    }
  }

  async clear(): Promise<void> {
    if (!this.db) await this.init();

    const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.clear();

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }
}

export const localAudioDB = new LocalAudioDB();
