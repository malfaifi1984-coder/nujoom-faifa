import test from 'node:test';
import assert from 'node:assert/strict';
import { FORECAST_SOURCE_ID, WEATHER_REQUEST_URL, CORE_WEATHER_REQUEST_URL, normalizeForecast } from '../weather-data.mjs';

const HOUR = 3600000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-11-04T12:15:00+03:00');
const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' });

function forecast(now = NOW) {
  const start = Date.parse(`${key.format(now)}T00:00:00+03:00`);
  return {
    latitude: 17.25,
    longitude: 43.1,
    timezone: 'Asia/Riyadh',
    utc_offset_seconds: 10800,
    current_units: { temperature_2m: '°C', apparent_temperature: '°C', wind_speed_10m: 'km/h', wind_direction_10m: '°', wind_gusts_10m: 'km/h' },
    hourly_units: { temperature_2m: '°C', precipitation: 'mm', precipitation_probability: '%' },
    daily_units: { temperature_2m_max: '°C', temperature_2m_min: '°C' },
    current: { time: Math.floor(now / 900000) * 900, interval: 900, temperature_2m: 24, apparent_temperature: 23, is_day: 1, wind_speed_10m: 12, wind_direction_10m: 45, wind_gusts_10m: 20 },
    hourly: {
      time: Array.from({ length: 120 }, (_, i) => (start + i * HOUR) / 1000),
      temperature_2m: Array(120).fill(24),
      precipitation: Array(120).fill(0),
      precipitation_probability: Array(120).fill(0)
    },
    daily: {
      time: Array.from({ length: 5 }, (_, i) => (start + i * DAY) / 1000),
      temperature_2m_max: [27, 26, 28, 25, 26],
      temperature_2m_min: [19, 19, 20, 18, 19]
    }
  };
}

test('primary and optional-variable fallback both explicitly select ECMWF IFS HRES', () => {
  for (const address of [WEATHER_REQUEST_URL, CORE_WEATHER_REQUEST_URL]) {
    const url = new URL(address);
    assert.equal(url.origin, 'https://api.open-meteo.com');
    assert.equal(url.pathname, '/v1/forecast');
    assert.equal(url.searchParams.get('models'), 'ecmwf_ifs');
    assert.equal(url.searchParams.get('latitude'), '17.248');
    assert.equal(url.searchParams.get('longitude'), '43.104');
    assert.equal(url.searchParams.get('elevation'), '1186');
    assert.equal(url.searchParams.get('timezone'), 'Asia/Riyadh');
    assert.equal(url.searchParams.get('timeformat'), 'unixtime');
    assert.equal(url.searchParams.get('temperature_unit'), 'celsius');
    assert.equal(url.searchParams.get('wind_speed_unit'), 'kmh');
    assert.equal(url.searchParams.get('precipitation_unit'), 'mm');
    assert.equal(url.searchParams.get('daily'), 'temperature_2m_max,temperature_2m_min');
  }
  const primary = new URL(WEATHER_REQUEST_URL), core = new URL(CORE_WEATHER_REQUEST_URL);
  assert.match(primary.searchParams.get('current'), /apparent_temperature/);
  assert.match(primary.searchParams.get('current'), /wind_gusts_10m/);
  assert.match(primary.searchParams.get('hourly'), /precipitation_probability/);
  assert.doesNotMatch(core.searchParams.get('current'), /apparent_temperature|wind_gusts_10m/);
  assert.equal(core.searchParams.get('hourly'), 'temperature_2m,precipitation');
  assert.equal(FORECAST_SOURCE_ID, 'open-meteo:ecmwf_ifs:v1');
});

test('normalization preserves zero measurements, true north, night and calm wind', () => {
  const input = forecast();
  input.current.temperature_2m = 0;
  input.current.apparent_temperature = 0;
  input.current.wind_gusts_10m = 0;
  input.current.is_day = 0;
  input.current.wind_direction_10m = 0;
  input.hourly.temperature_2m[12] = 0;
  input.daily.temperature_2m_min[0] = 0;
  const result = normalizeForecast(input, NOW);
  assert.equal(result.current.temperature, 0);
  assert.equal(result.current.apparentTemperature, 0);
  assert.equal(result.current.windGusts, 0);
  assert.equal(result.current.isDay, false);
  assert.equal(result.current.windDirectionLabel, 'شمالية');
  assert.equal(result.hourly[0].temperature, 0);
  assert.equal(result.daily[0].low, 0);
  assert.equal(result.rain.probability, 0);
  assert.equal(result.rain.amount, 0);
  assert.equal(result.rain.probabilityAvailable, true);
  input.current.wind_speed_10m = 0;
  assert.equal(normalizeForecast(input, NOW).current.windDirectionLabel, 'رياح ساكنة');
});

