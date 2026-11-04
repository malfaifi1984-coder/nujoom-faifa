import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { normalizeForecast, FORECAST_SOURCE_ID, WEATHER_REQUEST_URL, CORE_WEATHER_REQUEST_URL } from '../weather-data.mjs';

const source = readFileSync(new URL('../weather-ui.js', import.meta.url), 'utf8').replace(/^import[^\n]+\n/gm, '');
const NOW = Date.parse('2026-11-04T12:15:00+03:00');
const HOUR = 3600000;
const CACHE_KEY = 'faifaWeatherECMWFCards1';
const settle = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };

function forecast(now = NOW, temperature = 24) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const midnight = Date.parse(`${day}T00:00:00+03:00`);
  return {
    latitude: 17.25, longitude: 43.1, timezone: 'Asia/Riyadh', utc_offset_seconds: 10800,
    current_units: { temperature_2m: '°C', apparent_temperature: '°C', wind_speed_10m: 'km/h', wind_direction_10m: '°', wind_gusts_10m: 'km/h' },
    hourly_units: { temperature_2m: '°C', precipitation: 'mm', precipitation_probability: '%' },
    daily_units: { temperature_2m_max: '°C', temperature_2m_min: '°C' },
    current: { time: Math.floor(now / 900000) * 900, interval: 900, temperature_2m: temperature, apparent_temperature: temperature - 1, is_day: 1, wind_speed_10m: 12, wind_direction_10m: 45, wind_gusts_10m: 20 },
    hourly: {
      time: Array.from({ length: 120 }, (_, i) => (midnight + i * HOUR) / 1000),
      temperature_2m: Array(120).fill(temperature),
      precipitation: Array(120).fill(0), precipitation_probability: Array(120).fill(0)
    },
    daily: {
      time: Array.from({ length: 5 }, (_, i) => (midnight + i * 24 * HOUR) / 1000),
      temperature_2m_max: [27, 26, 28, 25, 26], temperature_2m_min: [19, 19, 20, 18, 19]
    }
  };
}

function saved(payload = forecast(), fetchedAt = NOW - 5 * 60000, extra = {}) {
  return { version: 2, source: FORECAST_SOURCE_ID, fetchedAt, payload, ...extra };
}

