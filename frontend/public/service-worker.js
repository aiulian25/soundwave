/* eslint-disable no-restricted-globals */
const CACHE_NAME = 'soundwave-v20';
const API_CACHE_NAME = 'soundwave-api-v3';
const AUDIO_CACHE_NAME = 'soundwave-audio-v3'; // PINNED only: "Make available offline" downloads
const STREAM_CACHE_NAME = 'soundwave-stream-v1'; // EVICTABLE: casual + prefetched streams
const IMAGE_CACHE_NAME = 'soundwave-images-v5';

// Routine progress messages are for debugging only; warnings and errors always reach the console.
const DEBUG_LOGGING = false;
const debugLog = (...details) => {
  if (DEBUG_LOGGING) console.log(...details);
};

// Two distinct audio caches, by intent:
//   AUDIO_CACHE_NAME  — tracks the user explicitly "Made available offline"
//                       (/api/audio/<id>/download/). PINNED: never evicted.
//   STREAM_CACHE_NAME — opportunistically-streamed /media/ audio + prefetched
//                       next tracks. EVICTABLE oldest-first under these budgets:
const AUDIO_STREAM_MAX_ENTRIES = 40;
const AUDIO_STREAM_MAX_BYTES = 500 * 1024 * 1024; // 500 MB, mirrors the old IndexedDB cap
const PINNED_AUDIO_RE = /\/api\/audio\/[^/]+\/download\/?$/;

// Artwork this server keeps for tracks, playlists and channels, plus the app's other images.
// Oldest entries go first once the cache holds this many (a cover is roughly 10-40 KB).
const IMAGE_CACHE_MAX_ENTRIES = 1500;
const ARTWORK_RE = /^\/api\/(v1\/)?(audio|playlist|channel)\/[^/]+\/artwork\/?$/;
const ARTWORK_REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

const SINGLE_BYTE_RANGE_RE = /^\s*bytes\s*=\s*(\d*)-(\d*)\s*$/i;
const UNSATISFIABLE_RANGE = Symbol('unsatisfiable range');

// Caches holding one account's data. The app shell (CACHE_NAME) is public and stays.
// Must match ACCOUNT_CACHE_NAME_PATTERN in src/utils/pwa.ts.
const ACCOUNT_CACHE_NAME_PATTERN = /^soundwave-(api|audio|stream|images)-/;
// The only API responses kept for offline use. Anything else (API keys, 2FA, passkeys,
// admin lists) goes straight to the network and never reaches Cache Storage.
const OFFLINE_API_RE = /^\/api\/(v1\/)?(audio\/|playlist\/|channel\/|stats\/|version\/|user\/account\/|user\/config\/)/;

const OLD_SHAPE_LIST_RE = /^\/api\/(v1\/)?(audio\/list|channel)\/$/;

// Bumped by every clear. A fetch that started before a clear belongs to the previous
// account, so its response must not be written into the emptied caches. In memory on
// purpose: a fetch cannot outlive the worker that started it.
let cacheGeneration = 0;

// Running playlist fills by playlist id, so one can be told to stop.
const activeFills = new Map();

function cancelFill(playlistId) {
  const fill = activeFills.get(playlistId);
  if (fill) fill.canceled = true;
  return Boolean(fill);
}

async function putIfCurrent(generation, cacheName, key, response) {
  const cache = await caches.open(cacheName);
  if (generation !== cacheGeneration) return false;
  await cache.put(key, response);
  return true;
}

async function deleteAccountCaches() {
  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames.filter((name) => ACCOUNT_CACHE_NAME_PATTERN.test(name)).map((name) => caches.delete(name))
  );
}

// Older versions cached every API response, including sensitive ones, and these lists in a
// shape without `next`, which the client now refuses. Online pages refetch them straight away.
async function pruneNonOfflineApiEntries() {
  try {
    const cache = await caches.open(API_CACHE_NAME);
    const keys = await cache.keys();
    const isStale = (pathname) => !OFFLINE_API_RE.test(pathname) || OLD_SHAPE_LIST_RE.test(pathname);
    await Promise.all(
      keys
        .filter((request) => isStale(new URL(request.url).pathname))
        .map((request) => cache.delete(request))
    );
  } catch (error) {
    console.warn('[Service Worker] API cache prune failed:', error);
  }
}

