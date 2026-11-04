/* Explicit ECMWF forecasts through Open-Meteo; fetching and freshness belong to the caller. */
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ZONE = 'Asia/Riyadh';
const LOCATION = Object.freeze({ latitude: 17.248, longitude: 43.104, elevation: 1186 });
const MODEL = 'ecmwf_ifs';
const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const hourLabel = new Intl.DateTimeFormat('ar-SA', { timeZone: ZONE, hour: 'numeric', hour12: true });
const finite = value => typeof value === 'number' && Number.isFinite(value);
const bounded = (value, low, high) => finite(value) && value >= low && value <= high ? value : null;

function requestUrl(core = false) {
  const request = new URL('https://api.open-meteo.com/v1/forecast');
  for (const [key, value] of Object.entries({
    ...LOCATION,
    models: MODEL,
    timezone: ZONE,
    forecast_days: 5,
    timeformat: 'unixtime',
    temperature_unit: 'celsius',
    wind_speed_unit: 'kmh',
    precipitation_unit: 'mm',
    current: core ? 'temperature_2m,is_day,wind_speed_10m,wind_direction_10m'
      : 'temperature_2m,apparent_temperature,is_day,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    hourly: core ? 'temperature_2m,precipitation' : 'temperature_2m,precipitation,precipitation_probability',
    daily: 'temperature_2m_max,temperature_2m_min'
  })) request.searchParams.set(key, String(value));
  return request.href;
}

// Open-Meteo's explicit IFS HRES mapping combines deterministic ECMWF fields with
// precipitation probability from its ECMWF IFS025 ensemble reader. It does not
// switch to Best Match. The core request drops only optional variables.
export const FORECAST_SOURCE_ID = 'open-meteo:ecmwf_ifs:v1';
export const WEATHER_REQUEST_URL = requestUrl();
export const CORE_WEATHER_REQUEST_URL = requestUrl(true);

function invalid() { throw new Error('Weather forecast is unavailable or invalid'); }

function timestamp(value) {
  // UNIX seconds avoid interpreting Saudi timestamps in the phone's timezone.
  if (!finite(value) || value < 946684800 || value > 4102444800) return invalid();
  return value * 1000;
}

function rows(section, required, step) {
  if (!section || !Array.isArray(section.time) || section.time.length === 0) return invalid();
  const times = section.time.map(timestamp);
  for (let index = 1; index < times.length; index++) {
    if (times[index] - times[index - 1] !== step) return invalid();
  }
  for (const field of required) {
    if (!Array.isArray(section[field]) || section[field].length !== times.length) return invalid();
  }
  return times;
}

function checkUnit(units, field, allowed) {
  // Missing units are tolerated; explicitly different units must not be mislabeled.
  if (units?.[field] != null && !allowed.includes(units[field])) return invalid();
}

function optionalUnit(units, field, allowed) {
  return units?.[field] == null || allowed.includes(units[field]);
}

function optionalSeries(section, units, field, length, allowedUnit, low, high) {
  const values = section?.[field];
  if (!Array.isArray(values) || values.length !== length || !optionalUnit(units, field, allowedUnit)) return Array(length).fill(null);
  return values.map(value => bounded(value, low, high));
}

function isDay(value) { return value === 1 ? true : value === 0 ? false : null; }

function direction(value, speed) {
  if (speed === 0) return 'رياح ساكنة';
  const degrees = bounded(value, 0, 360);
  if (degrees === null) return 'الاتجاه غير متاح';
  return ['شمالية', 'شمالية شرقية', 'شرقية', 'جنوبية شرقية', 'جنوبية', 'جنوبية غربية', 'غربية', 'شمالية غربية'][Math.round(degrees / 45) % 8];
}

function periodLabel(start, end, now) {
  const today = dateKey.format(now), tomorrow = dateKey.format(now + DAY);
  const startDay = dateKey.format(start), endDay = dateKey.format(end);
  const day = value => value === today ? 'اليوم' : value === tomorrow ? 'غدًا' : value;
  if (startDay === endDay) return `${startDay === today ? '' : `${day(startDay)} `}من ${hourLabel.format(start)} إلى ${hourLabel.format(end)}`;
  return `من ${hourLabel.format(start)} ${day(startDay)} إلى ${hourLabel.format(end)} ${day(endDay)}`;
}

function rainWindow(intervals, now) {
  const future = intervals.filter(row => Date.parse(row.rainPeriodEnd) > now && Date.parse(row.rainPeriodEnd) <= now + DAY);
  const candidate = row => (row.precipitation !== null && row.precipitation > .1)
    || (row.rainProbability !== null && row.rainProbability >= 30);
  const first = future.findIndex(candidate);
  let selected;
  if (first >= 0) {
    let last = first;
    while (last + 1 < future.length && last - first + 1 < 6
      && future[last + 1].rainPeriodStart === future[last].rainPeriodEnd && candidate(future[last + 1])) last++;
    selected = future.slice(first, last + 1);
  } else selected = future.slice(0, 1);

  if (!selected.length) return {
    probability: null, amount: null, start: null, end: null, windowLabel: 'الفترة غير متاحة',
    available: false, probabilityAvailable: false
  };
  // The displayed probability is the maximum HOURLY probability in this exact
  // period, not the probability of at least one event across the whole period.
  // Partial series stay unavailable; neither unknown values nor a positive
  // deterministic precipitation amount can be converted to a probability.
  const probability = selected.every(row => row.rainProbability !== null)
    ? Math.max(...selected.map(row => row.rainProbability)) : null;
  const amount = selected.every(row => row.precipitation !== null)
    ? Number(selected.reduce((sum, row) => sum + row.precipitation, 0).toFixed(3)) : null;
  const start = selected[0].rainPeriodStart, end = selected.at(-1).rainPeriodEnd;
  return {
    probability, amount, start, end, windowLabel: periodLabel(Date.parse(start), Date.parse(end), now),
    available: probability !== null || amount !== null,
    probabilityAvailable: probability !== null
  };
}

