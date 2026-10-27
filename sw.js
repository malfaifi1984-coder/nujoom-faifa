const CACHE_NAME = 'nujoom-faifa-pwa-v6-00-simple3';
const APP_SHELL = ['/', '/data-credits.html', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png', '/assets/brand-mark.svg', '/prayer-ui.js?v=6.00-simple3', '/prayer-shared.mjs', '/weather-ui.css?v=6.00-simple3', '/weather-ui.js?v=6.00-simple3', '/sky-astronomy.js?v=6.00-simple3', '/app-refinements.js?v=6.00-simple3', '/qibla-ui.js?v=6.00-simple3', '/qibla-math.mjs', '/assets/vendor/suncalc/suncalc.js'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key.startsWith('nujoom-faifa-pwa-') && key !== CACHE_NAME)
          .map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/push/onesignal/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put('/', copy));
        return response;
      }).catch(() => caches.match('/'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      }
      return response;
    }))
  );
});