// Assets to cache on install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/favicon.ico',
  '/locales/en/translation.json',
  '/locales/ro/translation.json',
];

// The scripts and styles index.html loads directly; without them it renders a blank page offline.
const ENTRY_ASSET_PATTERN = /(?:src|href)="(\/assets\/[^"]+)"/g;

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  const index = await fetch('/index.html', { cache: 'no-cache' });
  const html = await index.text();
  // Assets first: the new index.html must not replace a working one until they are safely stored.
  await cache.addAll([...html.matchAll(ENTRY_ASSET_PATTERN)].map((match) => match[1]));
  await cache.addAll(STATIC_ASSETS);
}

// Install event - cache the whole shell, then activate immediately.
// skipWaiting() ensures the new SW takes over right away without waiting
// for the user to click an "Update" button. This is important for critical
// fixes (e.g. broken image caching) that need to reach users immediately.
// A failed cache fails the install on purpose: the working version stays, and the browser
// tries again on its next update check.
self.addEventListener('install', (event) => {
  debugLog('[Service Worker] Installing new version...');
  event.waitUntil(
    cacheAppShell().then(() => {
      debugLog('[Service Worker] Installed - activating immediately');
      return self.skipWaiting();
    })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  debugLog('[Service Worker] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (
            cacheName !== CACHE_NAME &&
            cacheName !== API_CACHE_NAME &&
            cacheName !== AUDIO_CACHE_NAME &&
            cacheName !== STREAM_CACHE_NAME &&
            cacheName !== IMAGE_CACHE_NAME
          ) {
            debugLog('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => pruneCasualFromPinnedCache()).then(() => pruneNonOfflineApiEntries()).then(() => {
      debugLog('[Service Worker] Activated');
      return self.clients.claim(); // Take control immediately
    })
  );
});

// Fetch event - implement caching strategies
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip chrome extensions and non-http(s) requests
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // CRITICAL: Do NOT intercept cross-origin requests.
  // Cross-origin resources (YouTube thumbnails from i.ytimg.com, yt3.ggpht.com, etc.)
  // must be handled by the browser natively. If we call event.respondWith() for them,
  // any fetch() inside the SW uses CORS mode by default — YouTube CDN doesn't support CORS
  // so the fetch fails, and background-image renders blank on all devices.
  // Returning without event.respondWith() lets the browser make the request directly
  // in no-cors mode, which works correctly.
  if (url.origin !== self.location.origin) {
    return;
  }

  // Skip non-GET requests - Cache API only supports GET
  if (request.method !== 'GET') {
    return;
  }

  // The app asks with a version per release, so the version installed with the shell answers
  // offline; without it a reload right after an upgrade shows raw translation keys.
  if (url.pathname.startsWith('/locales/')) {
    event.respondWith(fetch(request).catch(() => caches.match(url.pathname)));
    return;
  }

  // Artwork this server keeps: served from the cache, offline too.
  if (ARTWORK_RE.test(url.pathname)) {
    event.respondWith(artworkStrategy(event));
    return;
  }

  // Audio download API endpoints - Cache first (critical for offline playback)
  // These are cached by "Make Available Offline" feature
  if (url.pathname.match(/\/api\/audio\/[^/]+\/download\/?$/)) {
    debugLog('[Service Worker] Audio download request:', url.pathname);
    event.respondWith(audioCacheFirstStrategy(request));
    return;
  }

  // Audio player API endpoints - Network first, but check audio cache as fallback
  if (url.pathname.match(/\/api\/audio\/[^/]+\/player\/?$/)) {
    event.respondWith(networkFirstStrategy(request, API_CACHE_NAME));
    return;
  }

  // API requests - Network first, fallback to cache, only for what is useful offline
  if (url.pathname.startsWith('/api/')) {
    if (!OFFLINE_API_RE.test(url.pathname)) {
      return;
    }
    event.respondWith(networkFirstStrategy(request, API_CACHE_NAME));
    return;
  }

  // Audio files - Cache first, fallback to network
  if (
    url.pathname.includes('/audio/') ||
    url.pathname.includes('/media/local_audio/') ||
    request.destination === 'audio'
  ) {
    event.respondWith(cacheFirstStrategy(request, STREAM_CACHE_NAME));
    return;
  }

  // Images - Cache first, same-origin only.
  // Cross-origin images (YouTube thumbnails from i.ytimg.com, yt3.ggpht.com, etc.)
  // are NOT intercepted. Returning opaque (no-cors) responses from a service worker
  // for cross-origin images breaks CSS background-image display on mobile Chrome PWA.
  // The browser handles external images directly — correct, performant, no side effects.
  if (
    url.origin === self.location.origin && (
      url.pathname.includes('/img/') ||
      url.pathname.includes('/media/') ||
      url.pathname.includes('/avatars/') ||
      request.destination === 'image'
    )
  ) {
    event.respondWith(cacheFirstStrategy(request, IMAGE_CACHE_NAME));
    return;
  }

  // Static assets (JS, CSS) - Stale while revalidate
  if (
    request.destination === 'script' ||
    request.destination === 'style' ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css')
  ) {
    event.respondWith(staleWhileRevalidateStrategy(request, CACHE_NAME));
    return;
  }

  // HTML pages - Network first, fallback to cache
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(networkFirstStrategy(request, CACHE_NAME));
    return;
  }

  // Default - Network first
  event.respondWith(networkFirstStrategy(request, CACHE_NAME));
});

