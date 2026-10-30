/* Normalize Open-Meteo forecasts for Faifa; fetching and cache freshness belong to the caller. */
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ZONE = 'Asia/Riyadh';
const LOCATION = Object.freeze({ latitude: 17.248, longitude: 43.104, elevation: 1186 });
const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const hourLabel = new Intl.DateTimeFormat('ar-SA', { timeZone: ZONE, hour: 'numeric', hour12: true });
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
  precipitation_unit: 'mm',
  current: 'temperature_2m,weather_code,is_day,wind_speed_10m,wind_direction_10m',
  hourly: 'temperature_2m,weather_code,precipitation_probability,precipitation,is_day',
  daily: 'temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,precipitation_sum'
})) request.searchParams.set(key, String(value));

export const WEATHER_REQUEST_URL = request.href;

function invalid() { throw new Error('Weather forecast is unavailable or invalid'); }

function timestamp(value) {
  // The request explicitly asks for UNIX seconds, independent of the browser's timezone.
  if (!finite(value) || value < 946684800 || value > 4102444800) return invalid();
  return value * 1000;
}

function rows(section, required, optional, step) {
  if (!section || !Array.isArray(section.time) || section.time.length === 0) return invalid();
  const times = section.time.map(timestamp);
  for (let index = 1; index < times.length; index++) {
    if (times[index] - times[index - 1] !== step) return invalid();
  }
  for (const field of required) {
    if (!Array.isArray(section[field]) || section[field].length !== times.length) return invalid();
  }
  for (const field of optional) {
    if (section[field] != null && (!Array.isArray(section[field]) || section[field].length !== times.length)) return invalid();
  }
  return times;
}

function checkUnit(units, field, allowed) {
  // Missing units are tolerated, but an explicitly different unit must never be mislabeled.
  if (units?.[field] != null && !allowed.includes(units[field])) return invalid();
}

function condition(code) {
  if (code === 0) return { kind: 'clear', label: 'سماء صافية' };
  if (code === 1) return { kind: 'partly-cloudy', label: 'غائم قليلًا' };
  if (code === 2) return { kind: 'partly-cloudy', label: 'غائم جزئيًا' };
  if (code === 3) return { kind: 'cloudy', label: 'غائم' };
  if (code === 45 || code === 48) return { kind: 'foggy', label: 'ضباب' };
  if ([51, 53, 55].includes(code)) return { kind: 'rain', label: 'رذاذ' };
  if ([56, 57].includes(code)) return { kind: 'rain', label: 'رذاذ متجمّد' };
  if (code === 61) return { kind: 'rain', label: 'أمطار خفيفة' };
  if (code === 63) return { kind: 'rain', label: 'أمطار متوسطة' };
  if (code === 65) return { kind: 'rain', label: 'أمطار غزيرة' };
  if ([66, 67].includes(code)) return { kind: 'rain', label: 'أمطار متجمّدة' };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { kind: 'snowy', label: 'هطول ثلجي' };
  if ([80, 81, 82].includes(code)) return { kind: 'showers', label: 'زخات أمطار' };
  if ([95, 96, 99].includes(code)) return { kind: 'thunderstorm', label: 'أمطار رعدية' };
  return { kind: 'unknown', label: 'الحالة غير متاحة' };
}

function isDay(value) { return value === 1 ? true : value === 0 ? false : null; }

function direction(value, speed) {
  if (speed === 0) return 'رياح ساكنة';
  const degrees = bounded(value, 0, 360);
  if (degrees === null) return 'الاتجاه غير متاح';
  return ['شمالية', 'شمالية شرقية', 'شرقية', 'جنوبية شرقية', 'جنوبية', 'جنوبية غربية', 'غربية', 'شمالية غربية'][Math.round(degrees / 45) % 8];
}

function periodLabel(start, end, now) {
  if (start <= now && end <= now + HOUR) return 'خلال الساعة القادمة';
  const today = dateKey.format(now);
  const tomorrow = dateKey.format(now + DAY);
  const startDay = dateKey.format(start), endDay = dateKey.format(end);
  const day = key => key === today ? 'اليوم' : key === tomorrow ? 'غدًا' : key;
  if (startDay === endDay) {
    return `${startDay === today ? '' : `${day(startDay)} `}من ${hourLabel.format(start)} إلى ${hourLabel.format(end)}`;
  }
  return `من ${hourLabel.format(start)} ${day(startDay)} إلى ${hourLabel.format(end)} ${day(endDay)}`;
}

