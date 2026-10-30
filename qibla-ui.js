import { bearing, difference, distance, normalize, trustworthyHeading, validCoordinates } from './qibla-math.mjs?v=6.00-compass3';

const $ = (id) => document.getElementById(id);
const degrees = (number) => Math.round(number).toLocaleString('ar-SA') + '°';
const angle = () => window.screen?.orientation?.angle ?? window.orientation ?? 0;
const active = () => !document.hidden && $('page-prayer').classList.contains('active');
let position = null, target = null, heading = null;
let listening = false, starting = false, timer = null, sensorSession = 0, locationRequestId = 0;
let locationPending = false, locationError = null, sensorState = 'idle', sensorNote = '';

const locationErrors = {
  LOCATION_DENIED: ['لم يُسمح بتحديد موقعك', 'اسمح بالموقع من إعدادات المتصفح ثم أعد المحاولة.'],
  LOCATION_TIMEOUT: ['انتهت مهلة تحديد الموقع', 'أعد المحاولة في مكان مفتوح مع تشغيل خدمات الموقع.'],
  LOCATION_UNAVAILABLE: ['تعذر الحصول على موقعك', 'تحقق من تشغيل خدمات الموقع ثم أعد المحاولة.'],
  LOCATION_INACCURATE: ['تحديد الموقع غير دقيق', 'أعد المحاولة في مكان مفتوح للحصول على موقع أدق.'],
  NEAR_KAABA: ['أنت قريب من الكعبة', 'اتبع العلامات والإرشادات المحلية؛ دقة الموقع لا تكفي لتوجيه السهم من هذا القرب.']
};
const sensorMessages = {
  idle: ['اتجاه ثابت من الشمال', 'فعّل البوصلة لمعرفة اتجاه الجوال بالنسبة للقبلة.'],
  stopped: ['البوصلة متوقفة', 'الاتجاه المعروض ثابت من الشمال. اضغط تفعيل البوصلة لتشغيل الحساس مجددًا.'],
  waiting: ['بانتظار قراءة البوصلة', 'أبقِ الشاشة بالطول والجوال مسطحًا، وابتعد عن المغناطيس والأجسام المعدنية.'],
  denied: ['لم يُسمح بحساس الاتجاه', 'اسمح بالحركة والاتجاه من إعدادات المتصفح، ثم أعد تفعيل البوصلة.'],
  unsupported: ['حساس البوصلة غير متاح', 'هذا الجهاز أو المتصفح لا يوفّر قراءة اتجاه؛ الاتجاه المعروض ثابت من الشمال.'],
  insecure: ['البوصلة تحتاج اتصالًا آمنًا', 'افتح التطبيق من رابطه الذي يبدأ بـ HTTPS.'],
  timeout: ['بانتظار قراءة حديثة من البوصلة', 'حرّك الجوال ببطء مع إبقائه مسطحًا والشاشة بالطول؛ تتجدد القراءة تلقائيًا عند وصولها.'],
  invalid: ['تعذر اعتماد قراءة الاتجاه', 'حرّك الجوال على شكل ٨ ثم أمسكه مسطحًا؛ لا يمكن اعتماد قراءة غير دقيقة.']
};

function render() {
  // No bearing is shown before the device supplies an actual location.
  $('qb-needle').setAttribute('visibility', target === null ? 'hidden' : 'visible');
  $('qb-needle').setAttribute('transform', `rotate(${target ?? 0},100,100)`);
  $('qb-dial').setAttribute('transform', `rotate(${heading === null ? 0 : -heading},100,100)`);
  const aligned = target !== null && heading !== null && Math.abs(difference(target, heading)) <= 5;
  $('qibla-compass').classList.toggle('aligned', aligned);
  $('qibla-btn').disabled = starting;
  $('qibla-btn').textContent = starting ? 'جارٍ طلب الإذن…' : listening ? 'إيقاف البوصلة'
    : position ? 'تفعيل البوصلة' : 'تحديد موقعي وتشغيل البوصلة';
  $('qibla-location-text').textContent = position
    ? `موقعك الحالي: ${position.latitude.toFixed(4)}°، ${position.longitude.toFixed(4)}°`
    : locationPending ? 'جارٍ تحديد موقعك الحالي…' : 'لم يُحدد موقعك بعد';
  if (target === null) {
    $('qibla-direction').textContent = 'حدد موقعك لعرض اتجاه القبلة';
    $('qibla-degrees').textContent = '';
    $('qibla-quality').textContent = locationPending ? 'تحديد الموقع' : 'الموقع غير محدد';
    $('qibla-status').textContent = locationPending ? 'جارٍ تحديد موقعك…' : locationError?.[0] || 'ابدأ بتحديد موقعك';
    const sensor = heading !== null ? 'حساس الاتجاه يعمل.' : (sensorMessages[sensorState]?.[1] || '');
    $('qibla-note').textContent = `${locationError?.[1] || 'اسمح باستخدام موقع الجهاز لحساب القبلة من مكانك.'} ${sensor}`;
    return;
  }
  const directions = ['الشمال','الشمال الشرقي','الشرق','الجنوب الشرقي','الجنوب','الجنوب الغربي','الغرب','الشمال الغربي'];
  $('qibla-direction').textContent = `القبلة نحو ${directions[Math.round(target / 45) % 8]} · ${degrees(target)} من الشمال`;
  if (heading !== null) {
    const delta = difference(target, heading);
    $('qibla-quality').textContent = aligned ? 'قريب من القبلة' : 'البوصلة تعمل';
    $('qibla-status').textContent = aligned ? 'اتجاهك قريب من القبلة' : delta > 0 ? 'أدر الجوال يمينًا' : 'أدر الجوال يسارًا';
    $('qibla-degrees').textContent = `${degrees(Math.abs(delta))} عن اتجاه القبلة`;
    $('qibla-note').textContent = 'قراءة الحساس تتأثر بالمعادن والمغناطيس.';
  } else {
    const [title, note] = sensorMessages[sensorState] || sensorMessages.idle;
    $('qibla-quality').textContent = 'اتجاه ثابت من الشمال';
    $('qibla-status').textContent = title;
    $('qibla-degrees').textContent = '';
    $('qibla-note').textContent = sensorNote || note;
  }
}

