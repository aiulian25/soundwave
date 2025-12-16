# Quick Start: Offline Playlist Features

## 🎯 For Users

### Download a Playlist for Offline Use (PWA UI)

When you're online, you can download any playlist to use offline:

1. **Open a playlist** in the Soundwave app
2. Click the **"Download for Offline"** button (⬇️)
3. Wait for download to complete
4. The playlist will now work **even without internet**

### Use Offline Playlists

- Downloaded playlists appear with an **offline badge** (📶)
- Audio plays directly from cache (no buffering!)
- Metadata loads instantly from IndexedDB

### Remove Offline Playlist

1. Open the downloaded playlist
2. Click **"Remove Offline Data"** (🗑️)
3. Frees up storage space

## 💻 For Developers

### Check if Playlist is Cached

```typescript
import { offlineStorage } from '../utils/offlineStorage';

const playlist = await offlineStorage.getPlaylist(playlistId);
if (playlist && playlist.offline) {
  console.log('Playlist available offline!');
}
```

### Cache a Playlist

```typescript
import { usePWA } from '../context/PWAContext';
import { offlineStorage } from '../utils/offlineStorage';

function DownloadButton({ playlist }) {
  const { cachePlaylist, isOnline } = usePWA();

  const handleDownload = async () => {
    if (!isOnline) {
      alert('Must be online to download');
      return;
    }

    // Get all audio URLs from playlist
    const audioUrls = playlist.items.map(item => item.audio_url);
    
    // Cache in Service Worker
    const cached = await cachePlaylist(playlist.id, audioUrls);
    
    if (cached) {
      // Save metadata to IndexedDB
      await offlineStorage.savePlaylist({
        id: playlist.id,
        title: playlist.title,
        description: playlist.description,
        items: playlist.items,
        offline: true,
        lastSync: Date.now(),
      });
      
      alert('Playlist downloaded for offline use!');
    }
  };

  return (
    <button onClick={handleDownload}>
      Download Offline
    </button>
  );
}
```

### Get All Offline Playlists

```typescript
const offlinePlaylists = await offlineStorage.getOfflinePlaylists();
console.log(`You have ${offlinePlaylists.length} playlists available offline`);
```

### Remove Cached Playlist

```typescript
import { usePWA } from '../context/PWAContext';
import { offlineStorage } from '../utils/offlineStorage';

async function removeOffline(playlist) {
  const { removePlaylistCache } = usePWA();
  
  const audioUrls = playlist.items.map(item => item.audio_url);
  
  // Remove from Service Worker cache
  await removePlaylistCache(playlist.id, audioUrls);
  
  // Remove from IndexedDB
  await offlineStorage.removePlaylist(playlist.id);
}
```

### Check Storage Usage

```typescript
const { cacheSize } = usePWA();

if (cacheSize) {
  const usedMB = (cacheSize.usage / 1024 / 1024).toFixed(2);
  const quotaMB = (cacheSize.quota / 1024 / 1024).toFixed(2);
  const percent = ((cacheSize.usage / cacheSize.quota) * 100).toFixed(1);
  
  console.log(`Storage: ${usedMB} MB / ${quotaMB} MB (${percent}%)`);
}
```

## 🔄 Sync Strategy

### When Online
- User downloads playlist → cached in Service Worker + IndexedDB
- Audio files stored in browser cache
- Metadata stored in IndexedDB

### When Offline
- Service Worker serves cached audio files
- IndexedDB provides playlist metadata
- No network requests needed

### When Back Online
- Check for playlist updates
- Sync any pending changes
- Update cache if needed

## 🎨 UI Integration Example