function harness({ active = true, homeActive = false, homeCard = true, hidden = false, readyState = 'loading', online = true, storage = {}, ignoreAbort = false } = {}) {
  const clock = { now: NOW }, timers = new Map(), intervals = new Map();
  const windowEvents = new Map(), documentEvents = new Map();
  const stored = new Map(Object.entries(storage).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]));
  const requests = [], renders = [], homeRenders = [], updates = { textContent: '', hidden: true };
  const view = { state: null, status: '', data: null };
  const homeView = { state: null, fetchedAt: null, data: null };
  const classes = new Set(active ? ['active'] : []);
  const homeClasses = new Set(homeActive ? ['active'] : []);
  let nextTimer = 0, observer, mountOptions, astronomyCalls = 0;
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])); }
    static now() { return clock.now; }
  }
  function listen(map, name, callback) {
    if (!map.has(name)) map.set(name, new Set());
    map.get(name).add(callback);
  }
  function emit(map, name) { for (const callback of map.get(name) || []) callback(); }
  const page = { classList: { contains: name => classes.has(name) } };
  const homePage = { classList: { contains: name => homeClasses.has(name) } };
  const homeRoot = {};
  const root = { querySelector: () => updates };
  const document = {
    hidden, readyState,
    getElementById: id => ({ 'page-weather': page, 'page-home': homePage, 'weather-cards': root, 'home-weather-summary': homeCard ? homeRoot : null }[id] ?? null),
    addEventListener: (name, callback) => listen(documentEvents, name, callback)
  };
  const window = {
    ensureAstronomy: () => { astronomyCalls++; return Promise.resolve(); },
    addEventListener: (name, callback) => listen(windowEvents, name, callback)
  };
  const navigator = { onLine: online };
  runInNewContext(source, {
    window, document, navigator, Date: ClockDate, Intl, AbortController,
    FORECAST_SOURCE_ID, WEATHER_REQUEST_URL, CORE_WEATHER_REQUEST_URL,
    normalizeForecast: payload => normalizeForecast(payload, clock.now),
    mountHomeWeatherSummary() {
      return { render(data, meta) {
        homeRenders.push({ data, ...meta });
        homeView.data = data; homeView.state = meta.state; homeView.fetchedAt = meta.fetchedAt;
      } };
    },
    mountWeatherCards(_root, options) {
      mountOptions = options;
      return {
        render(data) { renders.push(data); view.data = data; view.state = data.state ?? 'ready'; view.status = data.status ?? ''; },
        setStatus(status, state) { view.status = status; view.state = state; }
      };
    },
    localStorage: {
      getItem: key => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, String(value))
    },
    MutationObserver: class { constructor(callback) { observer = callback; } observe() {} },
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, due: clock.now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
    setInterval(callback, delay) { const id = ++nextTimer; intervals.set(id, { callback, delay, due: clock.now + delay }); return id; },
    fetch(url, options) {
      return new Promise((resolve, reject) => {
        const item = { url, options, resolve, reject };
        requests.push(item);
        if (!ignoreAbort) options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    }
  });
  return {
    window, document, navigator, requests, renders, homeRenders, stored, view, homeView, updates,
    get astronomyCalls() { return astronomyCalls; },
    load: force => window.loadWeather(force),
    ready: () => { document.readyState = 'interactive'; emit(documentEvents, 'DOMContentLoaded'); },
    loaded: () => { document.readyState = 'complete'; emit(windowEvents, 'load'); },
    refresh: () => mountOptions.onRefresh(),
    resume: () => emit(documentEvents, 'visibilitychange'),
    online(value) { navigator.onLine = value; emit(windowEvents, value ? 'online' : 'offline'); },
    leave() { classes.delete('active'); homeClasses.delete('active'); observer(); },
    enter() { classes.add('active'); homeClasses.delete('active'); observer(); },
    home() { classes.delete('active'); homeClasses.add('active'); observer(); },
    hide() { document.hidden = true; emit(documentEvents, 'visibilitychange'); },
    show() { document.hidden = false; emit(documentEvents, 'visibilitychange'); },
    respond(index, status = 200, payload = forecast(clock.now)) {
      requests[index].resolve({ status, ok: status >= 200 && status < 300, json: async () => payload });
    },
    fail: (index, error = new Error('connection failed')) => requests[index].reject(error),
    advance(milliseconds) {
      clock.now += milliseconds;
      for (const [id, timer] of [...timers]) if (timer.due <= clock.now) { timers.delete(id); timer.callback(); }
      for (const interval of intervals.values()) while (interval.due <= clock.now) { interval.due += interval.delay; interval.callback(); }
    }
  };
}

test('opening unrelated pages and background events never request a forecast', async () => {
  const ui = harness({ active: false });
  ui.ready(); ui.resume(); ui.online(true); ui.advance(HOUR);
  await ui.load(true); await settle();
  assert.equal(ui.requests.length, 0);
  assert.equal(ui.renders.length, 0);
  assert.equal(ui.astronomyCalls, 0);
});

test('Home waits until readiness plus the defer before its first request and never loads astronomy', async () => {
  for (const readyState of ['loading', 'interactive']) {
    const ui = harness({ active: false, homeActive: true, readyState });
    ui.load(true); ui.advance(2000);
    assert.equal(ui.requests.length, 0); // DOMContentLoaded has not occurred.
    assert.equal(ui.homeView.data, null);
    assert.equal(ui.homeView.state, 'loading');
    ui.ready(); ui.resume();
    ui.advance(999);
    assert.equal(ui.requests.length, 0);
    ui.advance(1);
    assert.equal(ui.requests.length, 1);
    assert.equal(ui.astronomyCalls, 0);
    assert.equal(ui.renders.length, 0); // Hidden full cards were not rebuilt or announced.
    ui.respond(0, 200, forecast(NOW, 25)); await settle();
    assert.equal(ui.homeView.state, 'ready');
    assert.equal(ui.homeView.data.current.temperature, 25);
    assert.equal(ui.renders.length, 0);
  }
});

