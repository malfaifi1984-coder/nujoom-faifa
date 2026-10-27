import { bearing, difference, distance, normalize, trustworthyHeading, validCoordinates } from './qibla-math.mjs';
const $ = (id) => document.getElementById(id);
let target = bearing(17.2478, 43.1035), heading = null, located = false, listening = false, timer = null;
const degrees = (n) => Math.round(n).toLocaleString('ar-SA') + '°';
const angle = () => screen.orientation?.angle ?? window.orientation ?? 0;
function message(text, note = '') { $('qibla-status').textContent = text; $('qibla-note').textContent = note; }
function draw() {
  $('qb-needle').setAttribute('transform', `rotate(${target.toFixed(2)},100,100)`);
  $('qb-dial').setAttribute('transform', `rotate(${heading === null ? 0 : -heading},100,100)`);
  const directions = ['الشمال','الشمال الشرقي','الشرق','الجنوب الشرقي','الجنوب','الجنوب الغربي','الغرب','الشمال الغربي'];
  $('qibla-direction').textContent = `القبلة نحو ${directions[Math.round(target / 45) % 8]} · ${degrees(target)} من الشمال`;
}
function locationRequest() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('LOCATION_UNAVAILABLE')); return; }
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (!validCoordinates(coords.latitude, coords.longitude) || !Number.isFinite(coords.accuracy) || coords.accuracy > 1000) { reject(new Error('LOCATION_INACCURATE')); return; }
      if (distance(coords.latitude, coords.longitude) <= Math.max(100, coords.accuracy * 2)) { reject(new Error('NEAR_KAABA')); return; }
      target = bearing(coords.latitude, coords.longitude); located = true;
      $('qibla-location-text').textContent = `موقعك: ${coords.latitude.toFixed(3)}°، ${coords.longitude.toFixed(3)}°`;
      $('qibla-quality').textContent = 'الموقع محدد'; draw(); resolve();
    }, () => reject(new Error('LOCATION_DENIED')), { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  });
}
function stop() {
  clearTimeout(timer); listening = false; heading = null;
  window.removeEventListener('deviceorientationabsolute', orient, true);
  window.removeEventListener('deviceorientation', orient, true);
  $('qibla-compass').classList.remove('aligned');
  $('qibla-btn').style.display = ''; $('qibla-btn').disabled = false; $('qibla-btn').textContent = 'تفعيل البوصلة'; draw();
}
function orient(event) {
  if (!located) return;
  // Android may emit a relative stream alongside its absolute stream. Ignore
  // that stream instead of overwriting the latest trustworthy north reading.
  if (!Number.isFinite(event.webkitCompassHeading) && event.absolute !== true) return;
  const value = trustworthyHeading(event, angle());
  if (value === null) {
    heading = null; draw(); $('qibla-degrees').textContent = '';
    $('qibla-compass').classList.remove('aligned');
    $('qibla-quality').textContent = 'قراءة غير موثوقة';
    message(normalize(angle()) !== 0 ? 'استخدم الجوال بالوضع العمودي' : 'ضع الجوال بشكل أفقي وعاير البوصلة', 'لا نعتمد قراءة اتجاه نسبية أو غير دقيقة.');
    return;
  }
  clearTimeout(timer);
  heading = heading === null ? value : normalize(heading + .3 * difference(value, heading));
  draw();
  const delta = difference(target, heading), aligned = Math.abs(delta) <= 5;
  $('qibla-compass').classList.toggle('aligned', aligned);
  $('qibla-quality').textContent = aligned ? 'قريب من القبلة' : 'البوصلة تعمل';
  $('qibla-degrees').textContent = `${degrees(Math.abs(delta))} عن اتجاه القبلة`;
  message(aligned ? 'اتجاهك قريب من القبلة' : delta > 0 ? 'أدر الجوال يمينًا' : 'أدر الجوال يسارًا', 'قراءة الحساس تتأثر بالمعادن والمغناطيس.');
  timer = setTimeout(() => { heading = null; draw(); $('qibla-compass').classList.remove('aligned'); $('qibla-quality').textContent = 'القراءة متوقفة'; message('توقفت قراءة حساس الاتجاه'); }, 4000);
}
async function start() {
  if (listening) { stop(); message('البوصلة متوقفة'); return; }
  if (!window.DeviceOrientationEvent) { message('هذا الجهاز لا يوفر بوصلة', 'يمكنك قراءة اتجاه القبلة من الشمال، أو فتح التطبيق على جوال يدعم البوصلة.'); return; }
  $('qibla-btn').disabled = true;
  try {
    // Safari needs its permission request inside the original user gesture.
    const permission = typeof DeviceOrientationEvent.requestPermission === 'function' ? DeviceOrientationEvent.requestPermission(true) : Promise.resolve('granted');
    const results = await Promise.allSettled([permission, locationRequest()]);
    if (results[0].status === 'rejected' || results[0].value !== 'granted') throw new Error('SENSOR_DENIED');
    if (results[1].status === 'rejected') throw results[1].reason;
    if (!document.getElementById('page-prayer').classList.contains('active')) { stop(); return; }
    listening = true;
    window.addEventListener('deviceorientationabsolute', orient, true);
    window.addEventListener('deviceorientation', orient, true);
    $('qibla-btn').disabled = false; $('qibla-btn').textContent = 'إيقاف البوصلة';
    message('بانتظار قراءة البوصلة', 'أمسك الجوال بالوضع العمودي مع إبقائه مسطحًا.');
    timer = setTimeout(() => { if (heading === null) { stop(); $('qibla-btn').textContent = 'إعادة تشغيل البوصلة'; message('لم تصل قراءة موثوقة', 'اتجاه القبلة المعروض ثابت من الشمال، وليس اتجاه الجوال.'); } }, 7000);
  } catch (error) {
    stop();
    const texts = { LOCATION_DENIED: 'اسمح بالموقع لحساب القبلة من مكانك.', LOCATION_INACCURATE: 'تحديد الموقع غير دقيق؛ أعد المحاولة في مكان مفتوح.', LOCATION_UNAVAILABLE: 'الموقع غير متاح على هذا الجهاز.', NEAR_KAABA: 'أنت قريب من الكعبة؛ اتبع العلامات والإرشادات المحلية.', SENSOR_DENIED: 'لم يُسمح بالوصول إلى حساس الاتجاه.' };
    message('تعذر تشغيل البوصلة', texts[error.message] || 'أعد المحاولة من متصفح يدعم الموقع وحساس الاتجاه.');
  }
}
window.startQibla = start;
window.refreshQiblaLocation = async () => {
  stop();
  try { await locationRequest(); message('حُدّث اتجاه القبلة من موقعك', 'الاتجاه ثابت من الشمال حتى تفعّل البوصلة.'); }
  catch (_) { message('تعذر تحديث موقعك', 'لم يتغير موقع حساب القبلة.'); }
};
window.recalibrateQibla = () => { heading = null; draw(); $('qibla-compass').classList.remove('aligned'); message('حرّك الجوال على شكل ٨ ثم أمسكه مسطحًا'); };
$('qibla-location-text').textContent = 'الاتجاه الحالي محسوب من فيفاء · استخدم موقعي لتغييره';
$('qibla-quality').textContent = 'اتجاه ثابت';
$('qibla-btn').textContent = 'تفعيل البوصلة';
message('اتجاه القبلة من الشمال', 'فعّل الموقع والبوصلة لمعرفة اتجاهك بالنسبة للقبلة.');
draw();
window.addEventListener('pagehide', stop);
new MutationObserver(() => { if (listening && !document.getElementById('page-prayer').classList.contains('active')) stop(); }).observe(document.getElementById('page-prayer'), {attributes:true, attributeFilter:['class']});
