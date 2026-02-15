/**
 * PWA Service Worker - OverSeek Companion
 * 
 * Enhanced service worker with:
 * - Rich offline caching for critical routes
 * - Background sync for offline actions
 * - Periodic sync for dashboard refresh
 * - Push notifications
 * 
 * IMPORTANT: Update CACHE_VERSION on each deployment to bust caches.
 */

// Cache version - AUTOMATICALLY SET AT BUILD TIME
// The __BUILD_TIMESTAMP__ placeholder is replaced by Vite during build
const CACHE_VERSION = '__BUILD_TIMESTAMP__';
const CACHE_NAME = `overseek-${CACHE_VERSION}`;
const OFFLINE_URL = '/offline.html';
const SYNC_TAG = 'sync-offline-actions';
const PERIODIC_SYNC_TAG = 'refresh-dashboard';

/** Auto-dismiss timeout for notifications (10 minutes in ms) */
const NOTIFICATION_AUTO_DISMISS_MS = 10 * 60 * 1000;

// Assets to cache for offline app shell
const PRECACHE_ASSETS = [
    '/',
    '/m/dashboard',
    '/m/orders',
    '/m/inbox',
    '/m/customers',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/notification-icon.png',
    '/icons/notification-badge.png',
    '/offline.html'
];

// IndexedDB for offline action queue
const DB_NAME = 'overseek-offline';
const DB_VERSION = 1;
const STORE_NAME = 'pending-actions';

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            }
        };
    });
}

