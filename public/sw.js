/// <reference lib="webworker" />

// Shadow PWA — Service Worker
// Features: caching strategies, share target.

// v4 (2026-06-12, W7 body doubling): bump obbligatorio a ogni release con CSS/JS
// nuovi — staleWhileRevalidate servirebbe ai client i bundle vecchi (classi
// Tailwind nuove assenti → layout rotto, visto in QA W7).
// v5 (2026-06-12, Task 42): card tool gestione task + error UX in ChatView.
// v6 (2026-06-14, Task 43): banner review serale in ChatView + fix loop check-in.
// v7→v8 (2026-06-16, Task 55): gamification "Il tuo cielo" (SkyView + tab nav).
// v9 (2026-07-02, Task 65): rimossi i percorsi morti — push handler senza sender,
// pushsubscriptionchange, syncReminders (API inesistente), quick-capture offline
// (sync mai registrato dal client). Restano caching e share target.
// v10 (2026-07-02, Task 67 A/D21): share target onesto — l'esito del POST
// /api/tasks decide il redirect (saved=1 solo a 2xx; altrimenti il testo
// viaggia in ?text= e il client lo recupera, mai perso in silenzio).
// Task 70 (N53): rimossa la costante morta CACHE_NAME='shadow-v2' — le cache
// reali sono STATIC_CACHE/DYNAMIC_CACHE (nessun bump: nessun asset cambia).
// v11 (2026-07-07, Task 71 K/N11): il fallback share dichiara la troncatura
// (&truncated=1 quando il testo supera i 500 char del reader) — il client
// mostra la nota invece di accorciare in silenzio. Bump: ChatView cambia.
// v12 (2026-07-08, Task 72 B2): contratto di ingestione — il POST dichiara
// source:'share' e separa il titolo dal riferimento (sourceRef = URL, o testo
// integrale se il titolo e' troncato). Il fallback ?text= resta tutto-unito.
// Bump: cambiano i bundle client del Task 72 (capture sheet, bootstrap nativo).
const STATIC_CACHE = 'shadow-static-v12';
const DYNAMIC_CACHE = 'shadow-dynamic-v12';

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

  // Navigation requests bypass the SW so middleware always evaluates
  // fresh auth/onboarding state. Caching HTML caused stale redirect
  // loops after the onboardingComplete flag flipped server-side.
  if (request.mode === 'navigate' ||
      (request.method === 'GET' &&
       request.headers.get('accept')?.includes('text/html'))) {
    return;
  }

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

// ─── Share Target Handler ────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Handle share target POST (Task 67 A/D21: esito onesto).
  // Contratto: "saved" SOLO se /api/tasks ha risposto 2xx; su qualunque
  // fallimento (401 sessione scaduta, 5xx, rete) il testo condiviso viaggia
  // nel redirect (?text=) e il client lo recupera (precompila la chat,
  // sopravvive al login via sessionStorage) — mai perso in silenzio.
  if (url.pathname === '/' && request.method === 'POST') {
    event.respondWith(
      (async () => {
        let sharedText = '';
        try {
          const formData = await request.formData();
          const title = String(formData.get('title') || '');
          const text = String(formData.get('text') || '');
          const sharedUrl = String(formData.get('url') || '');
          // Il fallback (?text=) viaggia ancora con tutto unito: nulla si perde.
          sharedText = [title, text, sharedUrl].filter(Boolean).join(' — ');

          if (!sharedText) {
            return Response.redirect('/?action=inbox', 303);
          }

          // Task 72 (B2): contratto di ingestione — l'URL non inquina il
          // titolo (va in sourceRef); se il testo eccede il cap del titolo,
          // l'integrale sopravvive in sourceRef (cap server 2000). La deadline
          // la parsa il server (euristiche cheap, zero LLM).
          const fullText = [title, text].filter(Boolean).join(' — ');
          const taskTitle = (fullText || sharedUrl).slice(0, 500);
          let sourceRef = sharedUrl;
          if (!sourceRef && fullText.length > 500) sourceRef = fullText.slice(0, 2000);

          const res = await fetch('/api/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: taskTitle,
              status: 'inbox',
              source: 'share',
              sourceRef,
            }),
          });

          if (res.ok) {
            return Response.redirect('/?action=share&saved=1', 303);
          }
          console.error('[SW] Share target: /api/tasks rispose', res.status);
        } catch (err) {
          console.error('[SW] Share target error:', err);
        }
        // Fallimento (status non-2xx o exception): il testo non è stato
        // salvato — lo consegniamo al client. Cap difensivo: allineato al
        // limite del reader ?draft= di ChatView (500 char). Task 71 (K/N11):
        // solo il SW conosce la lunghezza originale — il flag truncated=1
        // dice al client di mostrare la nota di troncatura.
        const truncated = sharedText.length > 500 ? '&truncated=1' : '';
        return Response.redirect(
          `/?action=share&text=${encodeURIComponent(sharedText.slice(0, 500))}${truncated}`,
          303,
        );
      })()
    );
    return;
  }
});

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
