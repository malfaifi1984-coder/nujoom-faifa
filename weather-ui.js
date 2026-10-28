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
  const zone = 'Asia/Riyadh';
  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const weekday = new Intl.DateTimeFormat('ar-SA', { timeZone: zone, weekday: 'long' });
  const dateLabel = new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { timeZone: zone, day: 'numeric', month: 'short' });
  let dayTimer;
  function renderDayGuide() {
    const key = dayKey.format(new Date()), guide = $('meteogram-days');
    if (guide.dataset.day === key) return;
    const noon = new Date(`${key}T12:00:00+03:00`).getTime();
    guide.replaceChildren(...Array.from({ length: 5 }, (_, index) => {
      const date = new Date(noon + index * 86400000);
      const item = document.createElement('div'); item.setAttribute('role', 'listitem');
      const title = document.createElement('strong'); title.textContent = weekday.format(date);
      const stamp = document.createElement('time'); stamp.dateTime = dayKey.format(date); stamp.textContent = dateLabel.format(date);
      if (index === 0) item.setAttribute('aria-current', 'date');
      item.append(title, stamp); return item;
    }));
    guide.dataset.day = key;
    clearTimeout(dayTimer);
    dayTimer = setTimeout(renderDayGuide, new Date(`${key}T00:00:00+03:00`).getTime() + 86400000 - Date.now() + 20);
  }

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
    renderDayGuide();
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