async function queueOfflineAction(action) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.add({
            ...action,
            timestamp: Date.now()
        });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function getPendingActions() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function clearPendingAction(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

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
    const url = new URL(request.url);

    // Skip non-GET requests
    if (request.method !== 'GET') return;

    // Skip socket.io requests
    if (request.url.includes('/socket.io/')) return;

    // Stale-while-revalidate for safe API endpoints (read-only list data)
    // These endpoints benefit from instant cached responses while updating in background
    const SWR_API_PATTERNS = [
        '/api/products',    // Product listings
        '/api/orders',      // Order listings (not individual orders)
        '/api/analytics',   // Analytics data
        '/api/dashboard',   // Dashboard widgets
    ];

    const isSWREndpoint = SWR_API_PATTERNS.some(pattern =>
        url.pathname.startsWith(pattern) && !url.pathname.match(/\/api\/\w+\/[^/]+$/) // Exclude individual resource lookups
    );

    if (request.url.includes('/api/') && isSWREndpoint) {
        event.respondWith(
            caches.open(CACHE_NAME).then(async (cache) => {
                const cachedResponse = await cache.match(request);

                // Fetch from network (always) to update cache
                const networkPromise = fetch(request).then((networkResponse) => {
                    if (networkResponse.ok) {
                        // Clone and cache the fresh response
                        cache.put(request, networkResponse.clone());
                    }
                    return networkResponse;
                }).catch(() => null);

                // Return cached response immediately if available (stale)
                // Otherwise wait for network
                if (cachedResponse) {
                    // Revalidate in background (don't await)
                    networkPromise;
                    return cachedResponse;
                }

                // No cache, wait for network
                const networkResponse = await networkPromise;
                return networkResponse || new Response(JSON.stringify({ error: 'Offline' }), {
                    status: 503,
                    headers: { 'Content-Type': 'application/json' }
                });
            })
        );
        return;
    }

    // Skip remaining API requests - always go to network
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
        request.destination === 'font' ||
        url.pathname.includes('/icons/') ||
        url.pathname.includes('/screenshots/')) {
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
    console.log('[SW] Push event received!', event);

    let data = {};
    try {
        data = event.data?.json() || {};
        console.log('[SW] Push data parsed:', data);
    } catch (e) {
        console.error('[SW] Failed to parse push data:', e);
        data = { title: 'OverSeek', body: event.data?.text() || 'You have a new notification' };
    }

    const tag = data.tag || `overseek-${Date.now()}`;

    const options = {
        body: data.body || 'You have a new notification',
        icon: '/icons/notification-icon.png',
        badge: '/icons/notification-badge.png',
        data: data.data || {},
        requireInteraction: false, // Allow auto-dismiss
        tag: tag,
        vibrate: [200, 100, 200],
        actions: data.actions || []
    };

    console.log('[SW] Showing notification:', data.title, options);

    event.waitUntil(
        self.registration.showNotification(data.title || 'OverSeek', options)
            .then(() => {
                console.log('[SW] Notification displayed successfully');
                // Schedule auto-dismiss after 10 minutes
                setTimeout(async () => {
                    try {
                        const notifications = await self.registration.getNotifications({ tag });
                        notifications.forEach(n => n.close());
                        console.log('[SW] Auto-dismissed notification:', tag);
                    } catch (e) {
                        console.error('[SW] Auto-dismiss failed:', e);
                    }
                }, NOTIFICATION_AUTO_DISMISS_MS);
            })
            .catch((err) => console.error('[SW] Failed to show notification:', err))
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

// Background sync for offline actions
self.addEventListener('sync', (event) => {
    console.log('[SW] Sync event:', event.tag);

    if (event.tag === SYNC_TAG) {
        event.waitUntil(syncOfflineActions());
    }
});

async function syncOfflineActions() {
    console.log('[SW] Syncing offline actions...');

    try {
        const actions = await getPendingActions();
        console.log('[SW] Pending actions:', actions.length);

        for (const action of actions) {
            try {
                const response = await fetch(action.url, {
                    method: action.method || 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...action.headers
                    },
                    body: action.body ? JSON.stringify(action.body) : undefined,
                    credentials: 'include'
                });

                if (response.ok) {
                    await clearPendingAction(action.id);
                    console.log('[SW] Synced action:', action.id);

                    // Notify the app about successful sync
                    const allClients = await self.clients.matchAll({ type: 'window' });
                    allClients.forEach(client => {
                        client.postMessage({
                            type: 'SYNC_COMPLETE',
                            actionId: action.id,
                            actionType: action.type
                        });
                    });
                } else {
                    console.warn('[SW] Action sync failed:', action.id, response.status);
                }
            } catch (err) {
                console.error('[SW] Error syncing action:', action.id, err);
            }
        }
    } catch (err) {
        console.error('[SW] Error getting pending actions:', err);
    }
}

// Periodic background sync for dashboard refresh
self.addEventListener('periodicsync', (event) => {
    console.log('[SW] Periodic sync event:', event.tag);

    if (event.tag === PERIODIC_SYNC_TAG) {
        event.waitUntil(refreshDashboardData());
    }
});

async function refreshDashboardData() {
    console.log('[SW] Refreshing dashboard data...');

    try {
        // Fetch key dashboard data endpoints and cache the responses
        const endpoints = [
            '/api/analytics/kpis?range=today',
            '/api/orders/summary'
        ];

        const cache = await caches.open(CACHE_NAME);

        for (const endpoint of endpoints) {
            try {
                const response = await fetch(endpoint, { credentials: 'include' });
                if (response.ok) {
                    // Store in cache for offline access
                    await cache.put(endpoint, response.clone());
                    console.log('[SW] Cached:', endpoint);
                }
            } catch (err) {
                console.warn('[SW] Failed to refresh:', endpoint);
            }
        }

        // Notify the app that data was refreshed
        const allClients = await self.clients.matchAll({ type: 'window' });
        allClients.forEach(client => {
            client.postMessage({ type: 'DASHBOARD_REFRESHED' });
        });
    } catch (err) {
        console.error('[SW] Dashboard refresh error:', err);
    }
}

// Message handler for app communication
self.addEventListener('message', (event) => {
    console.log('[SW] Message received:', event.data);

    if (event.data?.type === 'QUEUE_OFFLINE_ACTION') {
        queueOfflineAction(event.data.action)
            .then((id) => {
                event.source.postMessage({ type: 'ACTION_QUEUED', id });
                // Request background sync
                return self.registration.sync.register(SYNC_TAG);
            })
            .catch((err) => {
                console.error('[SW] Failed to queue action:', err);
            });
    }

    if (event.data?.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }

    if (event.data?.type === 'GET_VERSION') {
        event.source.postMessage({ type: 'VERSION', version: CACHE_VERSION });
    }
});
