# 🔧 Offline Playlist Caching - Fix Applied

## What Was Fixed

Added comprehensive logging and timeout handling to the offline playlist caching system:

1. **Added Timeout** - 60-second timeout prevents hanging if service worker doesn't respond
2. **Better Error Handling** - Validates service worker is active before sending messages
3. **Detailed Logging** - Console logs at every step to identify where failures occur
4. **Error Messages** - Clear error messages show specific failure reasons

## How to Test

### 1. Open Browser Console
1. Open SoundWave: http://localhost:8889
2. Press `F12` or Right-click → Inspect
3. Go to **Console** tab
4. Clear console (trash icon)

### 2. Navigate to a Playlist
1. Login (username: `iulian`, password: whatever you set)
2. Go to **Playlists** page
3. Click on any playlist that has downloaded tracks
4. You should see the playlist detail page

### 3. Try Offline Caching
1. Scroll down to the **"Cache for Offline"** card
2. Click **"Make Available Offline"** button
3. **Watch the Console** for logs:

**Expected Console Logs:**
```
[Offline] handleCacheForOffline called {playlist: "PLxxx", isOnline: true}
[Offline] Found downloaded tracks: 5
[Offline] Audio URLs to cache: ["/api/audio/xxx/download/", ...]
[Offline] Calling cachePlaylist...
[PWA] Caching playlist PLxxx with 5 audio files
[PWA] Sending CACHE_PLAYLIST message to service worker
[PWA] Service worker response: {success: true, cached: 5, failed: 0}
[PWA] Successfully cached 5 audio files
[Offline] cachePlaylist result: true
```

**If Service Worker Not Active:**
```
[PWA] Service Worker not supported
```
or
```
[PWA] No active service worker
```

**If Timeout:**
```
[PWA] Caching playlist timed out after 60s
```

### 4. Check Service Worker (If Issues)

If caching fails, check service worker status:

**Option A: Quick Check**
In console, run:
```javascript
navigator.serviceWorker.getRegistration().then(reg => {
  console.log('SW Registered:', !!reg);
  console.log('SW Active:', reg?.active?.state);
});
```

Expected output:
```
SW Registered: true
SW Active: "activated"
```

**Option B: DevTools Check**
1. Open DevTools → **Application** tab
2. Click **"Service Workers"** in left sidebar
3. You should see `service-worker.js` listed
4. Status should show: **"activated and is running"**

### 5. Inspect Service Worker Console (Advanced)

To see what the service worker is doing:

1. DevTools → Application → Service Workers
2. Find the running service worker
3. Click **"inspect"** next to it
4. A new DevTools window opens (Service Worker console)
5. Try caching again
6. Watch for logs in SW console:

**Expected SW Logs:**
```
[Service Worker] Message received: {type: 'CACHE_PLAYLIST', ...}
[Service Worker] Caching playlist: PLxxx with 5 tracks
[Service Worker] Cached playlist metadata
[Service Worker] Cached audio: /api/audio/xxx/download/
[Service Worker] Cached audio: /api/audio/yyy/download/
...
[Service Worker] Playlist caching complete: {cached: 5, failed: 0}
```

### 6. Verify Cache Storage

After successful caching:

1. DevTools → **Application** → **Cache Storage**
2. Expand **"soundwave-audio-v1"**
3. You should see cached audio files: `/api/audio/{id}/download/`
4. Expand **"soundwave-api-v1"**  
5. You should see: `/api/playlist/{id}/?include_items=true`

### 7. Verify IndexedDB

Check if playlist metadata was saved:

1. DevTools → **Application** → **IndexedDB**
2. Expand **"SoundwaveOfflineDB"**
3. Expand **"playlists"**
4. Click on your playlist ID
5. Check `offline: true` and `lastSync` timestamp

### 8. Test Offline Playback

1. In browser console, run: `navigator.onLine = false` (or turn off WiFi)
2. Reload the page
3. Try playing cached tracks - they should work!
4. Re-enable network: Turn WiFi back on

## Common Issues & Solutions

### Issue 1: "Service Worker not supported"
**Cause**: Not running on HTTPS or localhost  
**Solution**: Access via http://localhost:8889 (not IP address)

### Issue 2: "No active service worker"
**Cause**: Service worker not registered or failed to activate  
**Solution**:
1. Hard refresh: `Ctrl+Shift+R` (or `Cmd+Shift+R` on Mac)
2. DevTools → Application → Service Workers → Unregister
3. Refresh page to re-register

### Issue 3: "Caching playlist timed out"
**Cause**: Network too slow or many tracks  
**Solution**: 
- Check network tab for failed requests
- Try with smaller playlist first
- Check if audio downloads return 200 OK

### Issue 4: 401/403 Authentication Errors
**Cause**: Session expired or auth not passed to service worker  
**Solution**:
- Logout and login again
- Check if cookies are enabled
- Verify auth endpoint works: try downloading a track manually

### Issue 5: CORS Errors
**Cause**: Cross-origin issues  
**Solution**: Verify accessing from same origin (localhost:8889)

## Debug Script

Run this comprehensive debug script in console:

```javascript
const fullDebug = async () => {
  console.log('=== OFFLINE CACHING DEBUG ===\n');
  
  // 1. Service Worker
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    console.log('✓ Service Worker:', reg ? 'Registered' : '❌ NOT REGISTERED');
    if (reg) {
      console.log('  - Scope:', reg.scope);
      console.log('  - Active:', reg.active?.state || '❌ NO ACTIVE WORKER');
      console.log('  - Installing:', reg.installing?.state || 'none');
      console.log('  - Waiting:', reg.waiting?.state || 'none');
    }
  } catch (e) {
    console.error('❌ Service Worker check failed:', e);
  }
  
  // 2. Online Status
  console.log('\n✓ Network:', navigator.onLine ? 'Online' : '❌ OFFLINE');
  
  // 3. Caches
  try {
    const cacheNames = await caches.keys();
    console.log('\n✓ Caches:', cacheNames.length);
    for (const name of cacheNames) {
      const cache = await caches.open(name);
      const keys = await cache.keys();
      console.log(`  - ${name}: ${keys.length} items`);
    }
  } catch (e) {
    console.error('❌ Cache check failed:', e);
  }
  
  // 4. IndexedDB
  try {
    const dbs = await indexedDB.databases();
    console.log('\n✓ IndexedDB:', dbs.map(db => db.name).join(', '));
  } catch (e) {
    console.error('❌ IndexedDB check failed:', e);
  }
  
  // 5. Storage
  try {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      const est = await navigator.storage.estimate();
      const used = (est.usage / 1024 / 1024).toFixed(2);
      const total = (est.quota / 1024 / 1024).toFixed(2);
      const percent = ((est.usage / est.quota) * 100).toFixed(1);
      console.log(`\n✓ Storage: ${used} MB / ${total} MB (${percent}%)`);
    }
  } catch (e) {
    console.error('❌ Storage check failed:', e);
  }
  
  console.log('\n=== DEBUG COMPLETE ===');
};

fullDebug();
```

## Next Steps

1. **Run the test** following steps 1-3 above
2. **Check the console logs** to identify the specific issue
3. **Share the console output** if you need help debugging
4. **Verify** cache storage and IndexedDB if caching succeeds

The logs will now show exactly where the process fails! 🔍