function detachSensor() {
  clearTimeout(timer); timer = null; listening = false; heading = null;
  window.removeEventListener('deviceorientationabsolute', orient, true);
  window.removeEventListener('deviceorientation', orient, true);
}
function stop({clearGps = false} = {}) {
  sensorSession++; locationRequestId++;
  detachSensor(); starting = false; locationPending = false;
  if (clearGps) {
    locationError = null;
    position = null; target = null;
  }
  sensorState = 'stopped'; sensorNote = ''; render();
}
function watchSensor(delay) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    // Some phones pause orientation events while still. Discard the stale
    // heading, but keep listening so the next real reading resumes immediately.
    timer = null;
    if (!listening) return;
    heading = null; sensorState = 'timeout'; sensorNote = ''; render();
  }, delay);
}
function orient(event) {
  if (!listening) return;
  // Relative events and empty sensor samples must not overwrite a real heading.
  if (!Number.isFinite(event.webkitCompassHeading) && (event.absolute !== true || !Number.isFinite(event.alpha))) return;
  const value = trustworthyHeading(event, angle());
  if (value === null) {
    heading = null; sensorState = 'invalid';
    sensorNote = normalize(angle()) !== 0
      ? 'أبقِ الشاشة بالطول ثم أمسك الجوال مسطحًا.'
      : 'أمسك الجوال مسطحًا وحرّكه على شكل ٨ بعيدًا عن المغناطيس؛ القراءة الحالية غير موثوقة.';
    render(); return;
  }
  heading = heading === null ? value : normalize(heading + .3 * difference(value, heading));
  sensorState = 'ready'; sensorNote = ''; render(); watchSensor(5000);
}

function currentLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('LOCATION_UNAVAILABLE')); return; }
    navigator.geolocation.getCurrentPosition(({coords}) => {
      if (!validCoordinates(coords.latitude, coords.longitude) || !Number.isFinite(coords.accuracy) || coords.accuracy > 1000) {
        reject(new Error('LOCATION_INACCURATE')); return;
      }
      if (distance(coords.latitude, coords.longitude) <= Math.max(100, coords.accuracy * 2)) {
        reject(new Error('NEAR_KAABA')); return;
      }
      resolve({latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy});
    }, (error) => reject(new Error(error.code === 1 ? 'LOCATION_DENIED' : error.code === 3 ? 'LOCATION_TIMEOUT' : 'LOCATION_UNAVAILABLE')),
    {enableHighAccuracy: true, timeout: 12000, maximumAge: 0});
  });
}
async function updateLocation() {
  const request = ++locationRequestId;
  position = null; target = null; locationError = null; locationPending = true; render();
  try {
    const result = await currentLocation();
    if (request !== locationRequestId || !active()) return;
    position = result; target = bearing(result.latitude, result.longitude);
  } catch (error) {
    if (request !== locationRequestId || !active()) return;
    locationError = locationErrors[error.message] || locationErrors.LOCATION_UNAVAILABLE;
  } finally {
    if (request === locationRequestId) { locationPending = false; render(); }
  }
}

async function start(calibrating = false) {
  if (listening || starting) { stop(); return; }
  const session = ++sensorSession;
  let permission;
  // This call must stay inside the originating tap; awaiting GPS first consumes Safari's gesture.
  try {
    permission = window.isSecureContext === false ? Promise.resolve('insecure')
      : !window.DeviceOrientationEvent ? Promise.resolve('unsupported')
      : typeof window.DeviceOrientationEvent.requestPermission === 'function'
        ? Promise.resolve(window.DeviceOrientationEvent.requestPermission(true)) : Promise.resolve('granted');
  } catch (_) { permission = Promise.resolve('denied'); }
  starting = true; sensorState = 'waiting'; sensorNote = ''; render();
  const locating = updateLocation();
  try {
    let result;
    try { result = await permission; } catch (_) { result = 'denied'; }
    if (session !== sensorSession || !active()) return;
    starting = false;
    if (result !== 'granted') {
      sensorState = result === 'unsupported' || result === 'insecure' ? result : 'denied'; render();
    } else {
      listening = true; sensorState = 'waiting';
      sensorNote = calibrating ? 'حرّك الجوال على شكل ٨ ثم أمسكه مسطحًا والشاشة بالطول.' : '';
      window.addEventListener('deviceorientationabsolute', orient, true);
      window.addEventListener('deviceorientation', orient, true);
      render(); watchSensor(9000);
    }
    await locating;
  } finally {
    if (session === sensorSession) { starting = false; render(); }
  }
}

window.startQibla = start;
window.refreshQiblaLocation = updateLocation;
window.recalibrateQibla = () => {
  if (!listening) return start(true);
  heading = null; sensorState = 'waiting';
  sensorNote = 'حرّك الجوال على شكل ٨ ثم أمسكه مسطحًا والشاشة بالطول.';
  render(); watchSensor(9000);
};

window.addEventListener('pagehide', () => stop({clearGps: true}));
document.addEventListener('visibilitychange', () => { if (document.hidden) stop({clearGps: true}); });
new MutationObserver(() => {
  if (!$('page-prayer').classList.contains('active') && (listening || starting || locationPending || position !== null)) stop({clearGps: true});
}).observe($('page-prayer'), {attributes: true, attributeFilter: ['class']});
render();
