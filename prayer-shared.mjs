export const PRAYER_LOCATION = Object.freeze({ latitude: 17.2478, longitude: 43.1035, timezone: 'Asia/Riyadh', method: 4, school: 0 });
export const PRAYERS = Object.freeze([['Fajr', 'الفجر', 'fajr'], ['Dhuhr', 'الظهر', 'dhuhr'], ['Asr', 'العصر', 'asr'], ['Maghrib', 'المغرب', 'maghrib'], ['Isha', 'العشاء', 'isha']]);
export function ksaDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: PRAYER_LOCATION.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export function cleanTime(value) {
  const match = /^(\d{1,2}):(\d{2})(?:\s|$)/.exec(String(value || ''));
  if (!match || +match[1] > 23 || +match[2] > 59) throw new Error('Invalid prayer time');
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}
export function prayerInstant(date, time, lead = 0) {
  return new Date(new Date(`${date}T${cleanTime(time)}:00+03:00`).getTime() - lead * 60000).toISOString();
}
export async function fetchPrayerDay(date, fetcher = fetch) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('Invalid prayer date');
  const noon = Math.floor(new Date(`${date}T12:00:00+03:00`).getTime() / 1000);
  const url = new URL(`https://api.aladhan.com/v1/timings/${noon}`);
  for (const [key, value] of Object.entries({ latitude: PRAYER_LOCATION.latitude, longitude: PRAYER_LOCATION.longitude, method: PRAYER_LOCATION.method, school: PRAYER_LOCATION.school, timezonestring: PRAYER_LOCATION.timezone })) url.searchParams.set(key, String(value));
  const response = await fetcher(url, { signal: AbortSignal.timeout(12000), headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Prayer source HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.code !== 200 || !payload.data?.timings || payload.data.meta?.timezone !== PRAYER_LOCATION.timezone) throw new Error('Invalid prayer response');
  const gregorian = payload.data.date?.gregorian?.date;
  if (gregorian && gregorian.split('-').reverse().join('-') !== date) throw new Error('Prayer response date does not match request');
  const timings = {};
  for (const [key] of [...PRAYERS, ['Sunrise']]) timings[key] = cleanTime(payload.data.timings[key]);
  return { date, timings, timezone: PRAYER_LOCATION.timezone, method: PRAYER_LOCATION.method, fetchedAt: Date.now() };
}
