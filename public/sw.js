/// <reference lib="webworker" />

// Shadow PWA — Enhanced Service Worker
// Features: caching strategies, push notifications, background sync, quick capture

const CACHE_NAME = 'shadow-v2';
const STATIC_CACHE = 'shadow-static-v2';
const DYNAMIC_CACHE = 'shadow-dynamic-v2';

const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-192.png',
  '/icon-maskable-512.png',
  '/favicon-32.png',
  '/favicon-16.png',
  '/apple-touch-icon.png',
];

// Install: pre-cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      console.log('[SW] Pre-caching static assets v2');
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== DYNAMIC_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch: routing strategy
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;

  // API requests: network-first
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstWithCache(request, DYNAMIC_CACHE));
    return;
  }

  // Static assets: cache-first
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icon') ||
    url.pathname.startsWith('/favicon') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.woff') ||
    url.pathname.endsWith('.ttf')
  ) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // HTML pages: stale-while-revalidate
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(staleWhileRevalidate(request, DYNAMIC_CACHE));
    return;
  }

  event.respondWith(networkFirstWithCache(request, DYNAMIC_CACHE));
});

// ─── Push Notifications ──────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  let data = { title: 'Shadow', body: 'Hai un promemoria!', icon: '/icon-192.png', url: '/' };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/icon-192.png',
    badge: '/icon-maskable-192.png',
    vibrate: [100, 50, 100],
    data: { url: data.url || '/' },
    actions: [
      { action: 'open', title: 'Apri' },
      { action: 'dismiss', title: 'Ignora' },
    ],
    tag: 'shadow-reminder',
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If already open, focus and navigate
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(urlToOpen);
          return client.focus();
        }
      }
      // Otherwise open new window
      return self.clients.openWindow(urlToOpen);
    })
  );
});

// ─── Background Sync ─────────────────────────────────────────────────────────

self.addEventListener('sync', (event) => {
  if (event.tag === 'shadow-quick-capture') {
    event.waitUntil(processQuickCapture());
  }
  if (event.tag === 'shadow-sync-reminders') {
    event.waitUntil(syncReminders());
  }
});

// ─── Push Subscription Change ────────────────────────────────────────────────

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const subscription = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          // applicationServerKey would come from server config in production
        });

        // Resubscribe on server
        await fetch('/api/push-subscription', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: 'default', // Will be enriched by middleware if auth token present
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.toJSON().keys?.p256dh || '',
              auth: subscription.toJSON().keys?.auth || '',
            },
          }),
        });

        console.log('[SW] Push subscription renewed');
      } catch (err) {
        console.error('[SW] Push subscription renewal failed:', err);
      }
    })()
  );
});

// ─── Share Target Handler ────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Handle share target POST — forward to quick capture
  if (url.pathname === '/' && request.method === 'POST') {
    event.respondWith(
      (async () => {
        try {
          const formData = await request.formData();
          const title = formData.get('title') || '';
          const text = formData.get('text') || '';
          const sharedUrl = formData.get('url') || '';
          const sharedText = [title, text, sharedUrl].filter(Boolean).join(' — ');

          if (sharedText) {
            // Create task directly from shared text
            await fetch('/api/tasks', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title: sharedText, status: 'inbox' }),
            });
          }

          // Redirect back to app
          return Response.redirect(`/?action=share&text=${encodeURIComponent(sharedText)}`, 303);
        } catch (err) {
          console.error('[SW] Share target error:', err);
          return Response.redirect('/?action=inbox', 303);
        }
      })()
    );
    return;
  }
});

async function processQuickCapture() {
  // Read pending captures from IndexedDB and post them
  try {
    const db = await openIndexedDB();
    const tx = db.transaction('pending-captures', 'readwrite');
    const store = tx.objectStore('pending-captures');
    const captures = await store.getAll();

    for (const capture of captures) {
      await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: capture.title, status: 'inbox' }),
      });
      await store.delete(capture.id);
    }
  } catch (err) {
    console.error('[SW] Quick capture sync error:', err);
  }
}

async function syncReminders() {
  try {
    const now = new Date().toISOString();
    const res = await fetch(`/api/tasks?reminder=true&before=${now}`);
    const data = await res.json();

    for (const task of (data.tasks || [])) {
      if (task.reminderAt && !task.reminderSent) {
        self.registration.showNotification('Shadow — Promemoria', {
          body: `È ora di: ${task.title}`,
          icon: '/icon-192.png',
          badge: '/icon-maskable-192.png',
          vibrate: [100, 50, 100],
          data: { url: `/?action=focus&taskId=${task.id}` },
          tag: `reminder-${task.id}`,
        });
        // Mark as sent
        await fetch(`/api/tasks/${task.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reminderSent: true }),
        });
      }
    }
  } catch (err) {
    console.error('[SW] Reminder sync error:', err);
  }
}

function openIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('shadow-offline', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('pending-captures')) {
        db.createObjectStore('pending-captures', { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ─── Caching Strategies ──────────────────────────────────────────────────────

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

async function networkFirstWithCache(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'Offline', offline: true }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);

  return cached || fetchPromise;
}
