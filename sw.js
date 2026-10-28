const CACHE_NAME = 'nujoom-faifa-pwa-v6-00-fast2-embed600';
const APP_SHELL = ['/', '/start.html', '/assets/fonts/cairo-arabic.woff2', '/app-base.css?v=6.00-fast2', '/app-runtime.js?v=6.00-fast2', '/data-credits.html', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png', '/assets/brand-mark.svg', '/prayer-ui.js?v=6.00-fast2', '/prayer-shared.mjs', '/weather-ui.css?v=6.00-embed600', '/weather-ui.js?v=6.00-fast2', '/sky-astronomy.js?v=6.00-fast2', '/app-refinements.js?v=6.00-fast2', '/qibla-ui.js?v=6.00-fast2', '/qibla-math.mjs', '/assets/vendor/suncalc/suncalc.js', '/assets/vendor/astronomy-engine/astronomy.browser.min.js'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const previous = keys.filter(key => key.startsWith('nujoom-faifa-pwa-') && key !== CACHE_NAME);
    await Promise.all(previous.map(key => caches.delete(key)));
    await self.clients.claim();
    if (previous.length) {
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        const target = new URL(client.url);
        if (!['/', '/index.html'].includes(target.pathname) || target.searchParams.get('updated') === CACHE_NAME) continue;
        target.searchParams.set('updated', CACHE_NAME);
        // Do not await a navigation that may itself need this activation to finish.
        void client.navigate(target.href).catch(() => {});
      }
    }
  })());
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
