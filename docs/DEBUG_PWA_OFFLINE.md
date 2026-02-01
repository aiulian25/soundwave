# 🐛 PWA Offline Caching Debug Guide

## Issue Summary
PWA fails to cache playlists for offline playing with errors like "Failed to cache playlist" and no sound plays offline.

## Root Causes Identified

### 1. CORS Configuration Missing
**Problem**: Django wasn't reading `CORS_ALLOWED_ORIGINS` from environment variables.

**Fixed**: Updated `backend/config/settings.py` to read from environment variable.

**Verify Fix**: 
```bash
# Rebuild container
docker compose build
docker compose up -d

# Check logs
docker compose logs soundwave | grep CORS
```

### 2. Service Worker Not Receiving Messages
**Problem**: Service worker might not be active or registered properly.

**Check**:
```javascript
// In browser console
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

### 3. Audio Fetch Failing Due to CORS or Auth
**Problem**: Service worker can't fetch audio files due to CORS or authentication issues.

## Step-by-Step Debugging

### Step 1: Check Service Worker Status

Open DevTools (F12) → **Application** tab → **Service Workers**

You should see:
- ✅ `service-worker.js` registered
- ✅ Status: "activated and is running"
- ✅ Source: `http://localhost:8889/service-worker.js`

If not registered:
```javascript
// In console
navigator.serviceWorker.register('/service-worker.js')
  .then(reg => console.log('SW Registered', reg))
  .catch(err => console.error('SW Registration failed', err));
```

### Step 2: Test Service Worker Communication

```javascript
// In browser console
const testSW = async () => {
  const reg = await navigator.serviceWorker.ready;
  
  if (!reg.active) {
    console.error('❌ No active service worker');
    return;
  }
  
  const messageChannel = new MessageChannel();
  
  messageChannel.port1.onmessage = (event) => {
    console.log('✅ Response from SW:', event.data);
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

testSW();
```

Expected: Response from service worker within 1-2 seconds.

### Step 3: Check CORS Headers

Open DevTools → **Network** tab

1. Navigate to a playlist
2. Click "Make Available Offline"
3. Look for requests to `/api/audio/{id}/download/`
4. Click on one request
5. Check **Response Headers**

Required headers:
```
Access-Control-Allow-Origin: https://yourdomain.com
Access-Control-Allow-Credentials: true
Content-Type: audio/mpeg (or audio/mp4, etc.)
```

If CORS headers missing:
- ❌ Backend CORS not configured correctly
- ❌ Check `CORS_ALLOWED_ORIGINS` environment variable

### Step 4: Test Manual Audio Fetch

```javascript
// In browser console
const testAudioFetch = async () => {
  try {
    const response = await fetch('/api/audio/YOUR_YOUTUBE_ID/download/', {
      credentials: 'include',
      headers: {
        'Accept': 'audio/*'
      }
    });
    
    console.log('Status:', response.status);
    console.log('Headers:', [...response.headers.entries()]);
    console.log('Content-Type:', response.headers.get('content-type'));
    
    if (response.ok) {
      console.log('✅ Audio fetch successful');
      const blob = await response.blob();
      console.log('✅ Blob size:', (blob.size / 1024 / 1024).toFixed(2), 'MB');
    } else {
      console.error('❌ Audio fetch failed:', response.statusText);
    }
  } catch (err) {
    console.error('❌ Fetch error:', err);
  }
};

testAudioFetch();
```

Replace `YOUR_YOUTUBE_ID` with an actual YouTube ID from your playlist.

### Step 5: Inspect Service Worker Console

1. DevTools → **Application** → **Service Workers**
2. Find the active service worker
3. Click **"inspect"** next to it
4. A new DevTools window opens (Service Worker console)
5. Try caching a playlist again
6. Watch the SW console for errors

Expected logs in SW console:
```
[Service Worker] Message received: {type: 'CACHE_PLAYLIST', ...}
[Service Worker] Caching playlist: PLxxx with 5 tracks
[Service Worker] Cached playlist metadata
[Service Worker] Fetching: /api/audio/xxx/download/
[Service Worker] ✓ Cached: /api/audio/xxx/download/ - 3.45 MB
[Service Worker] ✓ Cached: /api/audio/yyy/download/ - 4.12 MB
...
[Service Worker] Playlist caching complete
```

Common errors:
```
❌ TypeError: Failed to fetch
   → CORS issue or network problem

❌ HTTP 401 Unauthorized
   → Authentication cookies not sent

❌ HTTP 403 Forbidden
   → CORS or CSRF issue

❌ HTTP 404 Not Found
   → Audio not downloaded yet or wrong URL
```

### Step 6: Check Cache Storage

DevTools → **Application** → **Cache Storage**

