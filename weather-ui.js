/* The official signed meteoblue widget is the only weather source. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const frame = $('meteoblue-frame');
  const stage = $('meteogram-stage');
  const slot = $('meteogram-slot');
  const dialog = $('meteogram-dialog');
  const source = frame.dataset.src;
  const MAX_AGE = 30 * 60 * 1000;
  let loadedAt = 0;
  function offlineStatus() {
    const offline = navigator.onLine === false;
    $('meteogram-status').hidden = !offline;
    $('meteogram-status').textContent = offline ? 'عرض مخطط الطقس يحتاج اتصالًا بالإنترنت. الشمس والقمر متاحان دون اتصال.' : '';
    $('sky-refresh').disabled = offline;
  }
  function active() { return $('page-weather').classList.contains('active'); }
  function release() {
    if (active()) return;
    if (dialog.open) dialog.close();
    frame.removeAttribute('src');
    loadedAt = 0;
  }
  function load(force = false) {
    offlineStatus();
    if (active()) void window.ensureAstronomy?.();
    if (!active() || navigator.onLine === false) return;
    if (!frame.hasAttribute('src') || force || Date.now() - loadedAt > MAX_AGE) {
      frame.loading = 'eager';
      // Preserve all provider-generated parameters and the signature unchanged.
      frame.src = source;
      loadedAt = Date.now();
    }
  }
  function move(target) {
    // Modern browsers can keep the iframe alive when it moves into the dialog.
    if (target.moveBefore) target.moveBefore(stage, null);
    else target.append(stage);
  }
  window.loadWeather = load;
  new MutationObserver(release).observe($('page-weather'), { attributes: true, attributeFilter: ['class'] });
  // Remove cached data from the retired provider, without touching app preferences.
  try {
    for (const key of ['faifaWeatherECMWF1', 'faifaWeatherCalmV3']) localStorage.removeItem(key);
  } catch (_) { /* The embedded forecast works without local storage. */ }
  $('sky-refresh').addEventListener('click', () => load(true));
  $('meteogram-expand').addEventListener('click', () => {
    if (dialog.open) return;
    move($('meteogram-large'));
    dialog.showModal();
    load();
  });
  $('meteogram-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    move(slot);
    $('meteogram-expand').focus({ preventScroll: true });
  });
  dialog.addEventListener('click', (event) => {
    const rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
  });
  window.addEventListener('online', () => load(true));
  window.addEventListener('offline', offlineStatus);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  document.addEventListener('DOMContentLoaded', () => { offlineStatus(); load(); });
  setInterval(() => { if (!document.hidden) load(); }, MAX_AGE);
})();
