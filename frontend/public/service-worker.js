/* eslint-disable no-restricted-globals */
const CACHE_NAME = 'soundwave-v4';
const API_CACHE_NAME = 'soundwave-api-v1';
const AUDIO_CACHE_NAME = 'soundwave-audio-v1';
const IMAGE_CACHE_NAME = 'soundwave-images-v1';

// Assets to cache on install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching static assets');
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.error('[Service Worker] Failed to cache static assets:', err);
      });
    }).then(() => {
      console.log('[Service Worker] Installed');
      return self.skipWaiting(); // Activate immediately
    })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (
            cacheName !== CACHE_NAME &&
            cacheName !== API_CACHE_NAME &&
            cacheName !== AUDIO_CACHE_NAME &&
            cacheName !== IMAGE_CACHE_NAME
          ) {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('[Service Worker] Activated');
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

  // Skip non-GET requests - Cache API only supports GET
  if (request.method !== 'GET') {
    return;
  }

  // Audio download API endpoints - Cache first (critical for offline playback)
  // These are cached by "Make Available Offline" feature
  if (url.pathname.match(/\/api\/audio\/[^/]+\/download\/?$/)) {
    console.log('[Service Worker] Audio download request:', url.pathname);
    event.respondWith(audioCacheFirstStrategy(request));
    return;
  }

  // Audio player API endpoints - Network first, but check audio cache as fallback
  if (url.pathname.match(/\/api\/audio\/[^/]+\/player\/?$/)) {
    event.respondWith(networkFirstStrategy(request, API_CACHE_NAME));
    return;
  }

  // API requests - Network first, fallback to cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstStrategy(request, API_CACHE_NAME));
    return;
  }

  // Audio files - Cache first, fallback to network
  if (
    url.pathname.includes('/audio/') ||
    url.pathname.includes('/media/local_audio/') ||
    request.destination === 'audio'
  ) {
    event.respondWith(cacheFirstStrategy(request, AUDIO_CACHE_NAME));
    return;
  }

  // Images - Cache first, fallback to network
  if (
    url.pathname.includes('/img/') ||
    url.pathname.includes('/media/') ||
    url.pathname.includes('thumbnail') ||
    url.pathname.includes('cover') ||
    request.destination === 'image'
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
  try {
    const networkResponse = await fetch(request);
    
    // Only cache GET requests with successful responses
    if (request.method === 'GET' && networkResponse && networkResponse.status === 200) {
      const responseClone = networkResponse.clone();
      const cache = await caches.open(cacheName);
      cache.put(request, responseClone);
    }
    
    return networkResponse;
  } catch (error) {
    console.log('[Service Worker] Network request failed, trying cache:', request.url);
    const cachedResponse = await caches.match(request);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Return offline page for navigation requests
    if (request.mode === 'navigate') {
      const cache = await caches.open(CACHE_NAME);
      const offlinePage = await cache.match('/index.html');
      if (offlinePage) {
        return offlinePage;
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
      return cachedResponse;
    }
  }
  
  try {
    const networkResponse = await fetch(request);
    
    // Only cache GET requests with successful responses
    if (request.method === 'GET' && networkResponse && networkResponse.status === 200) {
      const responseClone = networkResponse.clone();
      const cache = await caches.open(cacheName);
      cache.put(request, responseClone);
    }
    
    return networkResponse;
  } catch (error) {
    console.error('[Service Worker] Cache and network failed:', error);
    throw error;
  }
}

// Audio-specific cache first strategy with better URL matching
async function audioCacheFirstStrategy(request) {
  const url = new URL(request.url);
  
  // Try exact match first
  const audioCache = await caches.open(AUDIO_CACHE_NAME);
  let cachedResponse = await audioCache.match(request);
  
  if (cachedResponse) {
    console.log('[Service Worker] Serving cached audio:', url.pathname);
    return cachedResponse;
  }
  
  // Try matching just the pathname (without query params)
  cachedResponse = await audioCache.match(url.pathname);
  if (cachedResponse) {
    console.log('[Service Worker] Serving cached audio (pathname match):', url.pathname);
    return cachedResponse;
  }
  
  // Try matching with trailing slash variation
  const pathWithSlash = url.pathname.endsWith('/') ? url.pathname : url.pathname + '/';
  const pathWithoutSlash = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  
  cachedResponse = await audioCache.match(pathWithSlash);
  if (cachedResponse) {
    console.log('[Service Worker] Serving cached audio (with slash):', pathWithSlash);
    return cachedResponse;
  }
  
  cachedResponse = await audioCache.match(pathWithoutSlash);
  if (cachedResponse) {
    console.log('[Service Worker] Serving cached audio (without slash):', pathWithoutSlash);
    return cachedResponse;
  }
  
  // No cache hit, try network
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse && networkResponse.status === 200) {
      // Cache the response for future offline use
      const responseClone = networkResponse.clone();
      audioCache.put(url.pathname, responseClone);
      console.log('[Service Worker] Cached new audio:', url.pathname);
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
    console.log('[Service Worker] Background fetch failed:', error);
  });
  
  return cachedResponse || fetchPromise;
}