```typescript
import { usePWA } from '../context/PWAContext';
import { offlineStorage } from '../utils/offlineStorage';
import { useState, useEffect } from 'react';

function PlaylistCard({ playlist }) {
  const { cachePlaylist, removePlaylistCache, isOnline } = usePWA();
  const [isOffline, setIsOffline] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    // Check if cached
    offlineStorage.getPlaylist(playlist.id).then(cached => {
      setIsOffline(cached?.offline || false);
    });
  }, [playlist.id]);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const audioUrls = playlist.items.map(i => i.audio_url);
      await cachePlaylist(playlist.id, audioUrls);
      await offlineStorage.savePlaylist({
        ...playlist,
        offline: true,
        lastSync: Date.now(),
      });
      setIsOffline(true);
    } catch (error) {
      console.error('Download failed:', error);
    } finally {
      setDownloading(false);
    }
  };

  const handleRemove = async () => {
    try {
      const audioUrls = playlist.items.map(i => i.audio_url);
      await removePlaylistCache(playlist.id, audioUrls);
      await offlineStorage.removePlaylist(playlist.id);
      setIsOffline(false);
    } catch (error) {
      console.error('Remove failed:', error);
    }
  };

  return (
    <div className="playlist-card">
      <h3>{playlist.title}</h3>
      {isOffline && <span className="badge">📶 Offline</span>}
      
      {!isOffline ? (
        <button 
          onClick={handleDownload}
          disabled={!isOnline || downloading}
        >
          {downloading ? 'Downloading...' : 'Download Offline'}
        </button>
      ) : (
        <button onClick={handleRemove}>
          Remove Offline Data
        </button>
      )}
    </div>
  );
}
```

## 📱 PWA Context API

All available PWA functions:

```typescript
const {
  isOnline,              // Boolean: network status
  canInstall,            // Boolean: can show install prompt
  isInstalled,           // Boolean: is installed as PWA
  isUpdateAvailable,     // Boolean: new version available
  cacheSize,             // { usage, quota }: storage info
  
  showInstallPrompt,     // () => Promise<boolean>
  updateApp,             // () => Promise<void>
  clearCache,            // () => Promise<boolean>
  cacheAudio,            // (url) => Promise<boolean>
  cachePlaylist,         // (id, urls) => Promise<boolean>
  removePlaylistCache,   // (id, urls) => Promise<boolean>
  requestNotifications,  // () => Promise<NotificationPermission>
} = usePWA();
```

## 🗄️ IndexedDB Storage API

All available storage functions:

```typescript
// Playlists
await offlineStorage.savePlaylist(playlist);
await offlineStorage.getPlaylist(id);
await offlineStorage.getPlaylists();
await offlineStorage.getOfflinePlaylists();
await offlineStorage.removePlaylist(id);
await offlineStorage.updatePlaylistSyncStatus(id, 'synced');

// Audio Queue
await offlineStorage.saveAudioQueue(queue);
await offlineStorage.getAudioQueue();

// Favorites
await offlineStorage.addFavorite(item);
await offlineStorage.removeFavorite(id);
await offlineStorage.getFavorites();

// Settings
await offlineStorage.saveSetting('key', value);
await offlineStorage.getSetting('key');

// Cleanup
await offlineStorage.clearAllData();
```

## 🧪 Testing Offline Functionality

### Browser DevTools

1. **Open DevTools** → Application tab
2. **Service Workers** → Check registration status
3. **Cache Storage** → Verify cached audio files
4. **IndexedDB** → Check `soundwave-offline` database

### Simulate Offline

1. DevTools → Network tab
2. Change throttling to **"Offline"**
3. Try playing a downloaded playlist
4. Should work without any network requests!

### Clear Everything

```typescript
// Clear Service Worker caches
await clearCache();

// Clear IndexedDB
await offlineStorage.clearAllData();

// Unregister Service Worker
navigator.serviceWorker.getRegistrations().then(regs => {
  regs.forEach(reg => reg.unregister());
});
```

## ⚡ Performance Tips

1. **Batch Downloads**
   - Download multiple playlists during idle time
   - Use background sync when available

2. **Smart Caching**
   - Only cache frequently accessed playlists
   - Remove old cached content periodically

3. **Monitor Storage**
   - Check `cacheSize` regularly
   - Warn user when approaching quota

4. **Progressive Enhancement**
   - App works without offline features
   - Enhanced experience when cached

## 🔐 Security Notes

- Cached data is user-specific (token-based)
- Offline playlists only accessible by owner
- Cache is browser-specific (not shared)
- Service Worker respects CORS policies

## 📊 Storage Estimates

Typical sizes:
- Audio file: 3-5 MB (compressed)
- Playlist metadata: 50-100 KB
- API responses: 10-50 KB

Example playlist (20 songs):
- Audio files: ~80 MB
- Metadata: ~2 MB
- Total: ~82 MB

Browser quota (typical):
- Desktop: 2-10 GB
- Mobile: 500 MB - 2 GB
