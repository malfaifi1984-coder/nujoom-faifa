import { createHash } from "node:crypto";

const LATITUDE = 17.2478;
const LONGITUDE = 43.1035;
const KSA_OFFSET_MINUTES = 180;

function env(name) {
  return globalThis.Netlify?.env?.get?.(name) ?? process.env[name];
}

function deterministicUuid(text) {
  const bytes = Buffer.from(createHash("sha256").update(text).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function ksaShift(date = new Date()) {
  return new Date(date.getTime() + KSA_OFFSET_MINUTES * 60_000);
}

function ksaParts(date = new Date()) {
  const shifted = ksaShift(date);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

function addLocalDays(parts, days) {
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function dateKey(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function cleanTime(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) throw new Error(`وقت غير صالح: ${value}`);
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function localToUtcIso(parts, hour, minute) {
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute, 0);
  return new Date(localAsUtc - KSA_OFFSET_MINUTES * 60_000).toISOString();
}

async function fetchPrayerTimes(parts) {
  const unixNoonUtc = Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day, 9, 0, 0) / 1000);
  const url = new URL(`https://api.aladhan.com/v1/timings/${unixNoonUtc}`);
  url.searchParams.set("latitude", String(LATITUDE));
  url.searchParams.set("longitude", String(LONGITUDE));
  url.searchParams.set("method", "4");
  url.searchParams.set("school", "0");
  url.searchParams.set("timezonestring", "Asia/Riyadh");
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`تعذر جلب المواقيت: HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.code !== 200 || !payload?.data?.timings) throw new Error("استجابة المواقيت غير مكتملة");
  return payload.data.timings;
}

async function sendScheduled({ appId, apiKey, siteUrl, sendAfter, heading, body, key, name }) {
  const message = {
    app_id: appId,
    filters: [
      { field: "tag", key: "notify_friday", relation: "=", value: "1" },
      { operator: "AND" },
      { field: "tag", key: "push_device", relation: "=", value: "mobile" }
    ],
    headings: { en: heading, ar: heading },
    contents: { en: body, ar: body },
    send_after: sendAfter,
    url: `${siteUrl.replace(/\/$/, "")}/#notifications`,
    web_url: `${siteUrl.replace(/\/$/, "")}/#notifications`,
    chrome_web_icon: `${siteUrl.replace(/\/$/, "")}/icons/icon-192.png`,
    chrome_web_badge: `${siteUrl.replace(/\/$/, "")}/icons/badge-96.png`,
    priority: 10,
    ttl: 21600,
    idempotency_key: deterministicUuid(key),
    name,
  };

  const response = await fetch("https://api.onesignal.com/notifications", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Key ${apiKey}`,
    },
    body: JSON.stringify(message),
  });
  const text = await response.text();
  let result;
  try { result = JSON.parse(text); } catch { result = { raw: text }; }
  if (!response.ok) throw new Error(`OneSignal ${response.status}: ${JSON.stringify(result)}`);
  return result;
}

export default async () => {
  const appId = env("ONESIGNAL_APP_ID");
  const apiKey = env("ONESIGNAL_API_KEY") || env("ONESIGNAL_APP_API_KEY") || env("ONESIGNAL_REST_API_KEY");
  const siteUrl = env("URL") || env("DEPLOY_PRIME_URL") || "https://nujoom-faifa.netlify.app";
  if (!appId || !apiKey) throw new Error("أضف ONESIGNAL_APP_ID و ONESIGNAL_API_KEY في Netlify.");

  const today = ksaParts();
  // تعمل الوظيفة يوم الخميس فقط. cron أدناه مضبوط على الخميس بتوقيت السعودية.
  if (today.weekday !== 4) {
    return new Response(JSON.stringify({ ok: true, skipped: true, reason: "ليس يوم الخميس بتوقيت السعودية" }), {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const thursday = { year: today.year, month: today.month, day: today.day };
  const friday = addLocalDays(thursday, 1);
  const thursdayTimes = await fetchPrayerTimes(thursday);
  const fridayTimes = await fetchPrayerTimes(friday);
  const maghribThu = cleanTime(thursdayTimes.Maghrib);
  const asrFri = cleanTime(fridayTimes.Asr);
  const fridayKey = dateKey(friday);

  const jobs = [
    {
      sendAfter: localToUtcIso(thursday, maghribThu.hour, maghribThu.minute + 5),
      heading: "🌙 بدأت ليلة الجمعة",
      body: "لا تنسَ قراءة سورة الكهف والإكثار من الصلاة على النبي ﷺ.",
      key: `nujoom-faifa:kahf:${fridayKey}:thursday-maghrib`,
      name: `سورة الكهف — ليلة الجمعة ${fridayKey}`,
    },
    {
      sendAfter: localToUtcIso(friday, 8, 0),
      heading: "📖 تذكير سورة الكهف",
      body: "جمعة مباركة — لا تنسَ قراءة سورة الكهف والإكثار من الصلاة على النبي ﷺ.",
      key: `nujoom-faifa:kahf:${fridayKey}:friday-0800`,
      name: `سورة الكهف — صباح الجمعة ${fridayKey}`,
    },
    {
      sendAfter: localToUtcIso(friday, asrFri.hour, asrFri.minute + 20),
      heading: "⏳ ما زال وقت سورة الكهف متاحًا",
      body: "إن لم تقرأ سورة الكهف بعد، فبادر بها قبل غروب شمس الجمعة.",
      key: `nujoom-faifa:kahf:${fridayKey}:friday-after-asr`,
      name: `سورة الكهف — بعد العصر ${fridayKey}`,
    },
  ];

  const results = [];
  for (const job of jobs) {
    if (new Date(job.sendAfter).getTime() <= Date.now() + 60_000) {
      results.push({ name: job.name, skipped: true, reason: "موعد الإرسال مضى" });
      continue;
    }
    const response = await sendScheduled({ appId, apiKey, siteUrl, ...job });
    results.push({ name: job.name, sendAfter: job.sendAfter, messageId: response.id || null });
  }

  console.log(JSON.stringify({ friday: fridayKey, results }, null, 2));
  return new Response(JSON.stringify({ ok: true, friday: fridayKey, results }), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
};

export const config = {
  // الخميس 12:05 ظهرًا بتوقيت السعودية = 09:05 UTC.
  schedule: "5 9 * * 4",
};
