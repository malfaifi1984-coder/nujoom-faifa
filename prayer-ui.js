import { fetchPrayerDay, PRAYERS, ksaDateKey, cleanTime } from './prayer-shared.mjs';

const $ = (id) => document.getElementById(id);
const STORE = 'nujoomPrayerSettingsV7';
const days = new Map();
const localCalculation = window.computePrayerTimes;
const previousSync = window.syncNotifyPrefsToOneSignal;
const previousStarCheck = window.checkAndNotify;
window.checkAndNotify = () => {
  if (!('Notification' in window) || Notification.permission !== 'granted' || localStorage.getItem('notificationsEnabled') === 'false') return;
  return previousStarCheck();
};
let activeDate;
let loading = false;
let syncNumber = 0;
const keyFromLocalDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function validDay(day, date) {
  try {
    return day?.date === date && day.timezone === 'Asia/Riyadh' && [...PRAYERS, ['Sunrise']].every(([key]) => day.timings?.[key] === cleanTime(day.timings?.[key]));
  } catch (_) { return false; }
}
function readSettings() {
  let saved = {};
  try { const value = JSON.parse(localStorage.getItem(STORE) || '{}'); if (value && typeof value === 'object') saved = value; } catch (_) { /* Use defaults. */ }
  return { atTime: true, lead: [0, 5, 10, 15].includes(saved.lead) ? saved.lead : 0, prayers: Object.fromEntries(PRAYERS.map(([, , key]) => [key, true])) };
}
function enabled() { return window.getNotifyPrefs().prayer; }
function subscription() { return window.__oneSignalInstance?.User?.PushSubscription; }
function refreshStatus(message) {
  const sub = subscription();
  const supported = 'Notification' in window;
  const denied = 'Notification' in window && Notification.permission === 'denied';
  const local = supported && Notification.permission === 'granted' && localStorage.getItem('notificationsEnabled') !== 'false';
  const active = !!sub?.optedIn || local;
  $('prayer-push-status').textContent = message || (!supported ? 'هذا المتصفح لا يدعم الإشعارات. جرّب التطبيق على جهاز يدعمها.' : denied ? 'الإشعارات محظورة من المتصفح. افتح إعدادات الموقع للسماح بها.' : sub?.optedIn ? 'إشعارات الجهاز مفعّلة. اختر التنبيهات المناسبة لك.' : local ? 'الإشعارات مفعّلة أثناء فتح التطبيق. تنبيه الصلاة والتطبيق مغلق يحتاج تفعيل الخدمة على هاتف مدعوم.' : 'الإشعارات متوقفة. اختر تفضيلاتك ثم اضغط «تفعيل».');
  $('prayer-enable-push').hidden = !!sub?.optedIn || (local && !window.isMobilePushDevice()) || !supported || denied;
  $('notification-disable').hidden = !active;
  $('notification-device-state').textContent = active ? 'مفعّلة' : denied ? 'محظورة' : 'متوقفة';
  $('notification-device-state').dataset.active = String(active);
  for (const [id, value] of [['prayer-choice-state', enabled()], ['stars-choice-state', window.getNotifyPrefs().stars]]) {
    $(id).textContent = value ? 'مفعّلة' : 'متوقفة';
    $(id).dataset.active = String(value);
  }
}
async function syncSettings() {
  const sdk = window.__oneSignalInstance;
  if (!sdk?.User?.addTags) { refreshStatus(); return; }
  const prefs = readSettings();
  const seq = ++syncNumber;
  const tags = { prayer_prefs_version: '2', notify_prayer: enabled() ? '1' : '0', prayer_at_time: prefs.atTime ? '1' : '0', prayer_lead_minutes: String(prefs.lead), push_device: window.isMobilePushDevice() ? 'mobile' : 'desktop' };
  for (const [, , key] of PRAYERS) tags[`notify_prayer_${key}`] = '1';
  try {
    await sdk.User.addTags(tags);
    if (seq === syncNumber) refreshStatus();
  } catch (_) { if (seq === syncNumber) refreshStatus('حُفظت التفضيلات على الجهاز، وتعذرت مزامنتها. افتح التطبيق عند عودة الاتصال.'); }
}
window.syncNotifyPrefsToOneSignal = (prefs) => { previousSync(prefs); void syncSettings(); };
function saveSettings() {
  const prefs = {
    atTime: true,
    lead: Number($('prayer-lead').value),
    prayers: Object.fromEntries(PRAYERS.map(([, , key]) => [key, true]))
  };
  try {
    localStorage.setItem(STORE, JSON.stringify(prefs));
    const general = window.getNotifyPrefs(); general.prayer = $('prayer-master').checked;
    general.stars = $('notify-stars').checked;
    localStorage.setItem('nujoomNotifyPrefs', JSON.stringify(general));
  } catch (_) { refreshStatus('تعذر حفظ التفضيلات. تحقق من السماح بالتخزين في المتصفح.'); return; }
  window.syncNotifyPrefsToOneSignal();
  if (window.getNotifyPrefs().stars && 'Notification' in window && Notification.permission === 'granted' && localStorage.getItem('notificationsEnabled') !== 'false') void window.checkAndNotify();
}
function paintSettings() {
  const prefs = readSettings();
  $('prayer-master').checked = enabled();
  $('notify-stars').checked = window.getNotifyPrefs().stars;
  $('prayer-lead').value = String(prefs.lead);
  refreshStatus();
}
window.computePrayerTimes = (date) => {
  const day = days.get(keyFromLocalDate(date));
  if (!day) return localCalculation(date);
  return Object.fromEntries([...PRAYERS, ['Sunrise', '', 'sunrise']].map(([source, , target]) => {
    const [h, m] = day.timings[source].split(':').map(Number); return [target, h + m / 60];
  }));
};
function paintTimes() {
  window.renderPrayerCard(); window.adhanTick(); window.updateHomePrayer();
  const day = days.get(ksaDateKey());
  window.FaifaPrayerDay = day || null;
  window.FaifaPrayerDays = Object.fromEntries(days);
  window.dispatchEvent(new Event('faifa-prayer-times'));
  $('prayer-source-status').textContent = day ? 'مواقيت فيفاء · أم القرى' : 'تعذر التحديث؛ المواقيت المعروضة تقريبية مؤقتًا.';
  $('prayer-source-status').dataset.state = day ? 'ready' : 'approximate';
}
async function getDay(date) {
  try {
    const response = await fetch(`/.netlify/functions/prayer-times?date=${date}`, { signal: AbortSignal.timeout(10000) });
    if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
      const day = await response.json();
      if (validDay(day, date)) return day;
    }
  } catch (_) { /* Static development server: use the identical source directly. */ }
  return fetchPrayerDay(date);
}
async function loadTimes() {
  if (loading) return;
  loading = true;
  const today = ksaDateKey(); activeDate = today;
  const tomorrow = ksaDateKey(new Date(Date.now() + 86400000));
  for (const date of [today, tomorrow]) {
    try {
      const saved = JSON.parse(localStorage.getItem(`prayerDayV6:${date}`));
      if (validDay(saved, date)) days.set(date, saved);
    } catch (_) { /* A failed cache read never blocks the source request. */ }
  }
  paintTimes();
  const results = await Promise.allSettled([today, tomorrow].map(async (date) => {
    const day = await getDay(date); days.set(date, day);
    try { localStorage.setItem(`prayerDayV6:${date}`, JSON.stringify(day)); } catch (_) { /* Optional cache. */ }
  }));
  paintTimes();
  if (results[0].status === 'rejected' && days.has(today)) $('prayer-source-status').textContent = 'مواقيت اليوم محفوظة من المصدر الموحّد؛ تعذر تحديث الاتصال.';
  loading = false;
}
// Keep local reminders while the app is open; subscribed devices use server push
// to avoid delivering both a local and a remote prayer notification.
window.checkPrayerAndFridayNotifications = () => {
  if (!('Notification' in window) || Notification.permission !== 'granted' || localStorage.getItem('notificationsEnabled') === 'false') return;
  const general = window.getNotifyPrefs(), prefs = readSettings(), now = window.nowKSA();
  const key = keyFromLocalDate(now), minute = now.getHours() * 60 + now.getMinutes();
  const day = days.get(key);
  if (general.prayer && day && !subscription()?.optedIn) {
    for (const [source, label, id] of PRAYERS) {
      if (!prefs.prayers[id]) continue;
      const [h, m] = day.timings[source].split(':').map(Number);
      const remaining = h * 60 + m - minute;
      if (!(remaining === 0 && prefs.atTime) && !(prefs.lead > 0 && remaining === prefs.lead)) continue;
      const once = `localPrayerV6:${key}:${id}:${remaining}`;
      if (localStorage.getItem(once)) continue;
      const title = remaining ? `متبقي ${remaining} دقائق على صلاة ${label}` : `حان وقت صلاة ${label}`;
      void window.showLocalNotification(title, { body: 'حسب مواقيت فيفاء · تقبّل الله طاعتكم.', tag: once }).then((ok) => { if (ok) localStorage.setItem(once, '1'); });
    }
  }
  if (general.friday && now.getDay() === 5 && now.getHours() === 8 && now.getMinutes() < 5 && !subscription()?.optedIn) {
    const once = `nujoom-friday-${window.fmtGreg(now)}`;
    if (!localStorage.getItem(once)) void window.showLocalNotification('تذكير سورة الكهف', { body: 'جمعة مباركة — لا تنسَ قراءة سورة الكهف.', tag: once }).then((ok) => { if (ok) localStorage.setItem(once, '1'); });
  }
};

