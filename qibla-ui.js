import { bearing, difference, distance, normalize, parseCoordinates, trustworthyHeading, validCoordinates } from './qibla-math.mjs';

const $ = (id) => document.getElementById(id);
const degrees = (number) => Math.round(number).toLocaleString('ar-SA') + '°';
const angle = () => window.screen?.orientation?.angle ?? window.orientation ?? 0;
const active = () => !document.hidden && $('page-prayer').classList.contains('active');
let position = null, target = null, heading = null;
let listening = false, starting = false, timer = null, sensorSession = 0, locationRequestId = 0;
let locationPending = false, locationError = null, sensorState = 'idle', sensorNote = '';

const locationErrors = {
  LOCATION_DENIED: ['لم يُسمح بتحديد موقعك', 'اسمح بالموقع من إعدادات المتصفح، أو أدخل إحداثيات مكانك يدويًا.'],
  LOCATION_TIMEOUT: ['انتهت مهلة تحديد الموقع', 'أعد المحاولة في مكان مفتوح، أو أدخل إحداثيات مكانك يدويًا.'],
  LOCATION_UNAVAILABLE: ['تعذر الحصول على موقعك', 'تحقق من تشغيل خدمات الموقع، أو أدخل الإحداثيات يدويًا.'],
  LOCATION_INACCURATE: ['تحديد الموقع غير دقيق', 'أعد المحاولة في مكان مفتوح، أو أدخل إحداثيات مكانك يدويًا.'],
  NEAR_KAABA: ['أنت قريب من الكعبة', 'اتبع العلامات والإرشادات المحلية؛ دقة الموقع لا تكفي لتوجيه السهم من هذا القرب.']
};
const sensorMessages = {
  idle: ['اتجاه ثابت من الشمال', 'فعّل البوصلة لمعرفة اتجاه الجوال بالنسبة للقبلة.'],
  stopped: ['البوصلة متوقفة', 'الاتجاه المعروض ثابت من الشمال. اضغط تفعيل البوصلة لتشغيل الحساس مجددًا.'],
  waiting: ['بانتظار قراءة البوصلة', 'أبقِ الشاشة بالطول والجوال مسطحًا، وابتعد عن المغناطيس والأجسام المعدنية.'],
  denied: ['لم يُسمح بحساس الاتجاه', 'اسمح بالحركة والاتجاه من إعدادات المتصفح، ثم أعد تفعيل البوصلة.'],
  unsupported: ['حساس البوصلة غير متاح', 'هذا الجهاز أو المتصفح لا يوفّر قراءة اتجاه؛ الاتجاه المعروض ثابت من الشمال.'],
  insecure: ['البوصلة تحتاج اتصالًا آمنًا', 'افتح التطبيق من رابطه الذي يبدأ بـ HTTPS.'],
  timeout: ['لم تصل قراءة موثوقة من البوصلة', 'أعد التفعيل وحرّك الجوال على شكل ٨، ثم أمسكه مسطحًا والشاشة بالطول.'],
  invalid: ['تعذر اعتماد قراءة الاتجاه', 'حرّك الجوال على شكل ٨ ثم أمسكه مسطحًا؛ لا يمكن اعتماد قراءة غير دقيقة.']
};

