/* Optional external services must never block opening the application. */
(() => {
  'use strict';
  const requests = new Map();
  function script(url) {
    if (requests.has(url)) return requests.get(url);
    const pending = new Promise((resolve, reject) => {
      const node = document.createElement('script');
      node.src = url; node.async = true;
      const timer = setTimeout(() => {
        node.remove(); requests.delete(url); reject(new Error('External script timeout'));
      }, 12000);
      node.onload = () => { clearTimeout(timer); resolve(); };
      node.onerror = () => { clearTimeout(timer); node.remove(); requests.delete(url); reject(new Error('External script unavailable')); };
      document.head.append(node);
    });
    requests.set(url, pending);
    return pending;
  }
  window.ensurePdfLibraries = () => Promise.all([
    window.html2canvas ? Promise.resolve() : script('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'),
    window.jspdf ? Promise.resolve() : script('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
  ]);
  window.loadPushSdk = () => {
    if (window.__oneSignalInstance || !window.isMobilePushDevice()) return Promise.resolve();
    return script('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js').catch(() => null);
  };
  window.ensureAstronomy = () => {
    const update = () => window.FaifaAstronomy?.update();
    return Promise.allSettled([
      window.SunCalc ? Promise.resolve() : script('/assets/vendor/suncalc/suncalc.js').then(update),
      window.Astronomy ? Promise.resolve() : script('/assets/vendor/astronomy-engine/astronomy.browser.min.js').then(update)
    ]).then(update);
  };
  if ('serviceWorker' in navigator) {
    let lastUpdate = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || Date.now() - lastUpdate < 5 * 60 * 1000) return;
      lastUpdate = Date.now();
      void navigator.serviceWorker.getRegistration('/').then(registration => registration?.update()).catch(() => {});
    });
  }
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      if ('Notification' in window && Notification.permission === 'granted') {
        try { if (localStorage.getItem('notificationsEnabled') !== 'false') void window.loadPushSdk(); } catch (_) { /* Optional service. */ }
      }
    }, 1200);
  });
})();
