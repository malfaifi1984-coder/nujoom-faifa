/* Forecasts load only when Weather is visible; opening the app never waits for them. */
import { mountWeatherCards } from './weather-cards.mjs?v=6.00-cards1';
import { normalizeForecast, WEATHER_REQUEST_URL } from './weather-data.mjs?v=6.00-cards1';

const page = document.getElementById('page-weather');
const root = document.getElementById('weather-cards');
const cards = mountWeatherCards(root, { showHeader: false, onRefresh: () => void load(true) });
const CACHE_KEY = 'faifaWeatherCards1';
const FRESH_FOR = 30 * 60 * 1000;
const KEEP_FOR = 24 * 60 * 60 * 1000;
const CURRENT_MAX_AGE = 3 * 60 * 60 * 1000;
const timeLabel = new Intl.DateTimeFormat('ar-SA-u-ca-gregory', {
  timeZone: 'Asia/Riyadh', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
});
let saved = null;
let pending = null;
let controller = null;
let requestId = 0;

function active() { return !document.hidden && page.classList.contains('active'); }
function readCache() {
  try {
    const value = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (value?.version === 1 && typeof value.fetchedAt === 'number') return value;
  } catch (_) { /* Storage is optional. */ }
  return null;
}
saved = readCache();

function cacheUsable() {
  const age = Date.now() - saved?.fetchedAt;
  if (!Number.isFinite(age) || age < -60000 || age > KEEP_FOR) return false;
  try { normalizeForecast(saved.payload); return true; } catch (_) { return false; }
}
function credit(fetchedAt) {
  const node = root.querySelector('.wc-attribution');
  const link = document.createElement('a');
  link.href = 'https://open-meteo.com/'; link.target = '_blank'; link.rel = 'noopener';
  link.textContent = 'Open-Meteo';
  node.replaceChildren(document.createTextNode('بيانات التوقعات: '), link);
  if (fetchedAt) node.append(document.createTextNode(` · جُلبت ${timeLabel.format(new Date(fetchedAt))}`));
  node.hidden = false;
}
function renderSaved(state = 'ready', status = '') {
  cards.render({ ...normalizeForecast(saved.payload), state, status });
  credit(saved.fetchedAt);
}
function unavailable(offline) {
  cards.render({
    current: {}, daily: [], hourly: [],
    summary: 'التوقعات غير متاحة حاليًا',
    rain: { probability: null, windowLabel: 'غير متاح' },
    state: offline ? 'offline' : 'error',
    status: offline ? 'أنت غير متصل بالإنترنت. أعد المحاولة عند عودة الاتصال.' : 'تعذر تحميل توقعات الطقس. اضغط زر التحديث للمحاولة مجددًا.'
  });
  credit();
}

async function load(force = false) {
  if (!active()) return;
  void window.ensureAstronomy?.();
  const offline = navigator.onLine === false;
  if (offline && pending) {
    ++requestId;
    controller?.abort(); controller = null; pending = null;
  }
  if (pending) return pending;
  const cached = cacheUsable();
  const currentAt = cached ? normalizeForecast(saved.payload).currentAt : 0;
  const fresh = cached && Date.now() - saved.fetchedAt < FRESH_FOR && Math.abs(Date.now() - currentAt) < CURRENT_MAX_AGE;
  if (cached) renderSaved(offline || !fresh ? (offline ? 'offline' : 'stale') : 'ready',
    offline ? `أنت غير متصل. هذه بيانات محفوظة جُلبت ${timeLabel.format(new Date(saved.fetchedAt))}.` : !fresh ? 'تُعرض البيانات المحفوظة أثناء تحديث التوقعات.' : '');
  if (offline) { if (!cached) unavailable(true); return; }
  if (fresh && !force) return;

  cards.setStatus(cached ? 'جارٍ تحديث التوقعات؛ تُعرض البيانات المحفوظة مؤقتًا.' : 'جارٍ تحميل توقعات فيفاء…', 'loading');
  const id = ++requestId;
  const requestController = new AbortController();
  controller = requestController;
  const signal = requestController.signal;
  const timeout = setTimeout(() => requestController.abort(), 10000);
  pending = (async () => {
    try {
      const response = await fetch(WEATHER_REQUEST_URL, { signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error('Forecast unavailable');
      const payload = await response.json();
      const forecast = normalizeForecast(payload);
      const now = Date.now();
      if (now - forecast.currentAt > CURRENT_MAX_AGE || forecast.currentAt - now > 30 * 60 * 1000) throw new Error('Forecast is out of date');
      if (id !== requestId) return;
      saved = { version: 1, fetchedAt: now, payload };
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(saved)); } catch (_) { /* Weather also works without storage. */ }
      cards.render(forecast);
      credit(now);
    } catch (_) {
      if (id !== requestId) return;
      const noConnection = navigator.onLine === false;
      if (cacheUsable()) renderSaved(noConnection ? 'offline' : 'stale',
        `تعذر التحديث. هذه بيانات محفوظة جُلبت ${timeLabel.format(new Date(saved.fetchedAt))}.`);
      else unavailable(noConnection);
    } finally {
      clearTimeout(timeout);
      if (id === requestId) { pending = null; controller = null; }
    }
  })();
  return pending;
}

function pause() {
  if (active()) { void load(); return; }
  ++requestId;
  controller?.abort(); controller = null; pending = null;
}
window.loadWeather = load;
new MutationObserver(pause).observe(page, { attributes: true, attributeFilter: ['class'] });
document.addEventListener('visibilitychange', pause);
window.addEventListener('online', () => void load(true));
window.addEventListener('offline', () => void load());
setInterval(() => void load(), FRESH_FOR);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void load());
else void load();
