// sw.js — minimal service worker.
// Its main purpose here is to satisfy Android/Chrome's installability
// requirement (a registered service worker with a fetch handler) so the
// site can be installed as a real standalone app, not just a bookmark
// shortcut. It does light caching of the core page as a helpful side
// effect, but that's secondary to unlocking the install prompt itself.

const CACHE_NAME = 'redleaf-study-v1';
const CORE_ASSETS = ['/'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Network-first: always try to get the freshest version of the site,
  // only falling back to cache if the network genuinely fails (e.g. briefly offline).
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
