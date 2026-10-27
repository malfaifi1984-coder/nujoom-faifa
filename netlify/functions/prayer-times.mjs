import { fetchPrayerDay, ksaDateKey } from '../../prayer-shared.mjs';
export default async (request) => {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
  const date = new URL(request.url).searchParams.get('date') || ksaDateKey();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Response('Invalid date', { status: 400 });
  const days = (new Date(`${date}T12:00:00Z`) - new Date(`${ksaDateKey()}T12:00:00Z`)) / 86400000;
  if (!Number.isFinite(days) || days < -1 || days > 2) return new Response('Date out of range', { status: 400 });
  try {
    return Response.json(await fetchPrayerDay(date), { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=3600', 'Netlify-CDN-Cache-Control': 'public, s-maxage=3600' } });
  } catch (_) { return Response.json({ error: 'Prayer times temporarily unavailable' }, { status: 502 }); }
};