test('late module readiness via load is idempotent and a completed document still defers Home', async () => {
  for (const readyState of ['interactive', 'complete']) {
    const ui = harness({ active: false, homeActive: true, readyState });
    if (readyState === 'interactive') ui.loaded();
    ui.advance(500); ui.loaded();
    ui.advance(499);
    assert.equal(ui.requests.length, 0);
    ui.advance(1);
    assert.equal(ui.requests.length, 1);
    assert.equal(ui.astronomyCalls, 0);
  }
});

test('fresh Home cache paints synchronously without requests or hidden Weather rendering', async () => {
  const fetchedAt = NOW - 5 * 60000;
  const ui = harness({ active: false, homeActive: true, storage: { [CACHE_KEY]: saved(forecast(NOW, 29), fetchedAt) } });
  assert.equal(ui.homeView.state, 'ready');
  assert.equal(ui.homeView.data.current.temperature, 29);
  assert.equal(ui.homeView.fetchedAt, fetchedAt);
  ui.ready(); ui.resume(); ui.advance(1000); await ui.load();
  assert.equal(ui.requests.length, 0);
  assert.equal(ui.astronomyCalls, 0);
  assert.equal(ui.renders.length, 0);
  assert.equal(ui.updates.hidden, true);
});

test('offline Home shows a labeled snapshot or unavailable values without fetching', async () => {
  for (const cached of [true, false]) {
    const ui = harness({ active: false, homeActive: true, online: false,
      storage: cached ? { [CACHE_KEY]: saved(forecast(NOW, 30)) } : {} });
    assert.equal(ui.homeView.state, 'offline');
    assert.equal(ui.homeView.data?.current.temperature ?? null, cached ? 30 : null);
    assert.equal(ui.homeView.fetchedAt != null, cached);
    ui.ready(); ui.advance(HOUR); await settle();
    assert.equal(ui.requests.length, 0);
    assert.equal(ui.astronomyCalls, 0);
    assert.equal(ui.renders.length, 0);
  }
});

test('Home refresh failure preserves a clearly stale matching cache', async () => {
  const payload = forecast(NOW, 32);
  const ui = harness({ active: false, homeActive: true,
    storage: { [CACHE_KEY]: saved(payload, NOW - 31 * 60000) } });
  assert.equal(ui.homeView.state, 'stale');
  assert.equal(ui.homeView.data.current.temperature, 32);
  ui.ready(); ui.advance(1000);
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.homeView.state, 'stale');
  ui.fail(0); await settle();
  assert.equal(ui.homeView.state, 'stale');
  assert.equal(ui.homeView.data.current.temperature, 32);
  assert.deepEqual(JSON.parse(ui.stored.get(CACHE_KEY)).payload, payload);
  assert.equal(ui.renders.length, 0);
});

test('leaving Home or hiding cancels its queued fetch and a hidden Home never queues one', async () => {
  for (const cancel of ['leave', 'hide']) {
    const ui = harness({ active: false, homeActive: true });
    ui.ready(); ui.advance(500); ui[cancel](); ui.advance(1000);
    assert.equal(ui.requests.length, 0);
    assert.equal(ui.astronomyCalls, 0);
  }
  const hidden = harness({ active: false, homeActive: true, hidden: true });
  hidden.ready(); hidden.advance(2000);
  assert.equal(hidden.requests.length, 0);
  hidden.show(); hidden.advance(999);
  assert.equal(hidden.requests.length, 0);
  hidden.advance(1);
  assert.equal(hidden.requests.length, 1);
});