function render() {
  // No bearing is shown before an actual location or explicit manual input exists.
  $('qb-needle').setAttribute('visibility', target === null ? 'hidden' : 'visible');
  $('qb-needle').setAttribute('transform', `rotate(${target ?? 0},100,100)`);
  $('qb-dial').setAttribute('transform', `rotate(${heading === null ? 0 : -heading},100,100)`);
  const aligned = target !== null && heading !== null && Math.abs(difference(target, heading)) <= 5;
  $('qibla-compass').classList.toggle('aligned', aligned);
  $('qibla-btn').disabled = starting;
  $('qibla-btn').textContent = starting ? 'جارٍ طلب الإذن…' : listening ? 'إيقاف البوصلة'
    : position ? 'تفعيل البوصلة' : 'تحديد موقعي وتشغيل البوصلة';
  $('qibla-location-text').textContent = position
    ? `${position.source === 'manual' ? 'موقع مُدخل يدويًا' : 'موقعك الحالي'}: ${position.latitude.toFixed(4)}°، ${position.longitude.toFixed(4)}°`
    : locationPending ? 'جارٍ تحديد موقعك الحالي…' : 'لم يُحدد موقعك بعد';
  if (target === null) {
    $('qibla-direction').textContent = 'حدد موقعك لعرض اتجاه القبلة';
    $('qibla-degrees').textContent = '';
    $('qibla-quality').textContent = locationPending ? 'تحديد الموقع' : 'الموقع غير محدد';
    $('qibla-status').textContent = locationPending ? 'جارٍ تحديد موقعك…' : locationError?.[0] || 'ابدأ بتحديد موقعك';
    const sensor = heading !== null ? 'حساس الاتجاه يعمل.' : (sensorMessages[sensorState]?.[1] || '');
    $('qibla-note').textContent = `${locationError?.[1] || 'استخدم موقع الجهاز أو أدخل الإحداثيات يدويًا.'} ${sensor}`;
    return;
  }
  const directions = ['الشمال','الشمال الشرقي','الشرق','الجنوب الشرقي','الجنوب','الجنوب الغربي','الغرب','الشمال الغربي'];
  $('qibla-direction').textContent = `القبلة نحو ${directions[Math.round(target / 45) % 8]} · ${degrees(target)} من الشمال`;
  if (heading !== null) {
    const delta = difference(target, heading);
    $('qibla-quality').textContent = aligned ? 'قريب من القبلة' : 'البوصلة تعمل';
    $('qibla-status').textContent = aligned ? 'اتجاهك قريب من القبلة' : delta > 0 ? 'أدر الجوال يمينًا' : 'أدر الجوال يسارًا';
    $('qibla-degrees').textContent = `${degrees(Math.abs(delta))} عن اتجاه القبلة`;
    $('qibla-note').textContent = `${position.source === 'manual' ? 'الحساب من الإحداثيات التي أدخلتها. ' : ''}قراءة الحساس تتأثر بالمعادن والمغناطيس.`;
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
    if (position?.source === 'gps') { position = null; target = null; }
  }
  sensorState = 'stopped'; sensorNote = ''; render();
}
function watchSensor(delay) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    detachSensor(); sensorState = 'timeout'; sensorNote = ''; render();
  }, delay);
}
function orient(event) {
  if (!listening) return;
  // Relative Android events have no north reference and must not overwrite the absolute stream.
  if (!Number.isFinite(event.webkitCompassHeading) && event.absolute !== true) return;
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
      resolve({latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy, source: 'gps'});
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
  const locating = position?.source === 'manual' ? Promise.resolve() : updateLocation();
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

function closeManual() {
  $('qibla-manual').hidden = true;
  $('qibla-manual-toggle').setAttribute('aria-expanded', 'false');
  $('qibla-manual-toggle').focus();
}
function manualFeedback(text = '') {
  const feedback = $('qibla-manual-error');
  if (feedback) { feedback.textContent = text; feedback.hidden = !text; }
}
$('qibla-manual-toggle')?.addEventListener('click', () => {
  const form = $('qibla-manual'); form.hidden = !form.hidden;
  $('qibla-manual-toggle').setAttribute('aria-expanded', String(!form.hidden));
  if (!form.hidden) {
    manualFeedback();
    $('qibla-latitude').removeAttribute('aria-invalid');
    $('qibla-longitude').removeAttribute('aria-invalid');
    $('qibla-latitude').focus();
  }
});
$('qibla-manual-cancel')?.addEventListener('click', () => { manualFeedback(); closeManual(); });
$('qibla-manual')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const lat = $('qibla-latitude'), lon = $('qibla-longitude');
  const coordinates = parseCoordinates(lat.value, lon.value);
  lat.removeAttribute('aria-invalid'); lon.removeAttribute('aria-invalid');
  if (!coordinates) {
    lat.setAttribute('aria-invalid', 'true'); lon.setAttribute('aria-invalid', 'true');
    $('qibla-status').textContent = 'أدخل إحداثيات صحيحة';
    $('qibla-note').textContent = 'خط العرض بين −٩٠ و٩٠، وخط الطول بين −١٨٠ و١٨٠. اكتب العددين كاملين دون ترك خانة فارغة.';
    manualFeedback('أدخل خط العرض بين −٩٠ و٩٠، وخط الطول بين −١٨٠ و١٨٠، دون ترك خانة فارغة.');
    lat.focus(); return;
  }
  locationRequestId++; locationPending = false; locationError = null;
  position = null; target = null;
  if (distance(coordinates.latitude, coordinates.longitude) <= 100) {
    locationError = locationErrors.NEAR_KAABA;
    manualFeedback('أنت قريب من الكعبة؛ اتبع العلامات والإرشادات المحلية.'); render(); return;
  }
  position = {...coordinates, accuracy: null, source: 'manual'};
  target = bearing(position.latitude, position.longitude);
  manualFeedback(); closeManual(); render();
});

window.addEventListener('pagehide', () => stop({clearGps: true}));
document.addEventListener('visibilitychange', () => { if (document.hidden) stop({clearGps: true}); });
new MutationObserver(() => {
  if (!$('page-prayer').classList.contains('active') && (listening || starting || locationPending || position?.source === 'gps')) stop({clearGps: true});
}).observe($('page-prayer'), {attributes: true, attributeFilter: ['class']});
render();
