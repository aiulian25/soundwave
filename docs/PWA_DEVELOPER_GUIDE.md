# PWA Developer Quick Reference

## Using PWA Features in Components

### 1. Access PWA State

```typescript
import { usePWA } from '../context/PWAContext';

function MyComponent() {
  const {
    isOnline,        // boolean - network status
    canInstall,      // boolean - can show install prompt
    isInstalled,     // boolean - app is installed
    isUpdateAvailable, // boolean - update available
    cacheSize,       // { usage: number, quota: number } | null
    showInstallPrompt, // () => Promise<boolean>
    updateApp,       // () => Promise<void>
    clearCache,      // () => Promise<boolean>
    cacheAudio,      // (url: string) => Promise<boolean>
    requestNotifications, // () => Promise<NotificationPermission>
  } = usePWA();

  // Use PWA state
  return (
    <div>
      {!isOnline && <OfflineWarning />}
      {canInstall && <InstallButton onClick={showInstallPrompt} />}
    </div>
  );
}
```

### 2. Show Install Prompt

```typescript
import { usePWA } from '../context/PWAContext';

function InstallButton() {
  const { canInstall, showInstallPrompt } = usePWA();

  const handleInstall = async () => {
    const installed = await showInstallPrompt();
    if (installed) {
      console.log('App installed!');
    }
  };

  if (!canInstall) return null;

  return <Button onClick={handleInstall}>Install App</Button>;
}
```

### 3. Handle Offline State

```typescript
import { usePWA } from '../context/PWAContext';

function MyComponent() {
  const { isOnline } = usePWA();

  return (
    <div>
      {!isOnline && (
        <Alert severity="warning">
          You're offline. Some features may be limited.
        </Alert>
      )}
      {/* Component content */}
    </div>
  );
}
```

### 4. Cache Audio for Offline

```typescript
import { usePWA } from '../context/PWAContext';

function AudioItem({ audio }) {
  const { cacheAudio } = usePWA();
  const [cached, setCached] = useState(false);

  const handleCache = async () => {
    const success = await cacheAudio(audio.file_url);
    if (success) {
      setCached(true);
      showNotification('Audio cached for offline playback');
    }
  };

  return (
    <div>
      <span>{audio.title}</span>
      <Button onClick={handleCache} disabled={cached}>
        {cached ? 'Cached' : 'Download for Offline'}
      </Button>
    </div>
  );
}
```

### 5. Request Notifications

```typescript
import { usePWA } from '../context/PWAContext';

function NotificationSettings() {
  const { requestNotifications } = usePWA();

  const handleEnable = async () => {
    const permission = await requestNotifications();
    if (permission === 'granted') {
      console.log('Notifications enabled');
    }
  };

  return <Button onClick={handleEnable}>Enable Notifications</Button>;
}
```

### 6. Show App Update

```typescript
import { usePWA } from '../context/PWAContext';

function UpdateBanner() {
  const { isUpdateAvailable, updateApp } = usePWA();

  if (!isUpdateAvailable) return null;

  return (
    <Alert
      severity="info"
      action={
        <Button onClick={updateApp} color="inherit">
          Update Now
        </Button>
      }
    >
      New version available!
    </Alert>
  );
}
```

## Media Session API Usage

### Set Media Metadata

```typescript
import { setMediaMetadata } from '../utils/mediaSession';

setMediaMetadata({
  title: 'Song Title',
  artist: 'Artist Name',
  album: 'Album Name',
  artwork: [
    { src: '/cover-96.jpg', sizes: '96x96', type: 'image/jpeg' },
    { src: '/cover-512.jpg', sizes: '512x512', type: 'image/jpeg' },
  ],
});
```

### Set Action Handlers

