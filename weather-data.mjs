/* Normalize temperature and wind forecasts; fetching and freshness belong to the caller. */
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ZONE = 'Asia/Riyadh';
const LOCATION = Object.freeze({ latitude: 17.248, longitude: 43.104, elevation: 1186 });
const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const finite = value => typeof value === 'number' && Number.isFinite(value);
const bounded = (value, low, high) => finite(value) && value >= low && value <= high ? value : null;

const request = new URL('https://api.open-meteo.com/v1/forecast');
for (const [key, value] of Object.entries({
  ...LOCATION,
  timezone: ZONE,
  forecast_days: 5,
  timeformat: 'unixtime',
  temperature_unit: 'celsius',
  wind_speed_unit: 'kmh',
  current: 'temperature_2m,is_day,wind_speed_10m,wind_direction_10m',
  hourly: 'temperature_2m',
  daily: 'temperature_2m_max,temperature_2m_min'
})) request.searchParams.set(key, String(value));

export const WEATHER_REQUEST_URL = request.href;

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

function isDay(value) { return value === 1 ? true : value === 0 ? false : null; }

function direction(value, speed) {
  if (speed === 0) return 'رياح ساكنة';
  const degrees = bounded(value, 0, 360);
  if (degrees === null) return 'الاتجاه غير متاح';
  return ['شمالية', 'شمالية شرقية', 'شرقية', 'جنوبية شرقية', 'جنوبية', 'جنوبية غربية', 'غربية', 'شمالية غربية'][Math.round(degrees / 45) % 8];
}

/**
 * These values are forecasts, not station observations. Missing or out-of-range
 * optional measurements stay null. Old cached payloads may contain extra fields;
 * they are deliberately ignored rather than passed through to the interface.
 * currentAt lets the controller reject stale network responses and label caches.
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
    isDay: isDay(payload.current?.is_day),
    windSpeed,
    windDirectionLabel: direction(payload.current?.wind_direction_10m, windSpeed)
  };
  const hourly = hourlyTimes.slice(index, index + 12).map((at, offset) => ({
    time: new Date(at).toISOString(),
    isCurrent: offset === 0,
    temperature: bounded(payload.hourly.temperature_2m[index + offset], -90, 65)
  }));
  const today = dateKey.format(now);
  const daily = dailyTimes.map((at, i) => {
    const high = bounded(payload.daily.temperature_2m_max[i], -90, 65);
    const low = bounded(payload.daily.temperature_2m_min[i], -90, 65);
    if (high !== null && low !== null && high < low) return invalid();
    return { date: dateKey.format(at), dateISO: dateKey.format(at), high, low };
  }).filter(row => row.date >= today).slice(0, 5);
  if (daily[0]?.date !== today) return invalid();

  return { current, daily, hourly, currentAt, forecastCurrentAt: currentAt, displayTime: new Date(now).toISOString() };
}
