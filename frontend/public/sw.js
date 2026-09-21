/**
 * FAHMID NURSERY & PRIMARY SCHOOL
 * Service Worker - Production PWA
 * 
 * @version 2.0.4
 * @date 2026-02-15
 */

'use strict';

const CACHE_VERSION = 'fahmid-pwa-v3.0.0';
const CACHE_NAME = `${CACHE_VERSION}`;
const MAX_CACHE_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

// Critical assets to cache immediately
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/login',
  '/offline.html',
  '/manifest.json',
  '/styles.css',
  '/script.js',
  '/IMG_4628.jpeg'
];

// Runtime cache for portal pages
const RUNTIME_CACHE_URLS = [
  '/portal.html',
  '/admin.html',
  '/teacher.html',
  '/pupil.html',
  '/about.html',
  '/academics.html',
  '/admissions.html',
  '/school-life.html',
  '/gallery.html',
  '/news.html',
  '/contact.html'
];

// External domains to bypass
const EXTERNAL_DOMAINS = [
  'firebasestorage.googleapis.com',
  'firebaseapp.com',
  'googleapis.com',
  'gstatic.com',
  'cdnjs.cloudflare.com',
  'unpkg.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

/**
 * Install Event - Cache critical assets
 */
self.addEventListener('install', event => {
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(PRECACHE_ASSETS.map(url => new Request(url, {cache: 'reload'})));
      })
      .then(() => {
        return self.skipWaiting();
      })
      .catch(error => {
        console.error('[SW] Precache failed:', error);
      })
  );
});

/**
 * Activate Event - Clean old caches
 */
self.addEventListener('activate', event => {
  console.log('[SW] Activating version:', CACHE_VERSION);
  
  event.waitUntil(
    Promise.all([
      // Clean old caches
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName);
            }
          })
        );
      }),
      // Take control immediately
      self.clients.claim()
    ]).then(() => {
    })
  );
});

/**
 * Fetch Event - Network-first with cache fallback
 */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip non-GET requests
  if (request.method !== 'GET') return;
  
  // Skip external domains
  if (EXTERNAL_DOMAINS.some(domain => url.hostname.includes(domain))) {
    return;
  }
  
  // Skip Chrome extension requests
  if (url.protocol === 'chrome-extension:') return;
  
  // Handle HTML pages - Network-first strategy
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          // Cache successful HTML responses
          if (response.ok && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Fallback to cache
          return caches.match(request)
            .then(cachedResponse => {
              if (cachedResponse) {
                return cachedResponse;
              }
              // Last resort: offline page
              return caches.match('/offline.html');
            });
        })
    );
    return;
  }
  
  // Handle static assets - Cache-first with network update
  if (
    request.url.endsWith('.css') ||
    request.url.endsWith('.js') ||
    request.url.endsWith('.jpeg') ||
    request.url.endsWith('.jpg') ||
    request.url.endsWith('.png') ||
    request.url.endsWith('.svg') ||
    request.url.endsWith('.webp') ||
    request.url.endsWith('.ico') ||
    request.url.endsWith('.woff') ||
    request.url.endsWith('.woff2')
  ) {
    event.respondWith(
      caches.match(request)
        .then(cachedResponse => {
          // Return cached version immediately
          if (cachedResponse) {
            // Update cache in background
            fetch(request).then(response => {
              if (response.ok && response.status === 200) {
                caches.open(CACHE_NAME).then(cache => {
                  cache.put(request, response);
                });
              }
            }).catch(() => {});
            
            return cachedResponse;
          }
          
          // Not in cache, fetch from network
          return fetch(request).then(response => {
            if (response.ok && response.status === 200) {
              const responseClone = response.clone();
              caches.open(CACHE_NAME).then(cache => {
                cache.put(request, responseClone);
              });
            }
            return response;
          });
        })
    );
    return;
  }
  
  // For everything else, network-only (API calls, Firebase, etc.)
  event.respondWith(fetch(request));
});

/**
 * Message Event - Handle cache updates
 */
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CACHE_URLS') {
    event.waitUntil(
      caches.open(CACHE_NAME).then(cache => {
        return cache.addAll(event.data.urls);
      })
    );
  }
});

/**
 * Background Sync - Queue failed requests
 */
self.addEventListener('sync', event => {
  
  if (event.tag === 'sync-data') {
    event.waitUntil(syncPendingData());
  }
});

async function syncPendingData() {
  // Implement sync logic as needed
  return Promise.resolve();
}

/**
 * Push Notifications
 */
self.addEventListener('push', event => {
  
  const title = 'Fahmid School';
  const options = {
    body: event.data ? event.data.text() : 'New notification',
    icon: '/IMG_4628.jpeg',
    badge: '/IMG_4628.jpeg',
    vibrate: [200, 100, 200],
    tag: 'fahmid-notification',
    requireInteraction: false
  };
  
  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

/**
 * Notification Click
 */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  event.waitUntil(
    clients.openWindow('/')
  );
});

/**
 * Periodic cleanup of old cache entries
 */
async function cleanupOldCache() {
  const cache = await caches.open(CACHE_NAME);
  const requests = await cache.keys();
  const now = Date.now();
  
  for (const request of requests) {
    const response = await cache.match(request);
    if (response) {
      const dateHeader = response.headers.get('date');
      if (dateHeader) {
        const age = now - new Date(dateHeader).getTime();
        if (age > MAX_CACHE_AGE) {
          await cache.delete(request);
        }
      }
    }
  }
}

// Run cleanup periodically
setInterval(() => {
  cleanupOldCache().catch(err => console.error('[SW] Cleanup error:', err));
}, 24 * 60 * 60 * 1000); // Once per day