// Network first strategy - try network, fallback to cache
async function networkFirstStrategy(request, cacheName) {
  const generation = cacheGeneration;
  try {
    const networkResponse = await fetch(request);
    
    // Only cache GET requests with successful responses
    if (request.method === 'GET' && networkResponse && networkResponse.status === 200) {
      putIfCurrent(generation, cacheName, request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    debugLog('[Service Worker] Network request failed, trying cache:', request.url);
    const cachedResponse = await caches.match(request);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Return offline page for navigation requests.
    if (request.mode === 'navigate' || request.destination === 'document') {
      const cache = await caches.open(CACHE_NAME);
      const offlinePage = await cache.match('/offline.html');
      if (offlinePage) {
        return offlinePage;
      }

      // Last-resort fallback to index for compatibility.
      const appShell = await cache.match('/index.html');
      if (appShell) {
        return appShell;
      }
    }
    
    throw error;
  }
}

// Cache first strategy - try cache, fallback to network
async function cacheFirstStrategy(request, cacheName) {
  // Only use cache for GET requests
  if (request.method === 'GET') {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      const rangeHeader = request.headers.get('range');
      return rangeHeader ? handleRangeRequest(cachedResponse, rangeHeader) : cachedResponse;
    }
  }
  
  const generation = cacheGeneration;
  try {
    const networkResponse = await fetch(request);
    
    // Only cache GET requests with successful responses
    if (request.method === 'GET' && networkResponse && networkResponse.status === 200) {
      const written = putIfCurrent(generation, cacheName, request, networkResponse.clone());
      if (cacheName === STREAM_CACHE_NAME) {
        // Trim the (casual-stream) audio cache after each new write so it stays bounded.
        written.then(() => trimStreamCache()).catch(() => {});
      }
      if (cacheName === IMAGE_CACHE_NAME) {
        written.then(() => trimImageCache()).catch(() => {});
      }
    }

    return networkResponse;
  } catch (error) {
    console.error('[Service Worker] Cache and network failed:', error);
    throw error;
  }
}

// Kept artwork is stored under its path alone. The lock screen asks for it with a short-lived
// ticket in the query, and keying on that stored the same image again for every play. A kept
// copy answers at once; one over a day old is also fetched again in the background, so a
// cover that was replaced on the server does arrive.
async function artworkStrategy(event) {
  const { request } = event;
  const cacheKey = new URL(request.url).pathname;
  const cache = await caches.open(IMAGE_CACHE_NAME);
  const kept = await cache.match(cacheKey);
  if (!kept) {
    return fetchAndKeepArtwork(request, cacheKey);
  }
  if (isOlderThan(kept, ARTWORK_REFRESH_AFTER_MS)) {
    event.waitUntil(fetchAndKeepArtwork(request, cacheKey).catch(() => {}));
  }
  return kept;
}

async function fetchAndKeepArtwork(request, cacheKey) {
  const generation = cacheGeneration;
  const response = await fetch(request);
  if (response && response.status === 200) {
    await putIfCurrent(generation, IMAGE_CACHE_NAME, cacheKey, response.clone());
    await trimImageCache();
  }
  return response;
}

// A response with no readable date is treated as recent rather than refetched on every view.
function isOlderThan(response, maxAgeMs) {
  const receivedAt = Date.parse((response.headers && response.headers.get('date')) || '');
  return Number.isFinite(receivedAt) && Date.now() - receivedAt > maxAgeMs;
}

async function trimImageCache() {
  const cache = await caches.open(IMAGE_CACHE_NAME);
  const keptRequests = await cache.keys(); // insertion order: oldest first
  const excess = keptRequests.length - IMAGE_CACHE_MAX_ENTRIES;
  for (const oldest of keptRequests.slice(0, Math.max(excess, 0))) {
    await cache.delete(oldest);
  }
}

// Bound the STREAM_CACHE so casual streaming + prefetch don't grow Cache Storage without
// limit. Evicts oldest entries (insertion order) once over the count or byte budget.
// Pinned "Make available offline" downloads live in AUDIO_CACHE and are never touched here.
async function trimStreamCache() {
  try {
    const cache = await caches.open(STREAM_CACHE_NAME);
    const streamKeys = await cache.keys(); // insertion order — oldest first

    // Measure sizes via Content-Length headers (does not read the bodies).
    let total = 0;
    const sized = [];
    for (const req of streamKeys) {
      const res = await cache.match(req);
      const len = res ? Number(res.headers.get('content-length')) || 0 : 0;
      sized.push({ req, len });
      total += len;
    }

    let evicted = 0;
    let i = 0;
    while (
      i < sized.length &&
      (sized.length - i > AUDIO_STREAM_MAX_ENTRIES || total > AUDIO_STREAM_MAX_BYTES)
    ) {
      await cache.delete(sized[i].req);
      total -= sized[i].len;
      i++;
      evicted++;
    }
    if (evicted > 0) {
      debugLog(`[Service Worker] Audio cache trimmed: evicted ${evicted} streamed entr${evicted === 1 ? 'y' : 'ies'}`);
    }
  } catch (error) {
    console.warn('[Service Worker] Audio cache trim failed:', error);
  }
}

// One-time migration: older versions streamed casual /media/ audio into AUDIO_CACHE.
// AUDIO_CACHE is now pinned-downloads-only, so drop any non-/download/ leftovers there
// (they're re-cached into STREAM_CACHE on next play). Pinned downloads are kept.
async function pruneCasualFromPinnedCache() {
  try {
    const cache = await caches.open(AUDIO_CACHE_NAME);
    const keys = await cache.keys();
    let pruned = 0;
    for (const req of keys) {
      if (!PINNED_AUDIO_RE.test(new URL(req.url).pathname)) {
        await cache.delete(req);
        pruned++;
      }
    }
    if (pruned > 0) {
      debugLog(`[Service Worker] Migrated audio cache: pruned ${pruned} casual stream(s) from the pinned cache`);
    }
  } catch (error) {
    console.warn('[Service Worker] Pinned-cache migration failed:', error);
  }
}

// Audio-specific cache first strategy with better URL matching and range request support
async function audioCacheFirstStrategy(request) {
  const url = new URL(request.url);
  
  // Check for range requests (iOS Safari uses these for audio seeking)
  const rangeHeader = request.headers.get('range');
  
  // Try exact match first
  const audioCache = await caches.open(AUDIO_CACHE_NAME);
  let cachedResponse = await audioCache.match(request, { ignoreSearch: true });
  
  if (!cachedResponse) {
    // Try matching just the pathname (without query params)
    cachedResponse = await audioCache.match(url.pathname);
  }
  
  if (!cachedResponse) {
    // Try matching with trailing slash variation
    const pathWithSlash = url.pathname.endsWith('/') ? url.pathname : url.pathname + '/';
    const pathWithoutSlash = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
    
    cachedResponse = await audioCache.match(pathWithSlash) || await audioCache.match(pathWithoutSlash);
  }
  
  if (cachedResponse) {
    debugLog('[Service Worker] Serving cached audio:', url.pathname);
    
    // Handle range requests for cached audio (critical for iOS Safari)
    if (rangeHeader) {
      return handleRangeRequest(cachedResponse, rangeHeader);
    }
    
    return cachedResponse;
  }
  
  // No cache hit, try network
  const generation = cacheGeneration;
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse && networkResponse.status === 200) {
      // Cache the response for future offline use
      putIfCurrent(generation, AUDIO_CACHE_NAME, url.pathname, networkResponse.clone());
      debugLog('[Service Worker] Cached new audio:', url.pathname);
    }
    
    return networkResponse;
  } catch (error) {
    console.error('[Service Worker] Audio fetch failed (offline?):', url.pathname, error);
    
    // Return a proper error response instead of throwing
    return new Response(JSON.stringify({ error: 'Audio not available offline' }), {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// What a Range header asks of a cached body of `length` bytes. Returns null when the header
// should be ignored, which HTTP allows: malformed, reversed and multiple ranges get the whole
// body with a 200, because media elements only ever ask for one range.
function resolveByteRange(rangeHeader, length) {
  const match = rangeHeader.match(SINGLE_BYTE_RANGE_RE);
  if (!match) return null;

  const [, first, last] = match;
  if (!first && !last) return null;

  if (!first) {
    const suffixLength = Number(last);
    if (suffixLength === 0 || length === 0) return UNSATISFIABLE_RANGE;
    return { start: Math.max(length - suffixLength, 0), end: length - 1 };
  }

  const start = Number(first);
  if (last && Number(last) < start) return null;
  if (start >= length) return UNSATISFIABLE_RANGE;
  return { start, end: last ? Math.min(Number(last), length - 1) : length - 1 };
}

// Handle range requests for cached audio (required for iOS Safari seeking)
async function handleRangeRequest(cachedResponse, rangeHeader) {
  // Use the Blob (disk-backed in Cache Storage) and slice it. blob.slice() returns a
  // zero-copy view, so we never pull the whole file into the JS heap the way
  // arrayBuffer() did — important because iOS Safari issues many range requests.
  const blob = await cachedResponse.blob();
  const totalLength = blob.size;
  const contentType = cachedResponse.headers.get('Content-Type') || 'audio/mpeg';
  const range = resolveByteRange(rangeHeader, totalLength);

  if (range === UNSATISFIABLE_RANGE) {
    return new Response(null, {
      status: 416,
      statusText: 'Range Not Satisfiable',
      headers: { 'Content-Range': `bytes */${totalLength}`, 'Accept-Ranges': 'bytes' },
    });
  }

  if (!range) {
    return new Response(blob, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': totalLength.toString(),
        'Accept-Ranges': 'bytes',
      },
    });
  }

  const slicedBlob = blob.slice(range.start, range.end + 1);

  return new Response(slicedBlob, {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': contentType,
      'Content-Length': slicedBlob.size.toString(),
      'Content-Range': `bytes ${range.start}-${range.end}/${totalLength}`,
      'Accept-Ranges': 'bytes',
    },
  });
}