window.saveNotifyPrefs = saveSettings;
try {
  if (!localStorage.getItem('nujoomNotificationCenterV1')) {
    const general = window.getNotifyPrefs();
    for (const key of ['stars','friday','weather','daily','updates']) general[key] = false;
    localStorage.setItem('nujoomNotifyPrefs', JSON.stringify(general));
    localStorage.setItem('nujoomNotificationCenterV1', '1');
  }
} catch (_) { /* Storage is optional. */ }
const center = $('notification-center');
window.openNotificationCenter = () => {
  paintSettings();
  window.showPage('info');
  setTimeout(() => center.scrollIntoView({ block: 'start', behavior: 'smooth' }), 350);
};
window.addEventListener('hashchange', () => { if (location.hash === '#notifications') window.openNotificationCenter(); });
if (location.hash === '#notifications') setTimeout(window.openNotificationCenter, 350);
const oldStatus = window.updateNotifBtn;
window.updateNotifBtn = () => { oldStatus?.(); refreshStatus(); };
paintSettings();
$('prayer-ios-tip').hidden = !/iPhone|iPad|iPod/.test(navigator.userAgent);
$('prayer-preferences').addEventListener('change', saveSettings);
$('prayer-enable-push').addEventListener('click', async () => {
  if (window.isMobilePushDevice()) {
    if (!subscription()?.optedIn) await window.toggleNotifications();
  } else if (await window.requestNotificationPermission()) {
    localStorage.setItem('notificationsEnabled', 'true');
  }
  refreshStatus(); await syncSettings();
});
$('notification-disable').addEventListener('click', async () => {
  try {
    if (subscription()?.optedIn) await subscription().optOut();
    localStorage.setItem('notificationsEnabled', 'false');
    refreshStatus();
  } catch (_) { refreshStatus('تعذر إيقاف إشعارات الجهاز الآن. حاول عند عودة الاتصال.'); }
});
$('prayer-test').addEventListener('click', async () => {
  if (!await window.requestNotificationPermission()) { refreshStatus('لم يُسمح بالإشعارات. راجع إعدادات المتصفح.'); return; }
  const ok = await window.showLocalNotification('اختبار تنبيه الصلاة', { body: 'هذا تنبيه تجريبي على جهازك، وليس موعد صلاة.', tag: 'prayer-test-v6' });
  refreshStatus(ok ? 'أُرسل التنبيه التجريبي إلى جهازك. هذا لا يختبر وصول إشعارات الخادم.' : 'تعذر عرض التنبيه التجريبي على هذا الجهاز.');
});
$('prayer-refresh').addEventListener('click', () => { void loadTimes(); });
document.addEventListener('onesignal-ready', () => { void syncSettings(); });
setInterval(() => {
  if (!document.hidden && 'Notification' in window && Notification.permission === 'granted' && localStorage.getItem('notificationsEnabled') !== 'false' && window.getNotifyPrefs().stars) void window.checkAndNotify();
}, 60000);
window.addEventListener('online', () => { void loadTimes(); void syncSettings(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { paintSettings(); if (activeDate !== ksaDateKey()) void loadTimes(); } });
setInterval(() => { if (activeDate !== ksaDateKey()) void loadTimes(); }, 60000);
void loadTimes();
if (window.__oneSignalInstance) void syncSettings();
