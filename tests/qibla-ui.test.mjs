import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as math from '../qibla-math.mjs';

const source = readFileSync(new URL('../qibla-ui.js', import.meta.url), 'utf8').replace(/^import[^\n]+\n/, '');
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function harness({ supported = true, permission = 'granted' } = {}) {
  const nodes = new Map(), windowEvents = new Map(), documentEvents = new Map(), timers = new Map();
  const requests = [], order = [];
  let observer, nextTimer = 0, permissionResult = permission;
  function listen(events, name, callback) {
    if (!events.has(name)) events.set(name, new Set());
    events.get(name).add(callback);
  }
  function node(id) {
    if (!nodes.has(id)) {
      const attributes = new Map(), events = new Map(), classes = new Set(id === 'page-prayer' ? ['active'] : []);
      nodes.set(id, {
        textContent: '', disabled: false,
        setAttribute: (name, value) => attributes.set(name, String(value)),
        getAttribute: (name) => attributes.get(name),
        removeAttribute: (name) => attributes.delete(name), focus() {},
        addEventListener: (name, callback) => listen(events, name, callback),
        emit: (name, event = {}) => { for (const callback of events.get(name) || []) callback(event); },
        classList: {
          contains: (name) => classes.has(name),
          remove: (name) => classes.delete(name),
          toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name)
        }
      });
    }
    return nodes.get(id);
  }
  const document = {
    hidden: false, getElementById: node,
    addEventListener: (name, callback) => listen(documentEvents, name, callback)
  };
  const window = {
    isSecureContext: true, screen: {orientation: {angle: 0}},
    addEventListener: (name, callback) => listen(windowEvents, name, callback),
    removeEventListener: (name, callback) => windowEvents.get(name)?.delete(callback)
  };
  if (supported) window.DeviceOrientationEvent = { requestPermission() {
    order.push('permission'); return Promise.resolve(permissionResult);
  } };
  const navigator = {geolocation: {getCurrentPosition(success, error, options) {
    order.push('location'); requests.push({success, error, options});
  }}};
  runInNewContext(source, {
    ...math, window, document, navigator,
    MutationObserver: class { constructor(callback) { observer = callback; } observe() {} },
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, {callback, delay}); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  return {
    node, window, document, requests, order,
    setPermission(value) { permissionResult = value; },
    emit(name, event) { for (const callback of [...(windowEvents.get(name) || [])]) callback(event); },
    listenerCount(name) { return windowEvents.get(name)?.size || 0; },
    locate(latitude, longitude, index = requests.length - 1) {
      requests[index].success({coords: {latitude, longitude, accuracy: 10}});
    },
    pendingTimerIds() { return [...timers.keys()]; },
    expire() { for (const [id, timer] of [...timers]) { timers.delete(id); timer.callback(); } },
    leave() { node('page-prayer').classList.remove('active'); observer(); },
    hide() { document.hidden = true; for (const callback of documentEvents.get('visibilitychange') || []) callback(); }
  };
}
function assertBearing(ui, latitude, longitude) {
  const rotation = Number(/rotate\(([^,]+)/.exec(ui.node('qb-needle').getAttribute('transform'))[1]);
  assert.ok(Math.abs(rotation - math.bearing(latitude, longitude)) < .000001);
  assert.equal(ui.node('qb-needle').getAttribute('visibility'), 'visible');
}

test('no default location is shown; iOS permission is requested before awaiting worldwide GPS', async () => {
  const ui = harness();
  assert.equal(ui.node('qb-needle').getAttribute('visibility'), 'hidden');
  assert.match(ui.node('qibla-btn').textContent, /تحديد موقعي وتشغيل البوصلة/);
  assert.doesNotMatch(ui.node('qibla-location-text').textContent, /فيفاء/);
  const started = ui.window.startQibla();
  assert.deepEqual(ui.order, ['permission', 'location']);
  await settle();
  ui.emit('deviceorientationabsolute', {alpha: 301.52, absolute: true, beta: 0, gamma: 0});
  assert.equal(ui.node('qb-needle').getAttribute('visibility'), 'hidden');
  ui.locate(40.7128, -74.006);
  await started;
  assertBearing(ui, 40.7128, -74.006);
  assert.match(ui.node('qibla-status').textContent, /قريب من القبلة/);
});

test('GPS denial does not disable the sensor and location refresh changes the bearing worldwide', async () => {
  const ui = harness();
  const started = ui.window.startQibla();
  ui.requests[0].error({code: 1}); await started;
  ui.emit('deviceorientationabsolute', {alpha: 10, absolute: true, beta: 0, gamma: 0});
  assert.match(ui.node('qibla-status').textContent, /لم يُسمح بتحديد موقعك/);
  assert.match(ui.node('qibla-note').textContent, /حساس الاتجاه يعمل/);
  assert.equal(ui.node('qb-needle').getAttribute('visibility'), 'hidden');
  assert.equal(ui.listenerCount('deviceorientationabsolute'), 1);
  const refreshed = ui.window.refreshQiblaLocation();
  assert.equal(ui.requests.at(-1).options.maximumAge, 0, 'an explicit refresh must request a fresh GPS fix');
  ui.locate(35.6762, 139.6503); await refreshed;
  assertBearing(ui, 35.6762, 139.6503);
  assert.equal(ui.listenerCount('deviceorientationabsolute'), 1);
});

test('sensor denial retains a valid static bearing and calibration retries the real permission request', async () => {
  const ui = harness({permission: 'denied'});
  const started = ui.window.startQibla(); ui.locate(51.5074, -.1278); await started;
  assertBearing(ui, 51.5074, -.1278);
  assert.match(ui.node('qibla-status').textContent, /لم يُسمح بحساس الاتجاه/);
  assert.match(ui.node('qibla-quality').textContent, /اتجاه ثابت/);
  assert.equal(ui.listenerCount('deviceorientationabsolute'), 0);
  ui.setPermission('granted');
  const retry = ui.window.recalibrateQibla();
  ui.locate(51.5074, -.1278); await retry;
  assert.equal(ui.order.filter((item) => item === 'permission').length, 2);
  assert.equal(ui.listenerCount('deviceorientationabsolute'), 1);
});

test('a paused sensor discards stale heading and resumes on the next valid event without restarting', async () => {
  const ui = harness();
  const started = ui.window.startQibla(); ui.locate(40.7128, -74.006); await started;
  ui.emit('deviceorientationabsolute', {alpha: 301.52, absolute: true, beta: 0, gamma: 0});
  assert.equal(ui.node('qibla-compass').classList.contains('aligned'), true);
  ui.expire();
  assert.equal(ui.listenerCount('deviceorientationabsolute'), 1);
  assert.equal(ui.node('qibla-compass').classList.contains('aligned'), false);
  assert.equal(ui.node('qibla-degrees').textContent, '');
  assert.match(ui.node('qibla-status').textContent, /بانتظار قراءة حديثة/);
  assert.match(ui.node('qibla-quality').textContent, /اتجاه ثابت من الشمال/);
  ui.emit('deviceorientationabsolute', {alpha: 200, absolute: true, beta: 0, gamma: 0});
  assert.equal(ui.node('qb-dial').getAttribute('transform'), 'rotate(-160,100,100)');
  assert.match(ui.node('qibla-quality').textContent, /البوصلة تعمل/);
  assert.equal(ui.order.filter((item) => item === 'permission').length, 1);
  assert.equal(ui.requests.length, 1);
});

test('empty absolute and relative samples preserve a valid native heading without extending its freshness deadline', async () => {
  const ui = harness();
  const started = ui.window.startQibla(); ui.locate(40.7128, -74.006); await started;
  ui.emit('deviceorientation', {webkitCompassHeading: 60, webkitCompassAccuracy: 5});
  const rotation = ui.node('qb-dial').getAttribute('transform');
  const deadline = ui.pendingTimerIds();
  assert.equal(deadline.length, 1);
  assert.equal(ui.node('qibla-compass').classList.contains('aligned'), true);
  for (const event of [
    {absolute: true, alpha: null, beta: null, gamma: null},
    {absolute: true, alpha: NaN, beta: 0, gamma: 0},
    {absolute: false, alpha: 170, beta: 0, gamma: 0}
  ]) {
    ui.emit('deviceorientationabsolute', event);
    assert.equal(ui.node('qb-dial').getAttribute('transform'), rotation);
    assert.equal(ui.node('qibla-compass').classList.contains('aligned'), true);
    assert.deepEqual(ui.pendingTimerIds(), deadline);
  }
  ui.expire();
  assert.equal(ui.node('qibla-compass').classList.contains('aligned'), false);
  assert.match(ui.node('qibla-status').textContent, /بانتظار قراءة حديثة/);
  assert.equal(ui.listenerCount('deviceorientationabsolute'), 1);
});

test('initial sensor silence still accepts a later first reading, while an explicit stop removes listeners', async () => {
  const ui = harness();
  const started = ui.window.startQibla(); ui.locate(-33.8688, 151.2093); await started;
  ui.expire();
  assert.equal(ui.listenerCount('deviceorientationabsolute'), 1);
  assert.match(ui.node('qibla-status').textContent, /بانتظار قراءة حديثة/);
  ui.emit('deviceorientationabsolute', {alpha: 90, absolute: true, beta: 0, gamma: 0});
  assert.equal(ui.node('qb-dial').getAttribute('transform'), 'rotate(-270,100,100)');
  await ui.window.startQibla();
  assert.equal(ui.listenerCount('deviceorientationabsolute'), 0);
  assert.equal(ui.listenerCount('deviceorientation'), 0);
  ui.emit('deviceorientationabsolute', {alpha: 100, absolute: true, beta: 0, gamma: 0});
  assert.equal(ui.node('qb-dial').getAttribute('transform'), 'rotate(0,100,100)');
});

test('leaving the page removes sensor listeners and cancels a pending GPS result', async () => {
  const ui = harness();
  const started = ui.window.startQibla(); await settle();
  assert.equal(ui.listenerCount('deviceorientationabsolute'), 1);
  ui.leave();
  assert.equal(ui.listenerCount('deviceorientationabsolute'), 0);
  ui.locate(40.7128, -74.006); await started;
  assert.equal(ui.node('qb-needle').getAttribute('visibility'), 'hidden');
});

test('unsupported sensors still allow static GPS bearings, while GPS timeout is distinct from denial', async () => {
  const ui = harness({supported: false});
  const started = ui.window.startQibla(); ui.locate(48.8566, 2.3522); await started;
  assertBearing(ui, 48.8566, 2.3522);
  assert.match(ui.node('qibla-status').textContent, /حساس البوصلة غير متاح/);
  const refreshed = ui.window.refreshQiblaLocation(); ui.requests[1].error({code: 3}); await refreshed;
  assert.match(ui.node('qibla-status').textContent, /انتهت مهلة تحديد الموقع/);
  assert.equal(ui.node('qb-needle').getAttribute('visibility'), 'hidden');
});

test('GPS positions too close to the Kaaba never produce a misleading arrow', async () => {
  const ui = harness();
  const started = ui.window.startQibla();
  ui.locate(math.KAABA.latitude, math.KAABA.longitude); await started;
  assert.equal(ui.node('qb-needle').getAttribute('visibility'), 'hidden');
  assert.match(ui.node('qibla-status').textContent, /قريب من الكعبة/);
  assert.match(ui.node('qibla-note').textContent, /الإرشادات المحلية/);
});

test('leaving the page clears old GPS coordinates so a later visit cannot claim a stale current position', async () => {
  const ui = harness();
  const started = ui.window.startQibla(); ui.locate(40.7128, -74.006); await started;
  assertBearing(ui, 40.7128, -74.006);
  ui.leave();
  assert.equal(ui.node('qb-needle').getAttribute('visibility'), 'hidden');
  assert.match(ui.node('qibla-location-text').textContent, /لم يُحدد موقعك/);
  assert.match(ui.node('qibla-btn').textContent, /تحديد موقعي وتشغيل البوصلة/);
});