// Stale while revalidate - return cache immediately, update in background
async function staleWhileRevalidateStrategy(request, cacheName) {
  // Only use cache for GET requests
  const cachedResponse = request.method === 'GET' ? await caches.match(request) : null;
  
  const fetchPromise = fetch(request).then((networkResponse) => {
    // Only cache GET requests with successful responses
    if (request.method === 'GET' && networkResponse && networkResponse.status === 200) {
      const responseClone = networkResponse.clone();
      caches.open(cacheName).then((c) => c.put(request, responseClone));
    }
    return networkResponse;
  }).catch((error) => {
    debugLog('[Service Worker] Background fetch failed:', error);
  });
  
  return cachedResponse || fetchPromise;
}

// Push notifications
self.addEventListener('push', (event) => {
  debugLog('[Service Worker] Push notification received');
  
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'SoundWave';
  const options = {
    body: data.body || 'New content available',
    icon: '/img/icons/icon-192x192.png',
    badge: '/img/icons/icon-72x72.png',
    vibrate: [200, 100, 200],
    data: data.url || '/',
    actions: [
      { action: 'open', title: 'Open' },
      { action: 'close', title: 'Close' },
    ],
  };
  
  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Notification click
self.addEventListener('notificationclick', (event) => {
  debugLog('[Service Worker] Notification clicked');
  event.notification.close();
  
  if (event.action === 'open' || !event.action) {
    const urlToOpen = event.notification.data || '/';
    event.waitUntil(
      clients.openWindow(urlToOpen)
    );
  }
});

// Message handling for cache management
self.addEventListener('message', (event) => {
  debugLog('[Service Worker] Message received:', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CLEAR_ACCOUNT_DATA') {
    cacheGeneration += 1;
    event.waitUntil(
      deleteAccountCaches().then(() => {
        event.ports[0].postMessage({ success: true });
      })
    );
  }

  if (event.data && event.data.type === 'CLEAR_CACHE') {
    cacheGeneration += 1;
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => caches.delete(cacheName))
        );
      }).then(() => {
        event.ports[0].postMessage({ success: true });
      })
    );
  }
  
  // Warm the evictable STREAM_CACHE with a casual/prefetched audio URL. Fetched by the SW
  // itself (SW-initiated fetches are not re-intercepted), so /media/ audio lands in
  // STREAM_CACHE rather than being mis-routed to the image cache by a page-side fetch().
  if (event.data && event.data.type === 'PREFETCH_STREAM') {
    const { url } = event.data;
    const generation = cacheGeneration;
    event.waitUntil(
      (async () => {
        let success = false;
        try {
          const cache = await caches.open(STREAM_CACHE_NAME);
          if (await cache.match(url)) {
            success = true; // already cached — idempotent
          } else {
            const resp = await fetch(url, { credentials: 'include' });
            if (resp && resp.status === 200) {
              success = await putIfCurrent(generation, STREAM_CACHE_NAME, url, resp.clone());
              await trimStreamCache();
            }
          }
        } catch (err) {
          console.warn('[Service Worker] Prefetch stream failed:', url, err);
        }
        if (event.ports && event.ports[0]) event.ports[0].postMessage({ success });
      })()
    );
  }

  // Enforce the STREAM_CACHE eviction budget on demand (e.g. after a page-side write).
  if (event.data && event.data.type === 'TRIM_STREAM_CACHE') {
    event.waitUntil(trimStreamCache());
  }

  if (event.data && event.data.type === 'CACHE_AUDIO') {
    const { url } = event.data;
    const generation = cacheGeneration;
    event.waitUntil(
      fetch(url).then((response) => {
        if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
        return putIfCurrent(generation, AUDIO_CACHE_NAME, url, response);
      }).then((success) => {
        event.ports[0].postMessage({ success });
      }).catch((error) => {
        event.ports[0].postMessage({ success: false, error: error.message });
      })
    );
  }
  
  // Cache playlist for offline access with authentication
  if (event.data && event.data.type === 'CACHE_PLAYLIST') {
    const { playlistId, audioUrls } = event.data;
    const generation = cacheGeneration;
    cancelFill(playlistId);
    const fill = { canceled: false };
    activeFills.set(playlistId, fill);
    event.waitUntil(
      (async () => {
        try {
          debugLog('[Service Worker] Caching playlist:', playlistId, 'with', audioUrls.length, 'tracks');
          const audioCache = await caches.open(AUDIO_CACHE_NAME);
          
          const results = {
            metadata: false,
            audioFiles: [],
            failed: []
          };
          
          const totalItems = audioUrls.length + 1; // +1 for metadata
          let completedItems = 0;
          
          // Helper to send progress updates
          const sendProgress = (currentItem, status) => {
            event.ports[0].postMessage({
              type: 'progress',
              current: completedItems,
              total: totalItems,
              currentItem,
              status,
              percent: Math.round((completedItems / totalItems) * 100)
            });
          };

          // Cache the playlist's own details; the page keeps the track list in IndexedDB
          sendProgress('Playlist metadata', 'downloading');
          try {
            const metadataUrl = `/api/playlist/${playlistId}/`;
            const metadataResponse = await fetch(metadataUrl, {
              headers: {
                'Accept': 'application/json',
              },
              credentials: 'include',
            });
            if (metadataResponse.ok) {
              results.metadata = await putIfCurrent(generation, API_CACHE_NAME, metadataUrl, metadataResponse.clone());
              debugLog('[Service Worker] Cached playlist metadata');
            }
          } catch (err) {
            console.warn('[Service Worker] Failed to cache playlist metadata:', err);
          }
          completedItems++;
          sendProgress('Playlist metadata', 'done');
          
          // Cache all audio files in playlist with authentication
          for (let i = 0; i < audioUrls.length; i++) {
            if (generation !== cacheGeneration) {
              throw new Error('Caches were cleared while saving this playlist');
            }
            if (fill.canceled) break;
            const url = audioUrls[i];
            const trackNum = i + 1;
            const trackName = `Track ${trackNum}/${audioUrls.length}`;
            
            sendProgress(trackName, 'downloading');
            
            try {
              // Saving again after an interruption only fetches what is still missing.
              if (await audioCache.match(url)) {
                results.audioFiles.push(url);
                completedItems++;
                sendProgress(trackName, 'done');
                continue;
              }

              const response = await fetch(url, {
                headers: {
                  'Accept': 'audio/*',
                },
                credentials: 'include',
              });
              
              if (fill.canceled) break;

              if (response.ok) {
                // Clone and cache the response
                if (await putIfCurrent(generation, AUDIO_CACHE_NAME, url, response.clone())) {
                  results.audioFiles.push(url);
                  debugLog('[Service Worker] Cached audio:', url);
                }
              } else {
                results.failed.push(url);
                console.warn('[Service Worker] Failed to cache audio (status ' + response.status + '):', url);
              }
            } catch (err) {
              results.failed.push(url);
              console.warn('[Service Worker] Failed to cache audio:', url, err);
            }
            
            completedItems++;
            sendProgress(trackName, results.audioFiles.includes(url) ? 'done' : 'failed');
          }
          
          debugLog('[Service Worker] Playlist caching complete:', results);
          event.ports[0].postMessage({ 
            type: 'complete',
            success: results.audioFiles.length > 0,
            canceled: fill.canceled,
            metadata: results.metadata,
            cached: results.audioFiles.length,
            failed: results.failed.length,
            details: results
          });
        } catch (error) {
          console.error('[Service Worker] Playlist caching error:', error);
          event.ports[0].postMessage({ type: 'complete', success: false, error: error.message });
        } finally {
          if (activeFills.get(playlistId) === fill) activeFills.delete(playlistId);
        }
      })()
    );
  }

  if (event.data && event.data.type === 'CANCEL_PLAYLIST_CACHE') {
    cancelFill(event.data.playlistId);
    event.ports[0].postMessage({ success: true });
  }
  
  // Remove cached playlist
  if (event.data && event.data.type === 'REMOVE_PLAYLIST_CACHE') {
    const { playlistId, audioUrls } = event.data;
    cancelFill(playlistId);
    event.waitUntil(
      Promise.all([
        // Remove playlist metadata from cache, under the key CACHE_PLAYLIST stored it
        caches.open(API_CACHE_NAME).then((cache) => {
          return Promise.all([
            cache.delete(`/api/playlist/${playlistId}/?include_items=true`),
            cache.delete(`/api/playlist/${playlistId}/`),
          ]);
        }),
        // The page sends only the audio no other saved playlist needs
        caches.open(AUDIO_CACHE_NAME).then((cache) => {
          return Promise.all(
            audioUrls.map(url => cache.delete(url))
          );
        })
      ]).then(() => {
        event.ports[0].postMessage({ success: true });
      }).catch((error) => {
        event.ports[0].postMessage({ success: false, error: error.message });
      })
    );
  }
});

debugLog('[Service Worker] Loaded');
