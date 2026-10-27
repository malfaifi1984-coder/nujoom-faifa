import { createHash } from 'node:crypto';
import { fetchPrayerDay, ksaDateKey, prayerInstant, PRAYERS } from '../../prayer-shared.mjs';

const env = (name) => globalThis.Netlify?.env?.get?.(name) ?? process.env[name];
function uuid(value) {
  const bytes = createHash('sha256').update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
  const s = bytes.toString('hex');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
const tag = (key, value) => ({ field: 'tag', key, relation: '=', value });
function filtersFor(id, lead, legacy) {
  const filters = [tag('notify_prayer', '1'), tag('push_device', 'mobile')];
  if (legacy) filters.push({ field: 'tag', key: 'prayer_prefs_version', relation: 'not_exists' });
  else filters.push(tag('prayer_prefs_version', '2'), tag(`notify_prayer_${id}`, '1'), tag(lead === 0 ? 'prayer_at_time' : 'prayer_lead_minutes', lead === 0 ? '1' : String(lead)));
  return filters.flatMap((filter, i) => i ? [{ operator: 'AND' }, filter] : [filter]);
}
export default async () => {
  const appId = env('ONESIGNAL_APP_ID');
  const apiKey = env('ONESIGNAL_API_KEY') || env('ONESIGNAL_APP_API_KEY') || env('ONESIGNAL_REST_API_KEY');
  if (!appId || !apiKey) throw new Error('Configure ONESIGNAL_APP_ID and ONESIGNAL_API_KEY securely in Netlify.');
  const siteUrl = (env('URL') || env('DEPLOY_PRIME_URL') || 'https://nujoom-faifa.netlify.app').replace(/\/$/, '');
  const raw = Number(env('PRAYER_NOTICE_MINUTES') ?? 10);
  const legacyLead = Number.isFinite(raw) ? Math.max(0, Math.min(60, Math.round(raw))) : 10;
  const date = ksaDateKey();
  const { timings } = await fetchPrayerDay(date);
  const results = [];
  for (const [source, label, id] of PRAYERS) {
    const variants = [{ lead: legacyLead, legacy: true }, ...[0, 5, 10, 15].map((lead) => ({ lead, legacy: false }))];
    for (const { lead, legacy } of variants) {
      const sendAfter = prayerInstant(date, timings[source], lead);
      if (new Date(sendAfter).getTime() <= Date.now() + 60000) { results.push({ prayer: id, lead, legacy, skipped: true }); continue; }
      const heading = lead === 0 ? `حان الآن وقت صلاة ${label} 🕌` : `متبقي ${lead} دقائق على صلاة ${label} 🕌`;
      const key = legacy ? `nujoom-faifa:${date}:${source}:${lead}` : `nujoom-faifa:v6:${date}:${source}:${lead}`;
      const message = {
        app_id: appId, filters: filtersFor(id, lead, legacy),
        headings: { en: heading, ar: heading }, contents: { en: 'حسب توقيت فيفاء — تقبّل الله طاعتكم.', ar: 'حسب توقيت فيفاء — تقبّل الله طاعتكم.' },
        send_after: sendAfter, url: `${siteUrl}/?page=prayer`, web_url: `${siteUrl}/?page=prayer`,
        chrome_web_icon: `${siteUrl}/icons/icon-192.png`, chrome_web_badge: `${siteUrl}/icons/badge-96.png`,
        priority: 10, ttl: 1800, idempotency_key: uuid(key), name: `صلاة ${label} — ${date} — ${lead} دقائق${legacy ? ' — legacy' : ''}`,
      };
      try {
        const response = await fetch('https://api.onesignal.com/notifications', {
          method: 'POST', signal: AbortSignal.timeout(15000),
          headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Key ${apiKey}` }, body: JSON.stringify(message)
        });
        const body = await response.json();
        if (!response.ok) throw new Error(`OneSignal HTTP ${response.status}`);
        results.push({ prayer: id, lead, legacy, sendAfter, messageId: body.id || null });
      } catch (error) {
        results.push({ prayer: id, lead, legacy, sendAfter, error: error.message });
      }
    }
  }
  const ok = !results.some((result) => result.error);
  console.log(JSON.stringify({ date, ok, jobs: results.length, failed: results.filter((result) => result.error).length }));
  return Response.json({ ok, date, results }, { status: ok ? 200 : 500 });
};
export const config = { schedule: '5 21 * * *' }; // 00:05 Asia/Riyadh.