/**
 * These values are forecasts, not station observations. Missing or out-of-range
 * optional measurements stay null. The caller must only pass responses from the
 * exported explicit-model URLs, and must reject caches without FORECAST_SOURCE_ID.
 * Raw responses do not carry a model identifier, so location validation alone
 * cannot prove provenance. currentAt lets the controller enforce freshness.
 */
export function normalizeForecast(payload, now = Date.now()) {
  if (!payload || payload.error || !finite(now)) return invalid();
  if (!finite(payload.latitude) || !finite(payload.longitude)
      || Math.abs(payload.latitude - LOCATION.latitude) > 1
      || Math.abs(payload.longitude - LOCATION.longitude) > 1
      || payload.timezone !== ZONE
      || (payload.utc_offset_seconds != null && payload.utc_offset_seconds !== 10800)) return invalid();

  checkUnit(payload.current_units, 'temperature_2m', ['°C']);
  checkUnit(payload.current_units, 'wind_speed_10m', ['km/h']);
  checkUnit(payload.current_units, 'wind_direction_10m', ['°']);
  checkUnit(payload.hourly_units, 'temperature_2m', ['°C']);
  checkUnit(payload.daily_units, 'temperature_2m_max', ['°C']);
  checkUnit(payload.daily_units, 'temperature_2m_min', ['°C']);

  const currentAt = timestamp(payload.current?.time);
  const currentTemperature = bounded(payload.current?.temperature_2m, -90, 65);
  if (currentTemperature === null) return invalid();
  const hourlyTimes = rows(payload.hourly, ['temperature_2m'], HOUR);
  const dailyTimes = rows(payload.daily, ['temperature_2m_max', 'temperature_2m_min'], DAY);
  const index = hourlyTimes.findIndex(at => at <= now && now < at + HOUR);
  if (index < 0) return invalid();

  const windSpeed = bounded(payload.current?.wind_speed_10m, 0, 600);
  const current = {
    temperature: currentTemperature,
    apparentTemperature: optionalUnit(payload.current_units, 'apparent_temperature', ['°C'])
      ? bounded(payload.current?.apparent_temperature, -120, 100) : null,
    isDay: isDay(payload.current?.is_day),
    windSpeed,
    windDirectionLabel: direction(payload.current?.wind_direction_10m, windSpeed),
    windGusts: optionalUnit(payload.current_units, 'wind_gusts_10m', ['km/h'])
      ? bounded(payload.current?.wind_gusts_10m, 0, 600) : null
  };
  const precipitation = optionalSeries(payload.hourly, payload.hourly_units, 'precipitation', hourlyTimes.length, ['mm'], 0, 1000);
  const probability = optionalSeries(payload.hourly, payload.hourly_units, 'precipitation_probability', hourlyTimes.length, ['%'], 0, 100);
  const intervals = hourlyTimes.slice(index, index + 24).map((at, offset) => {
    const row = index + offset, end = row + 1;
    // Accumulated/probability values at T describe the hour preceding T. Cards
    // are labeled by the interval START, so use the record ending one hour later.
    // Do not clip a partly elapsed first period and then assign its whole amount.
    return {
      time: new Date(at).toISOString(),
      isCurrent: offset === 0,
      temperature: bounded(payload.hourly.temperature_2m[row], -90, 65),
      precipitation: precipitation[end] ?? null,
      rainProbability: probability[end] ?? null,
      rainPeriodStart: new Date(at).toISOString(),
      rainPeriodEnd: new Date(at + HOUR).toISOString()
    };
  });
  const today = dateKey.format(now);
  const daily = dailyTimes.map((at, i) => {
    const high = bounded(payload.daily.temperature_2m_max[i], -90, 65);
    const low = bounded(payload.daily.temperature_2m_min[i], -90, 65);
    if (high !== null && low !== null && high < low) return invalid();
    return { date: dateKey.format(at), dateISO: dateKey.format(at), high, low };
  }).filter(row => row.date >= today).slice(0, 5);
  if (daily[0]?.date !== today) return invalid();

  return {
    sourceId: FORECAST_SOURCE_ID,
    current,
    daily,
    hourly: intervals.slice(0, 12),
    rain: rainWindow(intervals, now),
    currentAt,
    currentInterval: bounded(payload.current?.interval, 1, HOUR / 1000),
    forecastCurrentAt: currentAt,
    displayTime: new Date(now).toISOString()
  };
}