test('missing or invalid optional measurements stay unavailable without losing the core forecast', () => {
  const input = forecast();
  input.hourly.temperature_2m[12] = null;
  input.hourly.temperature_2m[13] = '0';
  input.hourly.temperature_2m[14] = 80;
  input.daily.temperature_2m_min[0] = null;
  input.daily.temperature_2m_max[1] = undefined;
  input.current.wind_speed_10m = -1;
  input.current.wind_direction_10m = null;
  delete input.current.apparent_temperature;
  delete input.current.wind_gusts_10m;
  delete input.hourly.precipitation_probability;
  delete input.hourly.precipitation;
  const result = normalizeForecast(input, NOW);
  assert.deepEqual(result.hourly.slice(0, 3).map(row => row.temperature), [null, null, null]);
  assert.equal(result.daily[0].low, null);
  assert.equal(result.daily[1].high, null);
  assert.equal(result.current.windSpeed, null);
  assert.equal(result.current.apparentTemperature, null);
  assert.equal(result.current.windGusts, null);
  assert.equal(result.current.windDirectionLabel, 'الاتجاه غير متاح');
  assert.equal(result.rain.amount, null);
  assert.equal(result.rain.probability, null);
  assert.equal(result.rain.available, false);
  assert.equal(result.rain.probabilityAvailable, false);
});

test('incorrect optional units or array lengths cannot corrupt the core forecast', () => {
  const input = forecast();
  input.current_units.apparent_temperature = '°F';
  input.current_units.wind_gusts_10m = 'm/s';
  input.hourly_units.precipitation = 'inch';
  input.hourly.precipitation_probability.pop();
  const result = normalizeForecast(input, NOW);
  assert.equal(result.current.temperature, 24);
  assert.equal(result.current.apparentTemperature, null);
  assert.equal(result.current.windGusts, null);
  assert.equal(result.rain.amount, null);
  assert.equal(result.rain.probability, null);
  assert.ok(result.hourly.every(row => row.precipitation === null && row.rainProbability === null));
});

test('Saudi midnight selects its date independently of UTC and retains five days', () => {
  const now = Date.parse('2026-11-04T21:15:00Z'); // November 5, 00:15 in Faifa.
  const input = forecast(now);
  input.current.is_day = 0;
  const result = normalizeForecast(input, now);
  assert.equal(result.daily.length, 5);
  assert.equal(result.daily[0].date, '2026-11-05');
  assert.equal(result.daily[0].dateISO, '2026-11-05');
  assert.equal(result.hourly[0].time, '2026-11-04T21:00:00.000Z');
  assert.equal(result.current.isDay, false);
});

test('hour cards use their own temperature and the precipitation interval ending one hour later', () => {
  const input = forecast();
  input.hourly.temperature_2m[12] = 24;
  input.hourly.temperature_2m[13] = 26;
  input.hourly.precipitation[12] = 20; // 11:00-12:00 is already past.
  input.hourly.precipitation_probability[12] = 100;
  input.hourly.precipitation[13] = 2;
  input.hourly.precipitation_probability[13] = 40;
  const result = normalizeForecast(input, NOW);
  const first = result.hourly[0];
  assert.equal(result.hourly.length, 12);
  assert.equal(first.temperature, 24);
  assert.equal(first.isCurrent, true);
  assert.equal(first.time, '2026-11-04T09:00:00.000Z');
  assert.equal(first.rainPeriodStart, first.time);
  assert.equal(first.rainPeriodEnd, '2026-11-04T10:00:00.000Z');
  assert.equal(first.precipitation, 2);
  assert.equal(first.rainProbability, 40);
  assert.equal(result.rain.start, first.time); // Full 12:00-13:00, never clipped to 12:15.
  assert.equal(result.rain.end, first.rainPeriodEnd);
  assert.equal(result.rain.amount, 2);
  assert.equal(result.rain.probability, 40);
  assert.equal(result.rain.windowLabel, 'من ١٢ م إلى ١ م');
});