test('entering Weather cancels the queued Home delay and immediately loads the full forecast', async () => {
  const ui = harness({ active: false, homeActive: true });
  ui.ready(); ui.advance(300);
  ui.enter();
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.view.state, 'loading');
  assert.equal(ui.astronomyCalls, 1);
  ui.advance(700);
  assert.equal(ui.requests.length, 1);
  ui.respond(0, 200, forecast(NOW, 26)); await settle();
  assert.equal(ui.view.state, 'ready');
  assert.equal(ui.view.data.current.temperature, 26);
  assert.equal(ui.homeView.data.current.temperature, 26);
});

test('Home to Weather and back shares one pending request and paints the active consumer first', async () => {
  const ui = harness({ active: false, homeActive: true });
  ui.ready(); ui.advance(1000);
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.view.state, null);
  ui.enter();
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.view.state, 'loading');
  assert.equal(ui.requests[0].options.signal.aborted, false);
  assert.equal(ui.astronomyCalls, 1);
  ui.home();
  assert.equal(ui.requests[0].options.signal.aborted, false);
  const weatherRenderCount = ui.renders.length;
  ui.respond(0, 200, forecast(NOW, 27)); await settle();
  assert.equal(ui.homeView.state, 'ready');
  assert.equal(ui.homeView.data.current.temperature, 27);
  assert.equal(ui.renders.length, weatherRenderCount);
  ui.enter();
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.view.state, 'ready');
  assert.equal(ui.view.data.current.temperature, 27);
});

test('a Weather request survives the move to Home but is canceled when both consumers leave', async () => {
  const ui = harness();
  const loading = ui.load();
  ui.home(); ui.resume();
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.requests[0].options.signal.aborted, false);
  assert.equal(ui.astronomyCalls, 1);
  ui.leave(); await loading; await settle();
  assert.equal(ui.requests[0].options.signal.aborted, true);
  assert.equal(ui.stored.has(CACHE_KEY), false);
});

test('coming online queues one forced Home refresh even when the current cache is fresh', async () => {
  const ui = harness({ active: false, homeActive: true, online: false,
    storage: { [CACHE_KEY]: saved(forecast(NOW, 30)) } });
  ui.ready(); ui.online(true); ui.resume(); ui.load();
  ui.advance(999);
  assert.equal(ui.requests.length, 0);
  ui.advance(1);
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.astronomyCalls, 0);
  ui.respond(0, 200, forecast(NOW, 25)); await settle();
  assert.equal(ui.homeView.state, 'ready');
  assert.equal(ui.homeView.data.current.temperature, 25);
});

test('without the Home card the previous Weather-only request behavior is preserved', async () => {
  const ui = harness({ active: false, homeActive: true, homeCard: false });
  ui.ready(); ui.resume(); ui.advance(2000);
  assert.equal(ui.requests.length, 0);
  ui.enter();
  assert.equal(ui.requests.length, 1);
  ui.respond(0); await settle();
  assert.equal(ui.view.state, 'ready');
});

test('automatic-model caches and wrong-version or wrong-source ECMWF-key entries are not displayed', async () => {
  const oldPayload = forecast(NOW, 33);
  const candidates = [
    { faifaWeatherCards1: { version: 1, fetchedAt: NOW, payload: oldPayload } },
    { [CACHE_KEY]: saved(oldPayload, NOW, { source: 'open-meteo:best-match:v1' }) },
    { [CACHE_KEY]: saved(oldPayload, NOW, { version: 1 }) },
    { [CACHE_KEY]: '{broken-json' },
    { [CACHE_KEY]: saved(oldPayload, NOW + 2 * 60000) }
  ];
  for (const storage of candidates) {
    const ui = harness({ storage });
    const loading = ui.load();
    assert.equal(ui.requests.length, 1);
    assert.equal(ui.renders.length, 0);
    ui.respond(0, 500); await loading;
    assert.equal(ui.view.state, 'error');
    assert.equal(ui.view.data.current.temperature, undefined);
    assert.equal(ui.updates.hidden, true);
  }
});

