import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WEATHER_REQUEST_URL, normalizeForecast } from '../weather-data.mjs';

const HOUR = 3600000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-10-31T12:15:00+03:00');
const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' });

function forecast(now = NOW) {
  const start = Date.parse(`${key.format(now)}T00:00:00+03:00`);
  return {
    latitude: 17.25,
    longitude: 43.1,
    timezone: 'Asia/Riyadh',
    utc_offset_seconds: 10800,
    current_units: { temperature_2m: '°C', wind_speed_10m: 'km/h', wind_direction_10m: '°' },
    hourly_units: { temperature_2m: '°C' },
    daily_units: { temperature_2m_max: '°C', temperature_2m_min: '°C' },
    current: { time: Math.floor(now / 900000) * 900, temperature_2m: 24, is_day: 1, wind_speed_10m: 12, wind_direction_10m: 45 },
    hourly: {
      time: Array.from({ length: 120 }, (_, i) => (start + i * HOUR) / 1000),
      temperature_2m: Array(120).fill(24)
    },
    daily: {
      time: Array.from({ length: 5 }, (_, i) => (start + i * DAY) / 1000),
      temperature_2m_max: [27, 26, 28, 25, 26],
      temperature_2m_min: [19, 19, 20, 18, 19]
    }
  };
}

test('request asks only for temperature, wind and daylight with metric units in Faifa', () => {
  const url = new URL(WEATHER_REQUEST_URL);
  assert.equal(url.origin, 'https://api.open-meteo.com');
  assert.equal(url.pathname, '/v1/forecast');
  assert.equal(url.searchParams.get('latitude'), '17.248');
  assert.equal(url.searchParams.get('longitude'), '43.104');
  assert.equal(url.searchParams.get('elevation'), '1186');
  assert.equal(url.searchParams.get('timezone'), 'Asia/Riyadh');
  assert.equal(url.searchParams.get('timeformat'), 'unixtime');
  assert.equal(url.searchParams.get('wind_speed_unit'), 'kmh');
  assert.equal(url.searchParams.get('current'), 'temperature_2m,is_day,wind_speed_10m,wind_direction_10m');
  assert.equal(url.searchParams.get('hourly'), 'temperature_2m');
  assert.equal(url.searchParams.get('daily'), 'temperature_2m_max,temperature_2m_min');
  assert.equal(url.searchParams.has('models'), false);
  assert.doesNotMatch(url.search, /precip|probability|weather_code/);
});

test('normalization preserves zero temperatures, true north, night and calm wind', () => {
  const input = forecast();
  input.current.temperature_2m = 0;
  input.current.is_day = 0;
  input.current.wind_direction_10m = 0;
  input.hourly.temperature_2m[12] = 0;
  input.daily.temperature_2m_min[0] = 0;
  const result = normalizeForecast(input, NOW);
  assert.equal(result.current.temperature, 0);
  assert.equal(result.current.isDay, false);
  assert.equal(result.current.windDirectionLabel, 'شمالية');
  assert.equal(result.hourly[0].temperature, 0);
  assert.equal(result.daily[0].low, 0);
  assert.equal(result.hourly[0].isCurrent, true);
  assert.equal(result.hourly[1].isCurrent, false);
  input.current.wind_speed_10m = 0;
  assert.equal(normalizeForecast(input, NOW).current.windDirectionLabel, 'رياح ساكنة');
});

test('missing or out-of-range optional temperatures and wind stay null instead of zero', () => {
  const input = forecast();
  input.hourly.temperature_2m[12] = null;
  input.hourly.temperature_2m[13] = '0';
  input.hourly.temperature_2m[14] = 80;
  input.daily.temperature_2m_min[0] = null;
  input.daily.temperature_2m_max[1] = undefined;
  input.current.wind_speed_10m = -1;
  input.current.wind_direction_10m = null;
  const result = normalizeForecast(input, NOW);
  assert.deepEqual(result.hourly.slice(0, 3).map(row => row.temperature), [null, null, null]);
  assert.equal(result.daily[0].low, null);
  assert.equal(result.daily[1].high, null);
  assert.equal(result.current.windSpeed, null);
  assert.equal(result.current.windDirectionLabel, 'الاتجاه غير متاح');
});

