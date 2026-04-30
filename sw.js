// sw.js — Bug Forge AI Service Worker
// Minimal: caches offline.html and serves it when network is unavailable.
// Does NOT cache the app (server-side rendering, API calls must be live).

const CACHE = 'bugforgeai-offline-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.add(OFFLINE_URL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Only handle navigate requests (page loads) — not API calls, assets, etc.
  if (event.request.mode !== 'navigate') return;

  event.respondWith(
    fetch(event.request).catch(() =>
      caches.open(CACHE).then(cache => cache.match(OFFLINE_URL))
    )
  );
});
