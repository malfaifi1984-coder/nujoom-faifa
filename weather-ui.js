/* Home and Weather share one forecast; Home waits until after the initial paint. */
import { mountWeatherCards } from './weather-cards.mjs?v=6.00-ecmwf1';
import { mountHomeWeatherSummary } from './home-weather.mjs?v=6.00-homewx1';
import { normalizeForecast, WEATHER_REQUEST_URL, CORE_WEATHER_REQUEST_URL, FORECAST_SOURCE_ID } from './weather-data.mjs?v=6.00-ecmwf1';

const page = document.getElementById('page-weather');
const root = document.getElementById('weather-cards');
const homePage = document.getElementById('page-home');
const homeRoot = document.getElementById('home-weather-summary');
const homeSummary = homeRoot && homePage ? mountHomeWeatherSummary(homeRoot) : null;
const cards = mountWeatherCards(root, { showHeader: false, onRefresh: () => void load(true) });
// An automatic-model snapshot cannot be presented as this explicit ECMWF product.
const CACHE_KEY = 'faifaWeatherECMWFCards1';
const FRESH_FOR = 30 * 60 * 1000;
const KEEP_FOR = 24 * 60 * 60 * 1000;
const CURRENT_MAX_AGE = 3 * 60 * 60 * 1000;
const HOME_DELAY = 1000;
const timeLabel = new Intl.DateTimeFormat('ar-SA-u-ca-gregory', {
  timeZone: 'Asia/Riyadh', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
});
let saved = null;
let pending = null;
let controller = null;
let requestId = 0;
let homeTimer = null;
let homeForce = false;
// Static modules run during "interactive", before DOMContentLoaded. Other
// module downloads may still delay the app's first paint, so wait for readiness.
let homeReady = document.readyState === 'complete';

function weatherActive() { return !document.hidden && page.classList.contains('active'); }
function homeActive() { return !document.hidden && homeSummary && homePage.classList.contains('active'); }
function consumerActive() { return weatherActive() || homeActive(); }

function readCache() {
  try {
    const value = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (value?.version === 2 && value.source === FORECAST_SOURCE_ID && typeof value.fetchedAt === 'number') return value;
  } catch (_) { /* Storage is optional. */ }
  return null;
}
saved = readCache();

function snapshot() {
  const now = Date.now(), age = now - saved?.fetchedAt;
  if (!Number.isFinite(age) || age < -60000 || age > KEEP_FOR) return null;
  try {
    const forecast = normalizeForecast(saved.payload);
    return { forecast, fresh: age < FRESH_FOR && Math.abs(now - forecast.currentAt) < CURRENT_MAX_AGE };
  } catch (_) { return null; }
}

function updateTime(fetchedAt) {
  if (!weatherActive()) return;
  const node = root.querySelector('.wc-update');
  node.textContent = fetchedAt ? `جُلبت التوقعات ${timeLabel.format(new Date(fetchedAt))} بتوقيت السعودية` : '';
  node.hidden = !fetchedAt;
}

function renderForecast(forecast, state = 'ready', status = '', fetchedAt = saved?.fetchedAt) {
  if (weatherActive()) {
    cards.render({ ...forecast, state, status });
    updateTime(fetchedAt);
  }
  homeSummary?.render(forecast, { state, fetchedAt });
}

function showSnapshot(cached, offline) {
  const state = offline ? 'offline' : cached.fresh ? 'ready' : 'stale';
  const status = offline ? `أنت غير متصل. هذه بيانات محفوظة جُلبت ${timeLabel.format(new Date(saved.fetchedAt))}.`
    : !cached.fresh ? 'تُعرض البيانات المحفوظة أثناء تحديث التوقعات.' : '';
  renderForecast(cached.forecast, state, status);
}

function unavailable(offline) {
  const state = offline ? 'offline' : 'error';
  if (weatherActive()) {
    cards.render({
      current: {}, daily: [], hourly: [], state,
      status: offline ? 'أنت غير متصل بالإنترنت. أعد المحاولة عند عودة الاتصال.'
        : 'تعذر تحميل توقعات الطقس. اضغط زر التحديث للمحاولة مجددًا.'
    });
    updateTime();
  }
  homeSummary?.render(null, { state, fetchedAt: null });
}

function loading(cached) {
  if (weatherActive()) cards.setStatus(cached ? 'جارٍ تحديث التوقعات؛ تُعرض البيانات المحفوظة مؤقتًا.' : 'جارٍ تحميل توقعات فيفاء…', 'loading');
  homeSummary?.render(cached?.forecast ?? null, {
    state: cached && !cached.fresh ? 'stale' : 'loading', fetchedAt: cached ? saved.fetchedAt : null
  });
}

function cancelHomeQueue() {
  if (homeTimer !== null) clearTimeout(homeTimer);
  homeTimer = null;
  homeForce = false;
}