test('Saudi midnight selects its date independently of UTC and retains all five days', () => {
  const now = Date.parse('2026-10-31T21:15:00Z'); // November 1, 00:15 in Faifa.
  const input = forecast(now);
  input.current.is_day = 0;
  const result = normalizeForecast(input, now);
  assert.equal(result.daily.length, 5);
  assert.equal(result.daily[0].date, '2026-11-01');
  assert.equal(result.daily[0].dateISO, '2026-11-01');
  assert.equal(result.hourly[0].time, '2026-10-31T21:00:00.000Z');
  assert.equal(result.current.isDay, false);
});

test('hourly temperatures describe their own timestamps without shifting to the next hour', () => {
  const input = forecast();
  input.hourly.temperature_2m[12] = 24;
  input.hourly.temperature_2m[13] = 26;
  const result = normalizeForecast(input, NOW);
  assert.equal(result.hourly.length, 12);
  assert.deepEqual(result.hourly[0], { time: '2026-10-31T09:00:00.000Z', isCurrent: true, temperature: 24 });
  assert.deepEqual(result.hourly[1], { time: '2026-10-31T10:00:00.000Z', isCurrent: false, temperature: 26 });
});

test('old cached condition and precipitation fields cannot leak into normalized output', () => {
  const input = forecast();
  input.current.weather_code = 95;
  input.hourly.weather_code = [95]; // Even mismatched obsolete fields are ignored.
  input.hourly.precipitation_probability = [100];
  input.hourly.precipitation = [20];
  input.daily.weather_code = [95];
  input.daily.precipitation_probability_max = [100];
  input.daily.precipitation_sum = [100];
  const result = normalizeForecast(input, NOW);
  assert.deepEqual(Object.keys(result).sort(), ['current', 'currentAt', 'daily', 'displayTime', 'forecastCurrentAt', 'hourly']);
  assert.doesNotMatch(JSON.stringify(result), /rain|precip|probability|condition|summary|weather_code/i);
  assert.equal(result.daily.length, 5);
});

test('invalid/error payloads, locations, units and misaligned arrays are rejected', () => {
  for (const input of [null, { error: true, reason: 'bad request' }, {}]) assert.throws(() => normalizeForecast(input, NOW));
  const mutations = [
    input => { input.latitude = 25; },
    input => { input.longitude = 45; },
    input => { input.timezone = 'UTC'; },
    input => { input.utc_offset_seconds = 0; },
    input => { input.current_units.wind_speed_10m = 'm/s'; },
    input => { input.current_units.wind_direction_10m = 'rad'; },
    input => { input.daily_units.temperature_2m_max = '°F'; },
    input => { input.current.time = null; },
    input => { input.current.temperature_2m = null; },
    input => { input.hourly.time[2] += 60; },
    input => { input.hourly.temperature_2m.pop(); },
    input => { input.daily.temperature_2m_min.pop(); },
    input => { input.daily.temperature_2m_min[0] = 50; }
  ];
  for (const mutate of mutations) {
    const input = forecast();
    mutate(input);
    assert.throws(() => normalizeForecast(input, NOW));
  }
});

test('cache controllers receive the original current timestamp instead of an invented fresh time', () => {
  const input = forecast();
  input.current.time -= 4 * HOUR / 1000;
  const result = normalizeForecast(input, NOW);
  assert.equal(result.currentAt, NOW - 4 * HOUR);
  assert.equal(result.forecastCurrentAt, result.currentAt);
  assert.equal(result.displayTime, new Date(NOW).toISOString());
});

test('Weather presentation has no precipitation or source markup and keeps untitled daily rows', () => {
  const renderer = readFileSync(new URL('../weather-cards.mjs', import.meta.url), 'utf8');
  const controller = readFileSync(new URL('../weather-ui.js', import.meta.url), 'utf8');
  assert.doesNotMatch(renderer, /مطر|أمطار|هطول|رعد|wc-rain|wc-lightning|rain|storm|precip|percent|probability/i);
  assert.doesNotMatch(renderer, /الأيام الخمسة|wc-attribution|open-meteo\.com/i);
  assert.match(renderer, /aria-label="توقعات درجات الحرارة للأيام القادمة"/);
  assert.match(renderer, /درجة الحرارة الآن/);
  assert.match(renderer, /class="wc-update"/);
  assert.doesNotMatch(controller, /wc-attribution|createElement\('a'\)|open-meteo\.com|Open-Meteo/);
});