```typescript
import { setMediaActionHandlers } from '../utils/mediaSession';

setMediaActionHandlers({
  play: () => audioElement.play(),
  pause: () => audioElement.pause(),
  previoustrack: () => playPrevious(),
  nexttrack: () => playNext(),
  seekbackward: () => seek(-10),
  seekforward: () => seek(10),
  seekto: (details) => audioElement.currentTime = details.seekTime,
});
```

### Update Playback State

```typescript
import { setPlaybackState, setPositionState } from '../utils/mediaSession';

// When playing/paused
setPlaybackState('playing'); // or 'paused' or 'none'

// Update position (for seek bar)
setPositionState({
  duration: audio.duration,
  playbackRate: 1.0,
  position: audioElement.currentTime,
});
```

## Offline Storage Usage

### Save/Get Data

```typescript
import { offlineStorage } from '../utils/offlineStorage';

// Save audio queue
await offlineStorage.saveAudioQueue(queue);

// Get audio queue
const queue = await offlineStorage.getAudioQueue();

// Add favorite
await offlineStorage.addFavorite({
  id: audio.id,
  title: audio.title,
  // ... other data
});

// Get favorites
const favorites = await offlineStorage.getFavorites();

// Save setting
await offlineStorage.saveSetting('theme', 'dark');

// Get setting
const theme = await offlineStorage.getSetting('theme');
```

### Pending Uploads

```typescript
import { offlineStorage } from '../utils/offlineStorage';

// Add pending upload (when offline)
await offlineStorage.addPendingUpload({
  file: fileData,
  metadata: { title: 'Song' },
});

// Get pending uploads (to sync when online)
const pending = await offlineStorage.getPendingUploads();

// Remove after sync
await offlineStorage.removePendingUpload(uploadId);
```

## Service Worker Communication

### Cache Specific URL

```typescript
import { cacheAudio } from '../utils/pwa';

const url = 'https://example.com/audio/song.mp3';
const success = await cacheAudio(url);
if (success) {
  console.log('Audio cached!');
}
```

### Clear All Caches

```typescript
import { clearCache } from '../utils/pwa';

const success = await clearCache();
if (success) {
  console.log('Cache cleared!');
}
```

## PWA Utilities

### Check Installation Status

```typescript
import { isInstalled, canInstall } from '../utils/pwa';

if (isInstalled()) {
  console.log('App is installed');
}

if (canInstall()) {
  console.log('Can show install prompt');
}
```

### Check Online Status

```typescript
import { isOnline } from '../utils/pwa';

if (isOnline()) {
  // Fetch from network
} else {
  // Use cached data
}
```

### Get Cache Size

```typescript
import { getCacheSize } from '../utils/pwa';

const size = await getCacheSize();
if (size) {
  console.log(`Using ${size.usage} of ${size.quota} bytes`);
  const percent = (size.usage / size.quota) * 100;
  console.log(`${percent.toFixed(1)}% of storage used`);
}
```

## Best Practices

### 1. Always Handle Offline State

```typescript
function DataComponent() {
  const { isOnline } = usePWA();
  const [data, setData] = useState(null);

  useEffect(() => {
    if (isOnline) {
      // Fetch from API
      fetchData().then(setData);
    } else {
      // Load from offline storage
      offlineStorage.get('dataStore', 'key').then(setData);
    }
  }, [isOnline]);

  return <div>{/* Render data */}</div>;
}
```

### 2. Show Loading States

```typescript
function MyComponent() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData().finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <CircularProgress />;
  }

  return <div>{/* Content */}</div>;
}
```

### 3. Provide Offline Feedback

```typescript
function UploadButton({ file }) {
  const { isOnline } = usePWA();

  const handleUpload = async () => {
    if (!isOnline) {
      // Queue for later
      await offlineStorage.addPendingUpload(file);
      alert('Upload queued. Will sync when online.');
      return;
    }

    // Upload immediately
    await uploadFile(file);
  };

  return (
    <Button onClick={handleUpload}>
      Upload {!isOnline && '(Offline - Will Queue)'}
    </Button>
  );
}
```

