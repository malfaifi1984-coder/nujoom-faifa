import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanTime, prayerInstant, ksaDateKey, fetchPrayerDay } from '../prayer-shared.mjs';
import schedule from '../netlify/functions/schedule-prayer-notifications.mjs';

test('Saudi date boundaries and prayer reminder UTC conversion agree', () => {
  assert.equal(ksaDateKey(new Date('2026-10-27T21:05:00Z')), '2026-10-28');
  assert.equal(prayerInstant('2026-10-28', '05:01', 10), '2026-10-28T01:51:00.000Z');
  assert.equal(prayerInstant('2026-10-28', '00:05', 15), '2026-10-27T20:50:00.000Z');
  assert.equal(cleanTime('05:01 (+03)'), '05:01');
  assert.throws(() => cleanTime('25:00'));
  assert.throws(() => cleanTime('05:99'));
});

test('unified prayer source rejects a response for another date', async () => {
  const response = { code: 200, data: { meta: { timezone: 'Asia/Riyadh' }, date: { gregorian: { date: '27-10-2026' } }, timings: {} } };
  await assert.rejects(fetchPrayerDay('2026-10-28', async () => Response.json(response)), /date does not match/);
});

test('scheduler honors versioned preferences, isolates legacy users, and retries idempotently', async () => {
  const realFetch = globalThis.fetch, RealDate = globalThis.Date, realNetlify = globalThis.Netlify;
  const instant = new RealDate('2026-10-27T21:05:00Z').getTime();
  const messages = [];
  globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [instant])); } static now() { return instant; } };
  globalThis.Netlify = { env: { get: (name) => ({ ONESIGNAL_APP_ID: 'test-app', ONESIGNAL_API_KEY: 'test-key', URL: 'https://example.test' })[name] } };
  globalThis.fetch = async (url, options) => {
    const host = new URL(url).hostname;
    if (host === 'api.aladhan.com') return Response.json({ code: 200, data: { meta: { timezone: 'Asia/Riyadh' }, date: { gregorian: { date: '28-10-2026' } }, timings: { Fajr: '05:01', Sunrise: '06:15', Dhuhr: '12:00', Asr: '15:15', Maghrib: '17:40', Isha: '19:10' } } });
    assert.equal(host, 'api.onesignal.com');
    messages.push(JSON.parse(options.body));
    return Response.json({ id: `test-${messages.length}` });
  };
  try {
    const first = await schedule();
    assert.equal(first.status, 200);
    assert.equal(messages.length, 25);
    const keys = messages.map((m) => m.idempotency_key);
    assert.equal(new Set(keys).size, 25);
    const legacy = messages.filter((m) => m.filters.some((f) => f.key === 'prayer_prefs_version' && f.relation === 'not_exists'));
    assert.equal(legacy.length, 5);
    const v2 = messages.filter((m) => m.filters.some((f) => f.key === 'prayer_prefs_version' && f.value === '2'));
    assert.equal(v2.length, 20);
    assert.equal(v2.filter((m) => m.filters.some((f) => f.key === 'prayer_at_time' && f.value === '1')).length, 5);
    assert.equal(v2.filter((m) => m.filters.some((f) => f.key === 'prayer_lead_minutes' && f.value === '15')).length, 5);
    assert(v2.every((m) => m.filters.some((f) => /^notify_prayer_/.test(f.key) && f.value === '1')));
    await schedule();
    assert.deepEqual(messages.slice(25).map((m) => m.idempotency_key), keys);
    // One failed send does not silently report a successful full schedule.
    globalThis.fetch = async (url, options) => new URL(url).hostname === 'api.onesignal.com' ? Response.json({ errors: ['test failure'] }, { status: 503 }) : realFixture(url, options);
    async function realFixture() { return Response.json({ code: 200, data: { meta: { timezone: 'Asia/Riyadh' }, timings: { Fajr: '05:01', Sunrise: '06:15', Dhuhr: '12:00', Asr: '15:15', Maghrib: '17:40', Isha: '19:10' } } }); }
    assert.equal((await schedule()).status, 500);
  } finally { globalThis.fetch = realFetch; globalThis.Date = RealDate; globalThis.Netlify = realNetlify; }
});