function summarize(records, current, now) {
  // Both precipitation amount and probability describe the hour PRECEDING their
  // timestamp. Only future interval ends are considered; past rain never creates
  // an upcoming-rain message, and gaps between rainy intervals remain gaps.
  const future = records.filter(row => row.at > now && row.at <= now + DAY);
  const rainy = row => (row.rainProbability !== null && row.rainProbability >= 30)
    || ['rain', 'showers', 'thunderstorm'].includes(row.condition.kind);
  const first = future.findIndex(rainy);
  if (first >= 0) {
    let last = first;
    while (last + 1 < future.length && future[last + 1].at - future[last].at === HOUR && rainy(future[last + 1])) last++;
    const start = Math.max(now, future[first].at - HOUR), end = future[last].at;
    return { summary: `فرصة أمطار ${periodLabel(start, end, now)}`, summaryIcon: 'rain' };
  }
  const nextTwelve = future.slice(0, 12);
  if (nextTwelve.length === 12 && nextTwelve.every(row => row.rainProbability !== null && row.rainProbability < 30)) {
    return { summary: 'فرصة المطر محدودة خلال الساعات القادمة', summaryIcon: current.condition.kind };
  }
  return {
    summary: current.condition.kind === 'unknown' ? 'تابع توقعات الساعات القادمة' : `الحالة المتوقعة الآن: ${current.condition.label}`,
    summaryIcon: current.condition.kind
  };
}

/**
 * All values are forecasts, not local station observations. Optional missing or
 * out-of-range measurements remain null; they are never converted to zero.
 * The returned currentAt lets the controller reject stale network responses
 * while still deciding whether to show an explicitly labeled cached forecast.
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
  checkUnit(payload.hourly_units, 'temperature_2m', ['°C']);
  checkUnit(payload.hourly_units, 'precipitation', ['mm']);
  checkUnit(payload.hourly_units, 'precipitation_probability', ['%']);
  checkUnit(payload.daily_units, 'temperature_2m_max', ['°C']);
  checkUnit(payload.daily_units, 'temperature_2m_min', ['°C']);
  checkUnit(payload.daily_units, 'precipitation_sum', ['mm']);
  checkUnit(payload.daily_units, 'precipitation_probability_max', ['%']);

  const currentAt = timestamp(payload.current?.time);
  const currentTemperature = bounded(payload.current?.temperature_2m, -90, 65);
  if (currentTemperature === null) return invalid();
  const hourlyTimes = rows(payload.hourly, ['temperature_2m', 'weather_code', 'is_day'], ['precipitation_probability', 'precipitation'], HOUR);
  const dailyTimes = rows(payload.daily, ['temperature_2m_max', 'temperature_2m_min', 'weather_code'], ['precipitation_probability_max', 'precipitation_sum'], DAY);
  const index = hourlyTimes.findIndex(at => at <= now && now < at + HOUR);
  if (index < 0) return invalid();

  const windSpeed = bounded(payload.current?.wind_speed_10m, 0, 600);
  const current = {
    temperature: currentTemperature,
    condition: condition(payload.current?.weather_code),
    isDay: isDay(payload.current?.is_day),
    windSpeed,
    windDirectionLabel: direction(payload.current?.wind_direction_10m, windSpeed)
  };
  const allHours = hourlyTimes.map((at, i) => ({
    at,
    time: new Date(at).toISOString(),
    isCurrent: i === index,
    temperature: bounded(payload.hourly.temperature_2m[i], -90, 65),
    condition: condition(payload.hourly.weather_code[i]),
    isDay: isDay(payload.hourly.is_day[i]),
    rainProbability: bounded(payload.hourly.precipitation_probability?.[i], 0, 100),
    precipitation: bounded(payload.hourly.precipitation?.[i], 0, 1000)
  }));
  const today = dateKey.format(now);
  const daily = dailyTimes.map((at, i) => {
    const high = bounded(payload.daily.temperature_2m_max[i], -90, 65);
    const low = bounded(payload.daily.temperature_2m_min[i], -90, 65);
    if (high !== null && low !== null && high < low) return invalid();
    return {
      date: dateKey.format(at),
      dateISO: dateKey.format(at),
      high,
      low,
      condition: condition(payload.daily.weather_code[i]),
      rainProbability: bounded(payload.daily.precipitation_probability_max?.[i], 0, 100),
      precipitation: bounded(payload.daily.precipitation_sum?.[i], 0, 3000)
    };
  }).filter(row => row.date >= today).slice(0, 5);
  if (daily[0]?.date !== today) return invalid();

  // Cards are labeled by the START of their hour (the first says "الآن").
  // Instantaneous temperature/daylight stay at that start, while condition,
  // rain probability and amount describe the interval ending at the NEXT row.
  // Keep allHours unchanged: summarize() consumes the provider's end timestamps.
  const hourly = allHours.slice(index, index + 12).map((row, offset) => {
    const end = allHours[index + offset + 1];
    return {
      ...row,
      condition: end?.condition ?? condition(null),
      rainProbability: end?.rainProbability ?? null,
      precipitation: end?.precipitation ?? null,
      rainPeriodStart: row.time,
      rainPeriodEnd: new Date(row.at + HOUR).toISOString()
    };
  });

  return {
    current,
    daily,
    hourly,
    ...summarize(allHours, current, now),
    rain: { probability: daily[0].rainProbability, windowLabel: 'اليوم', precipitation: daily[0].precipitation },
    currentAt,
    forecastCurrentAt: currentAt,
    displayTime: new Date(now).toISOString()
  };
}