test('main rain amount and maximum hourly probability cover the same first contiguous window', () => {
  const input = forecast();
  input.hourly.precipitation[15] = 2; // 14:00-15:00.
  input.hourly.precipitation[16] = 3; // 15:00-16:00.
  input.hourly.precipitation_probability[15] = 40;
  input.hourly.precipitation_probability[16] = 60;
  input.hourly.precipitation[19] = 20; // Separate later window must not be merged.
  input.hourly.precipitation_probability[19] = 95;
  const result = normalizeForecast(input, NOW);
  assert.equal(result.rain.start, '2026-11-04T11:00:00.000Z');
  assert.equal(result.rain.end, '2026-11-04T13:00:00.000Z');
  assert.equal(result.rain.windowLabel, 'من ٢ م إلى ٤ م');
  assert.equal(result.rain.amount, 5);
  assert.equal(result.rain.probability, 60);
  assert.equal(result.rain.available, true);
  assert.doesNotMatch(result.rain.windowLabel, /مؤكد|ستبدأ|٧ م/);
});

test('a deterministic precipitation amount never invents a probability', () => {
  const input = forecast();
  delete input.hourly.precipitation_probability;
  input.hourly.precipitation[15] = 2;
  const result = normalizeForecast(input, NOW);
  assert.equal(result.rain.amount, 2);
  assert.equal(result.rain.probability, null);
  assert.equal(result.rain.probabilityAvailable, false);
  assert.equal(result.rain.available, true);
  assert.equal(result.hourly[2].rainProbability, null);
});

test('partly missing window measurements are not summed or promoted to a complete probability', () => {
  const input = forecast();
  input.hourly.precipitation[15] = 2;
  input.hourly.precipitation[16] = 3;
  input.hourly.precipitation_probability[15] = 40;
  input.hourly.precipitation_probability[16] = null;
  let result = normalizeForecast(input, NOW);
  assert.equal(result.rain.amount, 5);
  assert.equal(result.rain.probability, null);
  input.hourly.precipitation[16] = null;
  input.hourly.precipitation_probability[16] = 50;
  result = normalizeForecast(input, NOW);
  assert.equal(result.rain.amount, null);
  assert.equal(result.rain.probability, 50);
});

test('a rain period is capped at six hours and does not inherit a daily probability', () => {
  const input = forecast();
  for (let end = 15; end <= 22; end++) {
    input.hourly.precipitation[end] = 1;
    input.hourly.precipitation_probability[end] = 40;
  }
  input.daily.precipitation_probability_max = [99, 99, 99, 99, 99];
  const result = normalizeForecast(input, NOW);
  assert.equal(Date.parse(result.rain.end) - Date.parse(result.rain.start), 6 * HOUR);
  assert.equal(result.rain.amount, 6);
  assert.equal(result.rain.probability, 40);
});

test('rain periods crossing Saudi midnight label both dates correctly', () => {
  const now = Date.parse('2026-11-04T22:15:00+03:00');
  const input = forecast(now);
  for (const end of [24, 25, 26]) input.hourly.precipitation[end] = 1;
  const result = normalizeForecast(input, now);
  assert.equal(result.rain.windowLabel, 'من ١١ م اليوم إلى ٢ ص غدًا');
  assert.equal(result.rain.amount, 3);
  assert.equal(result.rain.start, '2026-11-04T20:00:00.000Z');
  assert.equal(result.rain.end, '2026-11-04T23:00:00.000Z');
});

test('no ending record means unavailable interval measurements rather than fabricated zeros', () => {
  const input = forecast();
  const last = input.hourly.time.at(-1) * 1000;
  const result = normalizeForecast(input, last + 15 * 60 * 1000);
  assert.equal(result.hourly.length, 1);
  assert.equal(result.hourly[0].temperature, 24);
  assert.equal(result.hourly[0].precipitation, null);
  assert.equal(result.hourly[0].rainProbability, null);
  assert.equal(result.rain.available, false);
});

test('invalid core payloads, locations, units and misaligned arrays are rejected', () => {
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

test('metadata preserves source and current timestamp for cache provenance and freshness checks', () => {
  const input = forecast();
  input.current.time -= 4 * HOUR / 1000;
  const result = normalizeForecast(input, NOW);
  assert.equal(result.sourceId, FORECAST_SOURCE_ID);
  assert.equal(result.currentAt, NOW - 4 * HOUR);
  assert.equal(result.forecastCurrentAt, result.currentAt);
  assert.equal(result.currentInterval, 900);
  assert.equal(result.displayTime, new Date(NOW).toISOString());
});
