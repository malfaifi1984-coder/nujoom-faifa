import test from 'node:test';
import assert from 'node:assert/strict';
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
    current_units: { temperature_2m: '°C', wind_speed_10m: 'km/h' },
    hourly_units: { temperature_2m: '°C', precipitation_probability: '%', precipitation: 'mm' },
    daily_units: { temperature_2m_max: '°C', temperature_2m_min: '°C', precipitation_probability_max: '%', precipitation_sum: 'mm' },
    current: { time: Math.floor(now / 900000) * 900, temperature_2m: 24, weather_code: 2, is_day: 1, wind_speed_10m: 12, wind_direction_10m: 45 },
    hourly: {
      time: Array.from({ length: 120 }, (_, i) => (start + i * HOUR) / 1000),
      temperature_2m: Array(120).fill(24),
      weather_code: Array(120).fill(2),
      is_day: Array.from({ length: 120 }, (_, i) => i % 24 >= 6 && i % 24 < 18 ? 1 : 0),
      precipitation_probability: Array(120).fill(10),
      precipitation: Array(120).fill(0)
    },
    daily: {
      time: Array.from({ length: 5 }, (_, i) => (start + i * DAY) / 1000),
      temperature_2m_max: [27, 26, 28, 25, 26],
      temperature_2m_min: [19, 19, 20, 18, 19],
      weather_code: [2, 61, 0, 61, 2],
      precipitation_probability_max: [40, 30, 0, 40, 10],
      precipitation_sum: [2, 1, 0, 2, 0]
    }
  };
}

test('request fixes Faifa, Saudi time, metric units and automatic model selection', () => {
  const url = new URL(WEATHER_REQUEST_URL);
  assert.equal(url.origin, 'https://api.open-meteo.com');
  assert.equal(url.pathname, '/v1/forecast');
  assert.equal(url.searchParams.get('latitude'), '17.248');
  assert.equal(url.searchParams.get('longitude'), '43.104');
  assert.equal(url.searchParams.get('elevation'), '1186');
  assert.equal(url.searchParams.get('timezone'), 'Asia/Riyadh');
  assert.equal(url.searchParams.get('timeformat'), 'unixtime');
  assert.equal(url.searchParams.get('wind_speed_unit'), 'kmh');
  assert.equal(url.searchParams.get('precipitation_unit'), 'mm');
  assert.equal(url.searchParams.has('models'), false);
  assert.ok(url.searchParams.get('hourly').includes('precipitation_probability'));
});

test('normalization preserves zero measurements and derives true north and night correctly', () => {
  const input = forecast();
  input.current.temperature_2m = 0;
  input.current.is_day = 0;
  input.current.wind_direction_10m = 0;
  input.daily.precipitation_probability_max[0] = 0;
  input.hourly.precipitation_probability[13] = 0;
  const result = normalizeForecast(input, NOW);
  assert.equal(result.current.temperature, 0);
  assert.equal(result.current.isDay, false);
  assert.equal(result.current.windDirectionLabel, 'شمالية');
  assert.equal(result.rain.probability, 0);
  assert.equal(result.hourly[0].rainProbability, 0);
  assert.equal(result.hourly[0].isCurrent, true);
  assert.equal(result.hourly[1].isCurrent, false);
  input.current.wind_speed_10m = 0;
  assert.equal(normalizeForecast(input, NOW).current.windDirectionLabel, 'رياح ساكنة');
});

test('missing or invalid precipitation probabilities remain unavailable rather than becoming zero', () => {
  const input = forecast();
  delete input.hourly.precipitation_probability;
  delete input.daily.precipitation_probability_max;
  const result = normalizeForecast(input, NOW);
  assert.equal(result.rain.probability, null);
  assert.ok(result.hourly.every(row => row.rainProbability === null));
  assert.ok(result.daily.every(row => row.rainProbability === null));
  assert.doesNotMatch(result.summary, /محدودة|لا.*مطر/);
  input.daily.precipitation_probability_max = [null, 101, -1, '0', 0];
  assert.deepEqual(normalizeForecast(input, NOW).daily.map(row => row.rainProbability), [null, null, null, null, 0]);
});

test('Saudi midnight selects the correct current day independently of the UTC date', () => {
  const now = Date.parse('2026-10-31T21:15:00Z'); // November 1, 00:15 in Faifa.
  const input = forecast(now);
  input.current.is_day = 0;
  const result = normalizeForecast(input, now);
  assert.equal(result.daily[0].date, '2026-11-01');
  assert.equal(result.daily[0].dateISO, '2026-11-01');
  assert.equal(result.hourly[0].time, '2026-10-31T21:00:00.000Z');
  assert.equal(result.hourly[0].isDay, false);
  assert.equal(result.rain.probability, input.daily.precipitation_probability_max[0]);
  assert.equal(result.rain.windowLabel, 'اليوم');
});

