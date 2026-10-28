const CACHE_NAME = 'nujoom-faifa-pwa-v6-00-fast1';
const APP_SHELL = ['/', '/app-base.css?v=6.00-fast1', '/app-runtime.js?v=6.00-fast1', '/data-credits.html', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png', '/assets/brand-mark.svg', '/prayer-ui.js?v=6.00-fast1', '/prayer-shared.mjs', '/weather-ui.css?v=6.00-fast1', '/weather-ui.js?v=6.00-fast1', '/sky-astronomy.js?v=6.00-fast1', '/app-refinements.js?v=6.00-fast1', '/qibla-ui.js?v=6.00-fast1', '/qibla-math.mjs', '/assets/vendor/suncalc/suncalc.js', '/assets/vendor/astronomy-engine/astronomy.browser.min.js'];

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
  if (url.pathname.startsWith('/.netlify/functions/')) return;

  if (request.mode === 'navigate') {
    const pageKey = url.pathname === '/index.html' ? '/' : url.pathname;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const refresh = fetch(request, { signal: controller.signal }).then(async response => {
      if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(pageKey, response.clone());
      }
      return response;
    }).catch(() => null).finally(() => clearTimeout(timer));
    event.waitUntil(refresh.then(() => undefined));
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => (await cache.match(pageKey)) || (await refresh) ||
        new Response('تعذر الاتصال. أعد تحميل الصفحة عند عودة الشبكة.', {status: 503, headers: {'content-type': 'text/plain; charset=utf-8'}}))
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
