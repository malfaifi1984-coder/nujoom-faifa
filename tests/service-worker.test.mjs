import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
function worker(fetcher, cached, options = {}) {
  const listeners = {}, timers = [];
  const cache = { match: async () => cached, put: async () => {} };
  runInNewContext(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), {
    self: { location: { origin: 'https://example.test' }, addEventListener: (name, fn) => { listeners[name] = fn; },
      clients: { claim: async () => {}, matchAll: async () => options.clients || [] } },
    caches: { open: async () => cache, keys: async () => options.keys || [], delete: async () => true }, fetch: fetcher, URL, Response, AbortController,
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {}
  });
  function request(path, mode = 'navigate') {
    const event = { request: { method: 'GET', url: `https://example.test${path}`, mode },
      respondWith: (promise) => { event.result = promise; }, waitUntil: (promise) => { event.background = promise; } };
    listeners.fetch(event);
    return event;
  }
  return { request, timers, activate: () => {
    let result;
    listeners.activate({ waitUntil: (promise) => { result = promise; } });
    return result;
  } };
}
test('cached app opens while the navigation network request is still stalled', async () => {
  const { request } = worker(() => new Promise(() => {}), new Response('cached application'));
  const event = request('/?page=weather');
  const response = await Promise.race([event.result, new Promise((_, reject) => setTimeout(() => reject(new Error('Cached page waited for network')), 200))]);
  assert.equal(await response.text(), 'cached application');
});
test('uncached navigation times out instead of hanging on a broken connection', async () => {
  const { request, timers } = worker((_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))));
  const event = request('/');
  timers[0]();
  const response = await event.result;
  assert.equal(response.status, 503);
  assert.match(await response.text(), /تعذر الاتصال/);
  await event.background;
});
test('prayer API responses bypass the static asset cache', () => {
  let called = false;
  const { request } = worker(() => { called = true; });
  const event = request('/.netlify/functions/prayer-times?date=2026-10-28', 'cors');
  assert.equal(event.result, undefined);
  assert.equal(called, false);
});
test('updating an old installed app refreshes its document without waiting on its own navigation', async () => {
  let destination;
  const { activate } = worker(() => {}, undefined, {
    keys: ['nujoom-faifa-pwa-old'],
    clients: [{ url: 'https://example.test/?page=prayer', navigate: (url) => {
      destination = new URL(url);
      return new Promise(() => {});
    } }]
  });
  await Promise.race([activate(), new Promise((_, reject) => setTimeout(() => reject(new Error('Activation waited for navigation')), 200))]);
  assert.equal(destination.searchParams.get('page'), 'prayer');
  assert.match(destination.searchParams.get('updated'), /^nujoom-faifa-pwa-/);
});