test('schema rejection retries only the core request of the same European model and drops stale optional values', async () => {
  for (const status of [400, 422]) {
    const oldPayload = forecast(NOW, 33);
    oldPayload.current.apparent_temperature = 39;
    oldPayload.current.wind_gusts_10m = 99;
    oldPayload.hourly.precipitation.fill(9);
    oldPayload.hourly.precipitation_probability.fill(88);
    const ui = harness({ storage: { [CACHE_KEY]: saved(oldPayload) } });
    const loading = ui.load(true);
    ui.respond(0, status); await settle();
    assert.equal(ui.requests.length, 2);
    assert.equal(ui.requests[0].url, WEATHER_REQUEST_URL);
    assert.equal(ui.requests[1].url, CORE_WEATHER_REQUEST_URL);
    for (const request of ui.requests) assert.equal(new URL(request.url).searchParams.get('models'), 'ecmwf_ifs');
    const core = forecast(NOW, 22);
    delete core.current.apparent_temperature;
    delete core.current.wind_gusts_10m;
    delete core.hourly.precipitation_probability;
    core.hourly.precipitation.fill(0);
    core.hourly.precipitation[15] = 2;
    ui.respond(1, 200, core); await loading;
    assert.equal(ui.view.state, 'ready');
    assert.equal(ui.view.data.current.temperature, 22);
    assert.equal(ui.view.data.current.apparentTemperature, null);
    assert.equal(ui.view.data.current.windGusts, null);
    assert.equal(ui.view.data.rain.probability, null);
    assert.equal(ui.view.data.rain.amount, 2);
    const cache = JSON.parse(ui.stored.get(CACHE_KEY));
    assert.equal(cache.version, 2);
    assert.equal(cache.source, FORECAST_SOURCE_ID);
    assert.deepEqual(cache.payload, core);
    assert.equal(ui.requests[0].options.signal, ui.requests[1].options.signal);
  }
});

test('rate limits, server failures and network rejection do not start schema retries or another model', async () => {
  for (const failure of [429, 500, 'network']) {
    const ui = harness();
    const loading = ui.load();
    if (failure === 'network') ui.fail(0); else ui.respond(0, failure);
    await loading;
    assert.equal(ui.requests.length, 1);
    assert.equal(ui.requests[0].url, WEATHER_REQUEST_URL);
    assert.equal(ui.view.state, 'error');
    assert.equal(ui.view.data.current.temperature, undefined);
  }
});

test('a fresh matching forecast serves automatic visits while the actual refresh action fetches new data', async () => {
  const ui = harness({ storage: { [CACHE_KEY]: saved(forecast(NOW, 31)) } });
  ui.ready(); ui.resume(); await settle(); await ui.load();
  assert.equal(ui.requests.length, 0);
  assert.equal(ui.view.state, 'ready');
  assert.equal(ui.view.data.current.temperature, 31);
  ui.refresh();
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.view.state, 'loading');
  ui.respond(0, 200, forecast(NOW, 25)); await settle();
  assert.equal(ui.view.state, 'ready');
  assert.equal(ui.view.data.current.temperature, 25);
  assert.equal(ui.updates.hidden, false);
});

test('failed refreshes preserve an explicitly stale ECMWF snapshot and offline viewing sends no request', async () => {
  const payload = forecast(NOW, 32);
  const ui = harness({ storage: { [CACHE_KEY]: saved(payload, NOW - 31 * 60000) } });
  const loading = ui.load();
  assert.equal(ui.view.data.current.temperature, 32);
  ui.fail(0); await loading;
  assert.equal(ui.view.state, 'stale');
  assert.ok(ui.view.status);
  assert.equal(ui.view.data.current.temperature, 32);
  assert.deepEqual(JSON.parse(ui.stored.get(CACHE_KEY)).payload, payload);
  ui.online(false); await settle();
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.view.state, 'offline');
  assert.equal(ui.view.data.current.temperature, 32);
  assert.equal(ui.updates.hidden, false);
});

