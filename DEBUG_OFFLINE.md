# 🐛 Debugging Offline Playlist Caching

## Issue
User clicks "Make Available Offline" but playlists aren't being cached for offline playback.

## Investigation Steps

### 1. Check Service Worker Registration
Open browser DevTools → Console and run:
```javascript
navigator.serviceWorker.getRegistration().then(reg => console.log('SW Registered:', reg))
```

Expected: ServiceWorkerRegistration object
If null: Service worker isn't registered

### 2. Check if Service Worker is Active
```javascript
navigator.serviceWorker.ready.then(reg => console.log('SW Active:', reg.active))
```

Expected: ServiceWorker object with state 'activated'

### 3. Test Message Passing
Open a playlist page and run in console:
```javascript
const testCache = async () => {
  const reg = await navigator.serviceWorker.ready;
  const messageChannel = new MessageChannel();
  
  messageChannel.port1.onmessage = (event) => {
    console.log('Response from SW:', event.data);
  };
  
  reg.active.postMessage(
    { 
      type: 'CACHE_PLAYLIST', 
      playlistId: 'test123',
      audioUrls: ['/api/audio/test/download/']
    },
    [messageChannel.port2]
  );
};

testCache();
```

Expected: Console log showing response from service worker

### 4. Check Network Requests
When clicking "Make Available Offline":
1. Open DevTools → Network tab
2. Filter by "audio"
3. Click the button
4. Check if audio download requests are made

Expected: Multiple requests to `/api/audio/{id}/download/`

### 5. Check Service Worker Console
1. Open DevTools → Application tab
2. Click "Service Workers"
3. Click "inspect" next to the active service worker
4. New DevTools window opens showing SW console
5. Try caching again and watch for logs

Expected logs:
- `[Service Worker] Message received: {type: 'CACHE_PLAYLIST', ...}`
- `[Service Worker] Caching playlist: ...`
- `[Service Worker] Cached audio: ...`

### 6. Check Cache Storage
After attempting to cache:
1. DevTools → Application → Cache Storage
2. Look for `soundwave-audio-v1` cache
3. Expand it to see cached files

Expected: Audio files should be listed

### 7. Check IndexedDB
1. DevTools → Application → IndexedDB
2. Look for `SoundwaveOfflineDB`
3. Check `playlists` object store

Expected: Playlist with `offline: true`

## Common Issues

### Issue 1: Service Worker Not Registered
**Symptom**: `navigator.serviceWorker.getRegistration()` returns null

**Fix**: Check if running on HTTPS or localhost. Service workers require secure context.

### Issue 2: CORS / Authentication Issues
**Symptom**: Network requests fail with 401/403

**Fix**: Ensure audio download endpoints properly handle authentication.
Check service worker creates authenticated requests:
```javascript
const authRequest = new Request(url, {
  credentials: 'include',
  headers: { 'Accept': 'audio/*' }
});
```

### Issue 3: Message Channel Not Working
**Symptom**: No response from service worker

**Fix**: Ensure service worker message handler properly uses `event.ports[0].postMessage()`

### Issue 4: Service Worker Scope Issues
**Symptom**: Fetch events not intercepting

**Fix**: Check service worker registered with scope: `'/'`

## Quick Test Script

Run this in browser console on a playlist page:

```javascript
const debugOfflineCache = async () => {
  console.log('=== Offline Cache Debug ===');
  
  // 1. Check SW
  const reg = await navigator.serviceWorker.getRegistration();
  console.log('1. SW Registered:', !!reg);
  console.log('   SW Active:', reg?.active?.state);
  
  // 2. Check if online
  console.log('2. Online:', navigator.onLine);
  
  // 3. Check IndexedDB
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('SoundwaveOfflineDB');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  console.log('3. IndexedDB:', db.name, 'version:', db.version);
  
  // 4. Check cache storage
  const cacheNames = await caches.keys();
  console.log('4. Caches:', cacheNames);
  
  for (const name of cacheNames) {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    console.log(`   ${name}:`, keys.length, 'entries');
  }
  
  // 5. Test cache size
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    const estimate = await navigator.storage.estimate();
    const usage = (estimate.usage / 1024 / 1024).toFixed(2);
    const quota = (estimate.quota / 1024 / 1024).toFixed(2);
    console.log('5. Storage: ', usage, 'MB /', quota, 'MB');
  }
  
  console.log('=== Debug Complete ===');
};

debugOfflineCache();
```

## Next Steps

Based on debug output, identify which component is failing:
- Service Worker registration
- Message passing
- Network requests
- Cache storage
- IndexedDB storage