### 4. Cache Important Assets

```typescript
function AudioPlayer({ audio }) {
  const { cacheAudio } = usePWA();
  const [isCached, setIsCached] = useState(false);

  useEffect(() => {
    // Pre-cache important audio
    if (audio.is_favorite) {
      cacheAudio(audio.file_url).then(setIsCached);
    }
  }, [audio]);

  return (
    <div>
      <audio src={audio.file_url} />
      {isCached && <Chip label="Available Offline" />}
    </div>
  );
}
```

### 5. Clean Up Resources

```typescript
function MediaPlayer({ audio }) {
  useEffect(() => {
    // Set up media session
    setMediaMetadata(audio);
    setMediaActionHandlers({ /* ... */ });

    // Clean up on unmount
    return () => {
      clearMediaSession();
    };
  }, [audio]);

  return <audio />;
}
```

## Debugging

### Check Service Worker Status

```javascript
// In browser console
navigator.serviceWorker.getRegistration().then(reg => {
  console.log('Service Worker:', reg);
  console.log('Active:', reg?.active);
  console.log('Waiting:', reg?.waiting);
});
```

### List All Caches

```javascript
// In browser console
caches.keys().then(keys => {
  console.log('Cache keys:', keys);
  keys.forEach(key => {
    caches.open(key).then(cache => {
      cache.keys().then(requests => {
        console.log(`${key}:`, requests.map(r => r.url));
      });
    });
  });
});
```

### Check Offline Storage

```javascript
// In browser console
const request = indexedDB.open('soundwave-offline');
request.onsuccess = () => {
  const db = request.result;
  console.log('Object stores:', db.objectStoreNames);
};
```

### Force Service Worker Update

```javascript
// In browser console
navigator.serviceWorker.getRegistration().then(reg => {
  reg?.update().then(() => console.log('Update check complete'));
});
```

## Common Issues

### Issue: Service Worker Not Updating
**Solution**: 
```javascript
// Force skip waiting
navigator.serviceWorker.getRegistration().then(reg => {
  reg?.waiting?.postMessage({ type: 'SKIP_WAITING' });
});
```

### Issue: Install Prompt Not Showing
**Checklist**:
- ✅ Served over HTTPS
- ✅ Has valid manifest.json
- ✅ Has registered service worker
- ✅ User hasn't dismissed recently
- ✅ User hasn't already installed

### Issue: Offline Content Not Loading
**Solution**:
1. Check service worker is active
2. Verify content was visited while online
3. Check cache in DevTools > Application > Cache Storage
4. Ensure service worker fetch handler is correct

### Issue: Media Session Not Working
**Solution**:
- Safari: Limited support, some actions may not work
- Check if MediaMetadata constructor exists
- Verify action handlers are set correctly
- Test in Chrome/Edge first

## Performance Tips

### 1. Lazy Load Components

```typescript
import { lazy, Suspense } from 'react';

const HeavyComponent = lazy(() => import('./HeavyComponent'));

function App() {
  return (
    <Suspense fallback={<Loading />}>
      <HeavyComponent />
    </Suspense>
  );
}
```

### 2. Optimize Images

```typescript
// Use WebP with fallback
<picture>
  <source srcSet="image.webp" type="image/webp" />
  <img src="image.jpg" alt="..." />
</picture>
```

### 3. Preload Critical Assets

```html
<link rel="preload" href="/critical.css" as="style" />
<link rel="preload" href="/critical.js" as="script" />
```

### 4. Use Code Splitting

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          mui: ['@mui/material'],
        },
      },
    },
  },
});
```

---

**Happy PWA Development!** 🚀

For more information, see:
- [PWA_IMPLEMENTATION.md](./PWA_IMPLEMENTATION.md)
- [COMPLETE_PWA_SUMMARY.md](./COMPLETE_PWA_SUMMARY.md)