You should see:
- `soundwave-v1` - Static assets
- `soundwave-api-v1` - API responses
- `soundwave-audio-v1` - **Audio files** ← This is where audio should be
- `soundwave-images-v1` - Images

Click on `soundwave-audio-v1`:
- Should show cached audio files with keys like `/api/audio/{id}/download/`
- Each entry should have a size (MB)

If empty after caching:
- ❌ Caching failed silently
- Check SW console for errors

### Step 7: Test Offline Playback

1. Cache a playlist (follow steps above to ensure it works)
2. DevTools → **Network** tab
3. Change throttling to **"Offline"**
4. Try playing a track

What to check:
- Network tab shows requests but they should come from "ServiceWorker"
- Console should show: `[Service Worker] ✓ Serving audio from cache: /api/audio/xxx/download/`

If fails:
```
❌ [Service Worker] ✗ Cache miss for: /api/audio/xxx/download/
   → Audio wasn't cached properly
   
❌ [Service Worker] Available cached audio: []
   → Cache is empty
```

## Quick Fixes

### Fix 1: Restart Docker Containers
```bash
cd /path/to/soundwave
docker compose down
docker compose build --no-cache
docker compose up -d
```

### Fix 2: Clear All Caches
```javascript
// In browser console
const clearAllCaches = async () => {
  const cacheNames = await caches.keys();
  await Promise.all(cacheNames.map(name => caches.delete(name)));
  console.log('✅ All caches cleared');
  
  // Unregister service worker
  const reg = await navigator.serviceWorker.getRegistration();
  if (reg) {
    await reg.unregister();
    console.log('✅ Service worker unregistered');
  }
  
  console.log('🔄 Reload page now');
};

clearAllCaches();
```

Then reload the page (hard refresh: Ctrl+Shift+R).

### Fix 3: Update Service Worker
```javascript
// In browser console
const updateSW = async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  if (reg) {
    await reg.update();
    console.log('✅ Service worker updated');
  }
};

updateSW();
```

### Fix 4: Check Container Environment Variables
```bash
# Check if CORS is set
docker compose exec soundwave env | grep CORS

# Should show:
# CORS_ALLOWED_ORIGINS=http://localhost:8889,https://localhost:8889,https://yourdomain.com
```

If not shown, environment variable not set in docker-compose.yml.

## Known Issues & Solutions

### Issue: "Failed to cache playlist" after 60 seconds
**Cause**: Timeout - too many files or slow network

**Solution**:
1. Cache smaller playlists first (< 10 tracks)
2. Check network speed
3. Increase timeout in `frontend/src/utils/pwa.ts` (line ~325)

### Issue: CORS error when fetching audio
**Cause**: Backend not configured for HTTPS origin

**Solution**: Already fixed in `docker-compose.yml` and `settings.py`

### Issue: Service worker not updating
**Cause**: Browser caching old service worker

**Solution**:
1. DevTools → Application → Service Workers
2. Check "Update on reload"
3. Hard refresh (Ctrl+Shift+R)

### Issue: Audio plays online but not offline
**Cause**: Audio not in cache or wrong cache key

**Solution**:
1. Check Cache Storage (Step 6)
2. Verify cache keys match request URLs exactly
3. Re-cache the playlist

## Testing Checklist

Before reporting the issue is fixed:

- [ ] Service worker registered and active
- [ ] CORS headers present on audio downloads
- [ ] Can cache a small playlist (3-5 tracks)
- [ ] Cache Storage shows audio files
- [ ] Offline mode: can play cached tracks
- [ ] Network tab shows "ServiceWorker" as source
- [ ] No console errors during playback

## Advanced: Check Django CORS Settings

```bash
# SSH into container
docker compose exec soundwave bash

# Open Django shell
python manage.py shell

# Check CORS settings
from django.conf import settings
print("CORS_ALLOWED_ORIGINS:", settings.CORS_ALLOWED_ORIGINS)
print("CORS_ALLOW_CREDENTIALS:", settings.CORS_ALLOW_CREDENTIALS)
print("CSRF_TRUSTED_ORIGINS:", settings.CSRF_TRUSTED_ORIGINS)
```

Expected output:
```python
CORS_ALLOWED_ORIGINS: ['http://localhost:8889', 'https://localhost:8889', 'https://yourdomain.com']
CORS_ALLOW_CREDENTIALS: True
CSRF_TRUSTED_ORIGINS: ['http://localhost:8889', 'https://localhost:8889', 'https://yourdomain.com']
```

## Need More Help?

If still not working after following this guide:

1. Share output from **Step 1** (SW status)
2. Share output from **Step 4** (audio fetch test)
3. Share screenshot of **Step 5** (SW console errors)
4. Share screenshot of **Step 6** (Cache Storage)

This will help identify the exact issue.