function cancelRequest() {
  ++requestId;
  controller?.abort(); controller = null; pending = null;
}

async function requestForecast(signal) {
  const options = { signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' };
  let response = await fetch(WEATHER_REQUEST_URL, options);
  // Unsupported optional fields can be dropped without switching the ECMWF model.
  // Network failures and rate limits never trigger an extra request.
  if ([400, 422].includes(response.status) && CORE_WEATHER_REQUEST_URL !== WEATHER_REQUEST_URL) {
    response = await fetch(CORE_WEATHER_REQUEST_URL, options);
  }
  if (!response.ok) throw new Error('Forecast unavailable');
  return response.json();
}

async function loadNow(force = false) {
  if (!consumerActive()) return;
  const offline = navigator.onLine === false;
  if (offline && pending) cancelRequest();
  const cached = snapshot();
  // Paint the active consumer before returning an existing shared request. This
  // matters when Home starts it and the user opens Weather while it is pending.
  if (cached) showSnapshot(cached, offline);
  if (offline) { if (!cached) unavailable(true); return; }
  if (pending) { loading(cached); return pending; }
  if (cached?.fresh && !force) return;

  loading(cached);
  const id = ++requestId;
  const requestController = new AbortController();
  controller = requestController;
  const signal = requestController.signal;
  const timeout = setTimeout(() => requestController.abort(), 10000);
  pending = (async () => {
    try {
      const payload = await requestForecast(signal);
      const forecast = normalizeForecast(payload);
      const now = Date.now();
      if (now - forecast.currentAt > CURRENT_MAX_AGE || forecast.currentAt - now > 30 * 60 * 1000) throw new Error('Forecast is out of date');
      if (id !== requestId) return;
      saved = { version: 2, source: FORECAST_SOURCE_ID, fetchedAt: now, payload };
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(saved)); } catch (_) { /* Forecasts also work without storage. */ }
      renderForecast(forecast, 'ready', '', now);
    } catch (_) {
      if (id !== requestId) return;
      const noConnection = navigator.onLine === false, fallback = snapshot();
      if (fallback) renderForecast(fallback.forecast, noConnection ? 'offline' : 'stale',
        `تعذر التحديث. هذه بيانات محفوظة جُلبت ${timeLabel.format(new Date(saved.fetchedAt))}.`);
      else unavailable(noConnection);
    } finally {
      clearTimeout(timeout);
      if (id === requestId) { pending = null; controller = null; }
    }
  })();
  return pending;
}

function queueHome(force = false) {
  if (!homeActive()) return;
  const offline = navigator.onLine === false;
  if (offline) {
    cancelHomeQueue();
    return loadNow();
  }
  const cached = snapshot();
  if (cached) showSnapshot(cached, false);
  if (pending) { loading(cached); return pending; }
  homeForce = homeForce || force;
  if (cached?.fresh && !homeForce) { cancelHomeQueue(); return; }
  loading(cached);
  if (!homeReady || homeTimer !== null) return;
  homeTimer = setTimeout(() => {
    const requestedForce = homeForce;
    homeTimer = null; homeForce = false;
    if (homeActive()) void loadNow(requestedForce);
  }, HOME_DELAY);
}

function load(force = false) {
  if (weatherActive()) {
    const queuedForce = homeForce;
    cancelHomeQueue();
    void window.ensureAstronomy?.();
    return loadNow(force || queuedForce);
  }
  if (homeActive()) return queueHome(force);
}

function reconcile() {
  if (consumerActive()) { void load(); return; }
  cancelHomeQueue();
  cancelRequest();
}

window.loadWeather = load;
const observer = new MutationObserver(reconcile);
observer.observe(page, { attributes: true, attributeFilter: ['class'] });
if (homeSummary) observer.observe(homePage, { attributes: true, attributeFilter: ['class'] });
document.addEventListener('visibilitychange', reconcile);
window.addEventListener('online', () => void load(true));
window.addEventListener('offline', () => void load());
setInterval(() => void load(), FRESH_FOR);

// Rendering a valid local snapshot is synchronous and never blocks on a network
// response. The first Home request is separately deferred until after readiness.
if (homeActive()) {
  const cached = snapshot();
  if (cached) showSnapshot(cached, navigator.onLine === false);
  else homeSummary.render(null, { state: navigator.onLine === false ? 'offline' : 'loading', fetchedAt: null });
}
function ready() {
  if (homeReady) return;
  homeReady = true;
  void load();
}
if (!homeReady) {
  document.addEventListener('DOMContentLoaded', ready, { once: true });
  // A dynamically inserted module can arrive after DOMContentLoaded but before
  // the load event. Both paths are idempotent and keep the same deferred queue.
  window.addEventListener('load', ready, { once: true });
} else void load();
