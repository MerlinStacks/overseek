/**
 * PWA Service Worker - OverSeek Companion
 * 
 * Handles push notifications and offline caching for the PWA.
 * 
 * IMPORTANT: Update CACHE_VERSION on each deployment to bust caches.
 */

// Cache version - UPDATE THIS ON EVERY DEPLOYMENT
const CACHE_VERSION = '2026-01-13-v2';
const CACHE_NAME = `overseek-${CACHE_VERSION}`;
const OFFLINE_URL = '/offline.html';

// Assets to cache for offline app shell
const PRECACHE_ASSETS = [
    '/',
    '/m/dashboard',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png'
];

// Install event - cache app shell
self.addEventListener('install', (event) => {
    console.log('[SW] Installing version:', CACHE_VERSION);
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] Precaching app shell');
            return cache.addAll(PRECACHE_ASSETS);
        }).then(() => {
            // Activate immediately - skip waiting for old SW to stop
            return self.skipWaiting();
        })
    );
});

// Activate event - clean ALL old caches and take control
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating version:', CACHE_VERSION);
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name.startsWith('overseek-') && name !== CACHE_NAME)
                    .map((name) => {
                        console.log('[SW] Deleting old cache:', name);
                        return caches.delete(name);
                    })
            );
        }).then(() => {
            // Notify all open clients about the update
            return self.clients.matchAll({ type: 'window' }).then((clients) => {
                clients.forEach((client) => {
                    client.postMessage({ type: 'SW_UPDATED', version: CACHE_VERSION });
                });
            });
        }).then(() => {
            // Take control immediately
            return self.clients.claim();
        })
    );
});

// Fetch event - network-first with cache fallback for navigation
self.addEventListener('fetch', (event) => {
    const { request } = event;

    // Skip non-GET requests
    if (request.method !== 'GET') return;

    // Skip API requests - always go to network
    if (request.url.includes('/api/')) return;

    // Navigation requests - network first, cache fallback
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    // Cache successful navigation responses
                    if (response.ok) {
                        const cloned = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(request, cloned);
                        });
                    }
                    return response;
                })
                .catch(() => {
                    // Return cached version or offline page
                    return caches.match(request).then((cached) => {
                        return cached || caches.match(OFFLINE_URL);
                    });
                })
        );
        return;
    }

    // Static assets - cache first, network fallback
    if (request.destination === 'image' ||
        request.destination === 'style' ||
        request.destination === 'script' ||
        request.url.includes('/icons/')) {
        event.respondWith(
            caches.match(request).then((cached) => {
                if (cached) return cached;

                return fetch(request).then((response) => {
                    if (response.ok) {
                        const cloned = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(request, cloned);
                        });
                    }
                    return response;
                });
            })
        );
        return;
    }
});

// Push notification handler
self.addEventListener('push', (event) => {
    const data = event.data?.json() || {};

    const options = {
        body: data.body || 'You have a new notification',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-72.png',
        data: data.data || {},
        requireInteraction: true,
        tag: data.tag || 'overseek-notification',
        vibrate: [200, 100, 200],
        actions: data.actions || []
    };

    event.waitUntil(
        self.registration.showNotification(data.title || 'OverSeek', options)
    );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    // Handle action buttons
    const action = event.action;
    let url = event.notification.data?.url || '/m/dashboard';

    if (action === 'view_order' && event.notification.data?.orderId) {
        url = `/m/orders/${event.notification.data.orderId}`;
    } else if (action === 'view_inbox') {
        url = '/m/inbox';
    }

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            // Check if app is already open
            for (const client of windowClients) {
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    client.focus();
                    client.navigate(url);
                    return;
                }
            }
            // Open new window if app not open
            if (clients.openWindow) {
                return clients.openWindow(url);
            }
        })
    );
});

// Background sync for offline actions (future enhancement)
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-orders') {
        event.waitUntil(syncOfflineOrders());
    }
});

async function syncOfflineOrders() {
    // Placeholder for future offline order sync
    console.log('[SW] Syncing offline orders');
}
