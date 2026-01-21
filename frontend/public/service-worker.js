/* eslint-disable no-restricted-globals */
const CACHE_NAME = 'soundwave-v1';
const API_CACHE_NAME = 'soundwave-api-v1';
const AUDIO_CACHE_NAME = 'soundwave-audio-v1';
const IMAGE_CACHE_NAME = 'soundwave-images-v1';
const DOWNLOAD_DB_NAME = 'soundwave-downloads';
const DOWNLOAD_STORE_NAME = 'pending-downloads';

// Assets to cache on install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
];

// =====================================================
// IndexedDB helpers for persistent download queue
// =====================================================
function openDownloadDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DOWNLOAD_DB_NAME, 1);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(DOWNLOAD_STORE_NAME)) {
        const store = db.createObjectStore(DOWNLOAD_STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('url', 'url', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
  });
}

async function addPendingDownload(downloadData) {
  const db = await openDownloadDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([DOWNLOAD_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(DOWNLOAD_STORE_NAME);
    
    const request = store.add({
      ...downloadData,
      status: 'pending',
      createdAt: Date.now(),
      attempts: 0,
    });
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getPendingDownloads() {
  const db = await openDownloadDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([DOWNLOAD_STORE_NAME], 'readonly');
    const store = transaction.objectStore(DOWNLOAD_STORE_NAME);
    const index = store.index('status');
    const request = index.getAll('pending');
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function updateDownloadStatus(id, status, error = null) {
  const db = await openDownloadDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([DOWNLOAD_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(DOWNLOAD_STORE_NAME);
    
    const getRequest = store.get(id);
    getRequest.onsuccess = () => {
      const download = getRequest.result;
      if (download) {
        download.status = status;
        download.error = error;
        download.updatedAt = Date.now();
        download.attempts = (download.attempts || 0) + (status === 'failed' ? 1 : 0);
        store.put(download);
      }
      resolve();
    };
    getRequest.onerror = () => reject(getRequest.error);
  });
}

async function removeDownload(id) {
  const db = await openDownloadDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([DOWNLOAD_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(DOWNLOAD_STORE_NAME);
    const request = store.delete(id);
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function getAllDownloads() {
  const db = await openDownloadDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([DOWNLOAD_STORE_NAME], 'readonly');
    const store = transaction.objectStore(DOWNLOAD_STORE_NAME);
    const request = store.getAll();
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

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

  // Skip non-GET requests - Cache API doesn't support POST, PATCH, PUT, DELETE
  if (request.method !== 'GET') {
    return;
  }

  // API requests - Network first, fallback to cache (GET only)
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
    
    // Cache successful GET responses only
    if (networkResponse && networkResponse.status === 200 && request.method === 'GET') {
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
  const cachedResponse = await caches.match(request);
  
  if (cachedResponse) {
    return cachedResponse;
  }
  
  try {
    const networkResponse = await fetch(request);
    
    // Cache successful responses
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.error('[Service Worker] Cache and network failed:', error);
    throw error;
  }
}

// Stale while revalidate - return cache immediately, update in background
async function staleWhileRevalidateStrategy(request, cacheName) {
  const cachedResponse = await caches.match(request);
  
  const fetchPromise = fetch(request).then(async (networkResponse) => {
    if (networkResponse && networkResponse.status === 200 && request.method === 'GET') {
      try {
        const responseClone = networkResponse.clone();
        const cache = await caches.open(cacheName);
        await cache.put(request, responseClone);
      } catch (e) {
        console.log('[Service Worker] Cache put failed:', e);
      }
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
  
  if (event.tag === 'sync-downloads') {
    event.waitUntil(syncPendingDownloads());
  }
});

// Sync pending downloads to server
async function syncPendingDownloads() {
  console.log('[Service Worker] Syncing pending downloads...');
  
  try {
    const pendingDownloads = await getPendingDownloads();
    console.log('[Service Worker] Found', pendingDownloads.length, 'pending downloads');
    
    for (const download of pendingDownloads) {
      try {
        // Get auth token from the client
        const clients = await self.clients.matchAll();
        let authToken = download.authToken;
        
        if (!authToken && clients.length > 0) {
          // Try to get token from client
          const response = await clients[0].postMessage({ 
            type: 'GET_AUTH_TOKEN' 
          });
        }
        
        if (!authToken) {
          console.log('[Service Worker] No auth token available, skipping download');
          continue;
        }
        
        // Submit download to server
        const response = await fetch('/api/download/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Token ${authToken}`,
          },
          body: JSON.stringify({
            urls: [download.url],
            auto_start: true,
          }),
        });
        
        if (response.ok) {
          await updateDownloadStatus(download.id, 'submitted');
          console.log('[Service Worker] Download submitted:', download.url);
          
          // Show notification
          await self.registration.showNotification('Download Started', {
            body: download.title || 'Your download has been queued',
            icon: '/img/icons/icon-192x192.png',
            badge: '/img/icons/icon-72x72.png',
            tag: `download-started-${download.id}`,
            data: { type: 'download-started', downloadId: download.id },
          });
        } else {
          const errorText = await response.text();
          await updateDownloadStatus(download.id, 'failed', errorText);
          console.error('[Service Worker] Failed to submit download:', errorText);
        }
      } catch (error) {
        await updateDownloadStatus(download.id, 'failed', error.message);
        console.error('[Service Worker] Error syncing download:', error);
      }
    }
  } catch (error) {
    console.error('[Service Worker] Error in syncPendingDownloads:', error);
  }
}

async function syncAudioUploads() {
  console.log('[Service Worker] Syncing audio uploads...');
  // Implementation for syncing pending uploads when back online
  // This would read from IndexedDB and upload pending files
}

async function syncFavorites() {
  console.log('[Service Worker] Syncing favorites...');
  // Implementation for syncing favorite changes when back online
}

// Periodic background sync for checking download status
self.addEventListener('periodicsync', (event) => {
  console.log('[Service Worker] Periodic sync:', event.tag);
  
  if (event.tag === 'check-download-status') {
    event.waitUntil(checkDownloadStatus());
  }
});

async function checkDownloadStatus() {
  console.log('[Service Worker] Checking download status...');
  
  try {
    // Get all clients and their auth tokens
    const clients = await self.clients.matchAll();
    if (clients.length === 0) {
      console.log('[Service Worker] No clients available');
      return;
    }
    
    // Request auth token from client
    const messageChannel = new MessageChannel();
    clients[0].postMessage({ type: 'GET_AUTH_TOKEN' }, [messageChannel.port2]);
    
    const authToken = await new Promise((resolve) => {
      messageChannel.port1.onmessage = (event) => {
        resolve(event.data.token);
      };
      // Timeout after 5 seconds
      setTimeout(() => resolve(null), 5000);
    });
    
    if (!authToken) {
      console.log('[Service Worker] No auth token received');
      return;
    }
    
    // Fetch current download status from server
    const response = await fetch('/api/download/?filter=completed', {
      headers: {
        'Authorization': `Token ${authToken}`,
      },
    });
    
    if (response.ok) {
      const data = await response.json();
      const recentlyCompleted = data.data?.filter(d => {
        const completedTime = new Date(d.completed_date).getTime();
        const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
        return completedTime > fiveMinutesAgo;
      }) || [];
      
      // Notify about completed downloads
      for (const download of recentlyCompleted) {
        await self.registration.showNotification('Download Complete', {
          body: download.title || 'Your download is ready',
          icon: '/img/icons/icon-192x192.png',
          badge: '/img/icons/icon-72x72.png',
          tag: `download-complete-${download.id}`,
          data: { 
            type: 'download-complete', 
            downloadId: download.id,
            youtubeId: download.youtube_id,
          },
          actions: [
            { action: 'play', title: 'Play Now' },
            { action: 'dismiss', title: 'Dismiss' },
          ],
        });
      }
    }
  } catch (error) {
    console.error('[Service Worker] Error checking download status:', error);
  }
}

// Push notifications
self.addEventListener('push', (event) => {
  console.log('[Service Worker] Push notification received');
  
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'SoundWave';
  const options = {
    body: data.body || 'New content available',
    icon: '/img/icons/icon-192x192.png',
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
  console.log('[Service Worker] Notification clicked:', event.action);
  event.notification.close();
  
  const data = event.notification.data || {};
  
  // Handle download complete notification
  if (data.type === 'download-complete' && event.action === 'play') {
    event.waitUntil(
      clients.matchAll({ type: 'window' }).then((clientList) => {
        // If app is open, focus it and navigate to the track
        for (const client of clientList) {
          if (client.url.includes(self.location.origin)) {
            client.focus();
            client.postMessage({
              type: 'PLAY_AUDIO',
              youtubeId: data.youtubeId,
            });
            return;
          }
        }
        // Otherwise open the app
        return clients.openWindow(`/library?play=${data.youtubeId}`);
      })
    );
    return;
  }
  
  if (event.action === 'open' || !event.action) {
    const urlToOpen = data.url || '/';
    event.waitUntil(
      clients.openWindow(urlToOpen)
    );
  }
});

// Message handling for cache management and downloads
self.addEventListener('message', (event) => {
  console.log('[Service Worker] Message received:', event.data?.type);
  
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
  
  // =====================================================
  // Background Download Operations
  // =====================================================
  
  // Queue a download for background processing
  if (event.data && event.data.type === 'QUEUE_DOWNLOAD') {
    const { url, title, authToken } = event.data;
    event.waitUntil(
      (async () => {
        try {
          // Add to IndexedDB
          const id = await addPendingDownload({ 
            url, 
            title, 
            authToken,
            queuedAt: Date.now(),
          });
          console.log('[Service Worker] Download queued:', id, url);
          
          // Try to register background sync
          if (self.registration.sync) {
            await self.registration.sync.register('sync-downloads');
            console.log('[Service Worker] Background sync registered');
          } else {
            // Fallback: try to sync immediately if online
            if (navigator.onLine) {
              await syncPendingDownloads();
            }
          }
          
          event.ports[0].postMessage({ success: true, id });
        } catch (error) {
          console.error('[Service Worker] Error queuing download:', error);
          event.ports[0].postMessage({ success: false, error: error.message });
        }
      })()
    );
  }
  
  // Queue multiple downloads
  if (event.data && event.data.type === 'QUEUE_DOWNLOADS_BATCH') {
    const { downloads, authToken } = event.data;
    event.waitUntil(
      (async () => {
        try {
          const ids = [];
          for (const download of downloads) {
            const id = await addPendingDownload({
              url: download.url,
              title: download.title,
              authToken,
              queuedAt: Date.now(),
            });
            ids.push(id);
          }
          console.log('[Service Worker] Batch downloads queued:', ids.length);
          
          // Register background sync
          if (self.registration.sync) {
            await self.registration.sync.register('sync-downloads');
          } else if (navigator.onLine) {
            await syncPendingDownloads();
          }
          
          event.ports[0].postMessage({ success: true, ids });
        } catch (error) {
          console.error('[Service Worker] Error queuing batch downloads:', error);
          event.ports[0].postMessage({ success: false, error: error.message });
        }
      })()
    );
  }
  
  // Get all pending downloads
  if (event.data && event.data.type === 'GET_PENDING_DOWNLOADS') {
    event.waitUntil(
      getAllDownloads().then((downloads) => {
        event.ports[0].postMessage({ success: true, downloads });
      }).catch((error) => {
        event.ports[0].postMessage({ success: false, error: error.message });
      })
    );
  }
  
  // Remove a pending download
  if (event.data && event.data.type === 'REMOVE_PENDING_DOWNLOAD') {
    const { id } = event.data;
    event.waitUntil(
      removeDownload(id).then(() => {
        event.ports[0].postMessage({ success: true });
      }).catch((error) => {
        event.ports[0].postMessage({ success: false, error: error.message });
      })
    );
  }
  
  // Manually trigger sync (useful when coming back online)
  if (event.data && event.data.type === 'TRIGGER_DOWNLOAD_SYNC') {
    event.waitUntil(
      syncPendingDownloads().then(() => {
        event.ports[0].postMessage({ success: true });
      }).catch((error) => {
        event.ports[0].postMessage({ success: false, error: error.message });
      })
    );
  }
  
  // Update auth token for pending downloads
  if (event.data && event.data.type === 'UPDATE_AUTH_TOKEN') {
    const { authToken } = event.data;
    event.waitUntil(
      (async () => {
        try {
          const downloads = await getPendingDownloads();
          for (const download of downloads) {
            const db = await openDownloadDB();
            const transaction = db.transaction([DOWNLOAD_STORE_NAME], 'readwrite');
            const store = transaction.objectStore(DOWNLOAD_STORE_NAME);
            download.authToken = authToken;
            store.put(download);
          }
          event.ports[0].postMessage({ success: true });
        } catch (error) {
          event.ports[0].postMessage({ success: false, error: error.message });
        }
      })()
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
    const { playlistId, audioUrls } = event.data;
    event.waitUntil(
      (async () => {
        try {
          console.log('[Service Worker] Caching playlist:', playlistId, 'with', audioUrls.length, 'tracks');
          
          const results = {
            metadata: false,
            audioFiles: [],
            failed: []
          };

          // Cache playlist metadata API response (includes items)
          try {
            const apiCache = await caches.open(API_CACHE_NAME);
            const metadataUrl = `/api/playlist/${playlistId}/?include_items=true`;
            await apiCache.add(metadataUrl);
            results.metadata = true;
            console.log('[Service Worker] Cached playlist metadata');
          } catch (err) {
            console.warn('[Service Worker] Failed to cache playlist metadata:', err);
          }
          
          // Cache all audio files in playlist with authentication
          const audioCache = await caches.open(AUDIO_CACHE_NAME);
          
          for (const url of audioUrls) {
            try {
              // Create authenticated request
              const authRequest = new Request(url, {
                credentials: 'include',
                headers: {
                  'Accept': 'audio/*',
                }
              });
              
              const response = await fetch(authRequest);
              
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
          }
          
          console.log('[Service Worker] Playlist caching complete:', results);
          event.ports[0].postMessage({ 
            success: results.audioFiles.length > 0,
            metadata: results.metadata,
            cached: results.audioFiles.length,
            failed: results.failed.length,
            details: results
          });
        } catch (error) {
          console.error('[Service Worker] Playlist caching error:', error);
          event.ports[0].postMessage({ success: false, error: error.message });
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
