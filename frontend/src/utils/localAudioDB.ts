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

// Imports made before libraries were per account. Nobody knows whose they are, so they stay
// here until someone explicitly claims them.
const LEGACY_DB_NAME = 'SoundWaveLocalAudio';
const STORE_NAME = 'audioFiles';
const DB_VERSION = 1;

/** The legacy database if it exists; aborting the upgrade avoids creating an empty one. */
function openLegacyDB(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    const request = indexedDB.open(LEGACY_DB_NAME);
    request.onupgradeneeded = () => request.transaction?.abort();
    request.onerror = () => resolve(null);
    request.onsuccess = () => resolve(request.result);
  });
}

async function readLegacyFiles(): Promise<LocalAudioFile[]> {
  const legacyDB = await openLegacyDB();
  if (!legacyDB) return [];
  if (!legacyDB.objectStoreNames.contains(STORE_NAME)) {
    legacyDB.close();
    return [];
  }

  const request = legacyDB.transaction([STORE_NAME], 'readonly').objectStore(STORE_NAME).getAll();
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      legacyDB.close();
      resolve(request.result);
    };
    request.onerror = () => {
      legacyDB.close();
      reject(request.error);
    };
  });
}

export async function countUnclaimedFiles(): Promise<number> {
  return (await readLegacyFiles()).length;
}

function deleteLegacyDB(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(LEGACY_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export class LocalAudioDB {
  private db: IDBDatabase | null = null;
  private readonly dbName: string;

  constructor(accountId: number) {
    this.dbName = `${LEGACY_DB_NAME}-account-${accountId}`;
  }

  /** Copied before the legacy database is deleted, so a failure cannot lose the only copy. */
  async claimUnclaimedFiles(): Promise<void> {
    await this.addFiles(await readLegacyFiles());
    await deleteLegacyDB();
  }

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, DB_VERSION);

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
