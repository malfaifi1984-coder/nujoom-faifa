import { createHash } from "node:crypto";

const LATITUDE = 17.2478;
const LONGITUDE = 43.1035;
const KSA_OFFSET_MINUTES = 180;
const DEFAULT_NOTICE_MINUTES = 10;
const PRAYERS = [
  ["Fajr", "الفجر"],
  ["Dhuhr", "الظهر"],
  ["Asr", "العصر"],
  ["Maghrib", "المغرب"],
  ["Isha", "العشاء"],
];

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

function ksaDateParts(date = new Date()) {
  const shifted = new Date(date.getTime() + KSA_OFFSET_MINUTES * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function cleanTime(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) throw new Error(`وقت صلاة غير صالح: ${value}`);
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function toUtcIso(dateParts, time, noticeMinutes) {
  const localAsUtc = Date.UTC(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    time.hour,
    time.minute,
    0,
  );
  const actualUtc = localAsUtc - KSA_OFFSET_MINUTES * 60_000 - noticeMinutes * 60_000;
  return new Date(actualUtc).toISOString();
}

async function fetchPrayerTimes(dateParts) {
  const unixNoonUtc = Math.floor(
    Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, 9, 0, 0) / 1000,
  );
  const url = new URL(`https://api.aladhan.com/v1/timings/${unixNoonUtc}`);
  url.searchParams.set("latitude", String(LATITUDE));
  url.searchParams.set("longitude", String(LONGITUDE));
  url.searchParams.set("method", "4"); // Umm Al-Qura University, Makkah
  url.searchParams.set("school", "0");
  url.searchParams.set("timezonestring", "Asia/Riyadh");

  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`تعذر جلب المواقيت: HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.code !== 200 || !payload?.data?.timings) {
    throw new Error("استجابة مواقيت الصلاة غير مكتملة");
  }
  return payload.data.timings;
}

async function scheduleOneSignalMessage({ appId, apiKey, englishKey, arabicName, sendAfter, dateKey, noticeMinutes, siteUrl }) {
  const isAtPrayerTime = noticeMinutes === 0;
  const heading = isAtPrayerTime
    ? `حان الآن وقت صلاة ${arabicName} 🕌`
    : `متبقي ${noticeMinutes} دقائق على صلاة ${arabicName} 🕌`;
  const body = isAtPrayerTime
    ? "حسب توقيت فيفاء — تقبّل الله طاعتكم."
    : "حسب مواقيت فيفاء — تقبّل الله طاعتكم.";

  const idempotencyKey = deterministicUuid(`nujoom-faifa:${dateKey}:${englishKey}:${noticeMinutes}`);
  const message = {
    app_id: appId,
    included_segments: ["Subscribed Users"],
    filters: undefined,
    headings: { en: heading, ar: heading },
    contents: { en: body, ar: body },
    send_after: sendAfter,
    url: `${siteUrl.replace(/\/$/, "")}/#prayer`,
    web_url: `${siteUrl.replace(/\/$/, "")}/#prayer`,
    chrome_web_icon: `${siteUrl.replace(/\/$/, "")}/icons/icon-192.png`,
    chrome_web_badge: `${siteUrl.replace(/\/$/, "")}/icons/badge-96.png`,
    priority: 10,
    ttl: 3600,
    idempotency_key: idempotencyKey,
    name: `صلاة ${arabicName} — ${dateKey}`,
  };

  // Target only users who enabled prayer alerts in the app.
  delete message.included_segments;
  message.filters = [
    { field: "tag", key: "notify_prayer", relation: "=", value: "1" },
    { operator: "AND" },
    { field: "tag", key: "push_device", relation: "=", value: "mobile" }
  ];

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
  if (!response.ok) {
    throw new Error(`OneSignal ${response.status}: ${JSON.stringify(result)}`);
  }
  return result;
}

export default async () => {
  const appId = env("ONESIGNAL_APP_ID");
  const apiKey = env("ONESIGNAL_API_KEY") || env("ONESIGNAL_APP_API_KEY") || env("ONESIGNAL_REST_API_KEY");
  const siteUrl = env("URL") || env("DEPLOY_PRIME_URL") || "https://nujoom-faifa.netlify.app";
  const noticeMinutesRaw = Number(env("PRAYER_NOTICE_MINUTES") ?? DEFAULT_NOTICE_MINUTES);
  const noticeMinutes = Number.isFinite(noticeMinutesRaw)
    ? Math.max(0, Math.min(60, Math.round(noticeMinutesRaw)))
    : DEFAULT_NOTICE_MINUTES;

  if (!appId || !apiKey) {
    throw new Error("أضف ONESIGNAL_APP_ID و ONESIGNAL_API_KEY في متغيرات البيئة داخل Netlify.");
  }

  const dateParts = ksaDateParts();
  const dateKey = `${dateParts.year}-${String(dateParts.month).padStart(2, "0")}-${String(dateParts.day).padStart(2, "0")}`;
  const timings = await fetchPrayerTimes(dateParts);
  const results = [];

  for (const [englishKey, arabicName] of PRAYERS) {
    const time = cleanTime(timings[englishKey]);
    const sendAfter = toUtcIso(dateParts, time, noticeMinutes);
    if (new Date(sendAfter).getTime() <= Date.now() + 60_000) {
      results.push({ prayer: arabicName, skipped: true, reason: "موعد الإرسال مضى" });
      continue;
    }
    const response = await scheduleOneSignalMessage({
      appId,
      apiKey,
      englishKey,
      arabicName,
      sendAfter,
      dateKey,
      noticeMinutes,
      siteUrl,
    });
    results.push({ prayer: arabicName, sendAfter, messageId: response.id || null });
  }

  console.log(JSON.stringify({ date: dateKey, noticeMinutes, results }, null, 2));
  return new Response(JSON.stringify({ ok: true, date: dateKey, noticeMinutes, results }), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
};

export const config = {
  // 00:05 في توقيت السعودية = 21:05 UTC في اليوم السابق.
  schedule: "5 21 * * *",
};