// Background sync for offline uploads
self.addEventListener('sync', (event) => {
  console.log('[Service Worker] Background sync:', event.tag);
  
  if (event.tag === 'sync-audio-uploads') {
    event.waitUntil(syncAudioUploads());
  }
  
  if (event.tag === 'sync-favorites') {
    event.waitUntil(syncFavorites());
  }
});

async function syncAudioUploads() {
  console.log('[Service Worker] Syncing audio uploads...');
  // Implementation for syncing pending uploads when back online
  // This would read from IndexedDB and upload pending files
}

async function syncFavorites() {
  console.log('[Service Worker] Syncing favorites...');
  // Implementation for syncing favorite changes when back online
}

// Push notifications
self.addEventListener('push', (event) => {
  console.log('[Service Worker] Push notification received');
  
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'SoundWave';
  const options = {
    body: data.body || 'New content available',
    icon: '/img/icon-192x192.png',
    badge: '/img/icon-72x72.png',
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
  console.log('[Service Worker] Notification clicked');
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
  console.log('[Service Worker] Message received:', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CLEAR_CACHE') {
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
  
  if (event.data && event.data.type === 'CACHE_AUDIO') {
    const { url } = event.data;
    event.waitUntil(
      caches.open(AUDIO_CACHE_NAME).then((cache) => {
        return cache.add(url);
      }).then(() => {
        event.ports[0].postMessage({ success: true });
      }).catch((error) => {
        event.ports[0].postMessage({ success: false, error: error.message });
      })
    );
  }
  
  // Cache playlist for offline access with authentication
  if (event.data && event.data.type === 'CACHE_PLAYLIST') {
    const { playlistId, audioUrls, authToken } = event.data;
    event.waitUntil(
      (async () => {
        try {
          console.log('[Service Worker] Caching playlist:', playlistId, 'with', audioUrls.length, 'tracks');
          
          if (!authToken) {
            console.error('[Service Worker] No auth token provided for playlist caching');
            event.ports[0].postMessage({ success: false, error: 'No auth token' });
            return;
          }
          
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

          // Cache playlist metadata API response (includes items)
          sendProgress('Playlist metadata', 'downloading');
          try {
            const apiCache = await caches.open(API_CACHE_NAME);
            const metadataUrl = `/api/playlist/${playlistId}/?include_items=true`;
            const metadataResponse = await fetch(metadataUrl, {
              headers: {
                'Authorization': `Token ${authToken}`,
                'Accept': 'application/json',
              }
            });
            if (metadataResponse.ok) {
              await apiCache.put(metadataUrl, metadataResponse.clone());
              results.metadata = true;
              console.log('[Service Worker] Cached playlist metadata');
            }
          } catch (err) {
            console.warn('[Service Worker] Failed to cache playlist metadata:', err);
          }
          completedItems++;
          sendProgress('Playlist metadata', 'done');
          
          // Cache all audio files in playlist with authentication
          const audioCache = await caches.open(AUDIO_CACHE_NAME);
          
          for (let i = 0; i < audioUrls.length; i++) {
            const url = audioUrls[i];
            const trackNum = i + 1;
            const trackName = `Track ${trackNum}/${audioUrls.length}`;
            
            sendProgress(trackName, 'downloading');
            
            try {
              // Create authenticated request with Token auth
              const response = await fetch(url, {
                headers: {
                  'Authorization': `Token ${authToken}`,
                  'Accept': 'audio/*',
                }
              });
              
              if (response.ok) {
                // Clone and cache the response
                await audioCache.put(url, response.clone());
                results.audioFiles.push(url);
                console.log('[Service Worker] Cached audio:', url);
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
          
          console.log('[Service Worker] Playlist caching complete:', results);
          event.ports[0].postMessage({ 
            type: 'complete',
            success: results.audioFiles.length > 0,
            metadata: results.metadata,
            cached: results.audioFiles.length,
            failed: results.failed.length,
            details: results
          });
        } catch (error) {
          console.error('[Service Worker] Playlist caching error:', error);
          event.ports[0].postMessage({ type: 'complete', success: false, error: error.message });
        }
      })()
    );
  }
  
  // Remove cached playlist
  if (event.data && event.data.type === 'REMOVE_PLAYLIST_CACHE') {
    const { playlistId, audioUrls } = event.data;
    event.waitUntil(
      Promise.all([
        // Remove playlist metadata from cache
        caches.open(API_CACHE_NAME).then((cache) => {
          return cache.delete(`/api/playlist/${playlistId}/`);
        }),
        // Remove audio files from cache (only if not used by other playlists)
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

console.log('[Service Worker] Loaded');