test('a rain timestamp represents its preceding interval and past rain cannot become a future alert', () => {
  const now = Date.parse('2026-10-31T06:15:00+03:00');
  const input = forecast(now);
  input.hourly.precipitation_probability.fill(null);
  input.hourly.precipitation_probability[6] = 95; // 05:00-06:00 is already over.
  input.hourly.precipitation[6] = 20;
  const dryFuture = normalizeForecast(input, now);
  assert.doesNotMatch(dryFuture.summary, /فرصة أمطار/);
  input.hourly.precipitation_probability[7] = 50; // 06:00-07:00, not 07:00-08:00.
  input.hourly.precipitation[7] = 2;
  assert.equal(normalizeForecast(input, now).summary, 'فرصة أمطار خلال الساعة القادمة');
});

test('hour cards attach upcoming interval rain and condition to their start label', () => {
  const input = forecast(); // At 12:15 Saudi time, the first card begins at 12:00.
  input.hourly.temperature_2m[12] = 24;
  input.hourly.temperature_2m[13] = 26;
  input.hourly.is_day[12] = 1;
  input.hourly.is_day[13] = 0;
  input.hourly.weather_code[12] = 0;
  input.hourly.weather_code[13] = 61;
  input.hourly.precipitation_probability[12] = 5;
  input.hourly.precipitation_probability[13] = 70;
  input.hourly.precipitation[12] = 0;
  input.hourly.precipitation[13] = 3;
  const first = normalizeForecast(input, NOW).hourly[0];
  assert.equal(first.isCurrent, true);
  assert.equal(first.time, '2026-10-31T09:00:00.000Z');
  assert.equal(first.temperature, 24);
  assert.equal(first.isDay, true);
  assert.equal(first.condition.kind, 'rain');
  assert.equal(first.rainProbability, 70);
  assert.equal(first.precipitation, 3);
  assert.equal(first.rainPeriodStart, '2026-10-31T09:00:00.000Z');
  assert.equal(first.rainPeriodEnd, '2026-10-31T10:00:00.000Z');
});

test('the final interval without an ending record stays unavailable', () => {
  const input = forecast();
  const lastHour = input.hourly.time.at(-1) * 1000;
  input.hourly.precipitation_probability[119] = 95;
  input.hourly.precipitation[119] = 10;
  input.hourly.weather_code[119] = 95;
  const result = normalizeForecast(input, lastHour + 15 * 60 * 1000);
  assert.equal(result.hourly.length, 1);
  assert.equal(result.hourly[0].temperature, 24);
  assert.equal(result.hourly[0].condition.kind, 'unknown');
  assert.equal(result.hourly[0].rainProbability, null);
  assert.equal(result.hourly[0].precipitation, null);
  assert.equal(result.hourly[0].rainPeriodEnd, new Date(lastHour + HOUR).toISOString());
});

test('rain summary keeps separate forecast windows separate and is conditional', () => {
  const input = forecast();
  input.hourly.precipitation_probability[15] = 50;
  input.hourly.precipitation_probability[16] = 60;
  input.hourly.precipitation_probability[19] = 90;
  const result = normalizeForecast(input, NOW);
  assert.equal(result.summary, 'فرصة أمطار من ٢ م إلى ٤ م');
  assert.equal(result.summaryIcon, 'rain');
  assert.equal(result.rain.probability, 40); // Daily maximum remains a separate provider field.
  assert.doesNotMatch(result.summary, /ستبدأ|مؤكد|٧ م/);
});

test('forecast condition can support a rain possibility even when probability is unavailable', () => {
  const input = forecast();
  delete input.hourly.precipitation_probability;
  input.hourly.weather_code[14] = 95;
  const result = normalizeForecast(input, NOW);
  assert.equal(result.summaryIcon, 'rain');
  assert.match(result.summary, /^فرصة أمطار/);
  assert.equal(result.hourly[1].condition.kind, 'thunderstorm');
  input.current.weather_code = 10000;
  assert.deepEqual(normalizeForecast(input, NOW).current.condition, { kind: 'unknown', label: 'الحالة غير متاحة' });
});

test('invalid/error payloads, locations, units and misaligned arrays are rejected', () => {
  for (const input of [null, { error: true, reason: 'bad request' }, {}]) assert.throws(() => normalizeForecast(input, NOW));
  const mutations = [
    input => { input.latitude = 25; },
    input => { input.longitude = 45; },
    input => { input.timezone = 'UTC'; },
    input => { input.utc_offset_seconds = 0; },
    input => { input.current_units.wind_speed_10m = 'm/s'; },
    input => { input.daily_units.temperature_2m_max = '°F'; },
    input => { input.current.time = null; },
    input => { input.current.temperature_2m = null; },
    input => { input.hourly.time[2] += 60; },
    input => { input.hourly.temperature_2m.pop(); },
    input => { input.hourly.precipitation_probability.pop(); },
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