test('an expired matching cache cannot supply current values even when the network is unavailable', async () => {
  for (const online of [true, false]) {
    const old = NOW - 25 * HOUR;
    const ui = harness({ online, storage: { [CACHE_KEY]: saved(forecast(old, 33), old) } });
    const loading = ui.load();
    if (online) ui.respond(0, 500);
    await loading;
    assert.equal(ui.view.state, online ? 'error' : 'offline');
    assert.equal(ui.view.data.current.temperature, undefined);
    assert.equal(ui.updates.hidden, true);
    assert.equal(ui.requests.length, online ? 1 : 0);
  }
});

test('concurrent automatic and manual loads share a single in-flight response', async () => {
  const ui = harness();
  const jobs = [ui.load(), ui.load(true), ui.load()];
  assert.equal(ui.requests.length, 1);
  ui.respond(0, 200, forecast(NOW, 26)); await Promise.all(jobs);
  assert.equal(ui.view.data.current.temperature, 26);
  await ui.load();
  assert.equal(ui.requests.length, 1);
});

test('leaving and reentering ignores an old response and its timeout cannot abort the new request', async () => {
  const ui = harness({ ignoreAbort: true });
  const oldJob = ui.load();
  ui.leave();
  assert.equal(ui.requests[0].options.signal.aborted, true);
  ui.advance(1000); ui.enter();
  assert.equal(ui.requests.length, 2);
  ui.advance(9000); // Only the old request's deadline has elapsed.
  assert.equal(ui.requests[1].options.signal.aborted, false);
  ui.respond(0, 200, forecast(NOW, 18)); await oldJob;
  assert.equal(ui.view.state, 'loading');
  assert.equal(ui.view.data, null);
  const waiting = ui.load();
  assert.equal(ui.requests.length, 2); // Old finally must not release the new request's lock.
  ui.respond(1, 200, forecast(NOW, 27)); await waiting;
  assert.equal(ui.view.state, 'ready');
  assert.equal(ui.view.data.current.temperature, 27);
  assert.equal(JSON.parse(ui.stored.get(CACHE_KEY)).payload.current.temperature_2m, 27);
});

test('request timeout exposes an error and permits retry without making a core fallback call', async () => {
  const ui = harness();
  const first = ui.load();
  ui.advance(10000); await first;
  assert.equal(ui.requests[0].options.signal.aborted, true);
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.view.state, 'error');
  const retried = ui.load(true);
  assert.equal(ui.requests.length, 2);
  assert.equal(ui.requests[1].url, WEATHER_REQUEST_URL);
  ui.respond(1, 200, forecast(NOW, 25)); await retried;
  assert.equal(ui.view.state, 'ready');
});

test('losing connectivity during a request immediately shows the cached snapshot and cancels the request', async () => {
  const ui = harness({ storage: { [CACHE_KEY]: saved(forecast(NOW, 30)) } });
  const loading = ui.load(true);
  ui.online(false); await loading; await settle();
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.requests[0].options.signal.aborted, true);
  assert.equal(ui.view.state, 'offline');
  assert.equal(ui.view.data.current.temperature, 30);
  assert.ok(ui.view.status);
});

test('old or implausibly future current timestamps never become fresh network data', async () => {
  for (const offset of [-4 * HOUR, 31 * 60000]) {
    const ui = harness();
    const payload = forecast(); payload.current.time = (NOW + offset) / 1000;
    const loading = ui.load(); ui.respond(0, 200, payload); await loading;
    assert.equal(ui.view.state, 'error');
    assert.equal(ui.view.data.current.temperature, undefined);
    assert.equal(ui.stored.has(CACHE_KEY), false);
    assert.equal(ui.requests.length, 1);
  }
});
